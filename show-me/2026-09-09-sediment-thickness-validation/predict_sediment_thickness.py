"""
ADR-0020's Python-first validation step: reconstruct every ocean grid
point's full history using SODP's own Seton+Scotese reconstruction, run
the (not-yet-fitted, literature-midpoint) Sedimentation Rate model through
the same probabilistic Lithology Class classifier the live app uses, and
forward-compact the result into a predicted present-day sediment thickness.
Output is a compact JSON/NPZ the sibling compare_to_globsed.py script reads
-- this file does no plotting and no GlobSed access itself.

Usage:
    conda run -n pygmt17 python predict_sediment_thickness.py [--stride N]

Frames are fetched once from Geode's live archive and cached under
./data/otemp_frames/ (gitignored, same convention as every other show-me
folder's raw-data cache -- see .gitignore).
"""
import argparse
import gzip
import json
import os
import sys
import time

import numpy as np
import requests

sys.path.insert(0, os.path.dirname(__file__))
from reconstruct import (  # noqa: E402
    parse_static_polygons, load_rotations, precompute_bounds, assign_plate,
    create_unbounded_plate_frame_point, position_at,
)
from lithology_model import (  # noqa: E402
    age_to_depth_km, CcdCurve, classify_lithology_probabilistic,
    COMPACTION, RATE_CM_KYR, compact_column, latitude_rate_multiplier,
)

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
GEODE_BASE = "https://siwill22.github.io/Geode/archive"
FRAME_CACHE_DIR = os.path.join(os.path.dirname(__file__), "data", "otemp_frames")


# ---------------------------------------------------------------------------
# Basement age grid -- archive/models/basement-age (Seton et al. 2020)
# ---------------------------------------------------------------------------

def load_basement_age_grid():
    manifest_path = os.path.join(REPO_ROOT, "archive", "models", "basement-age", "manifest.json")
    with open(manifest_path) as f:
        manifest = json.load(f)
    res = manifest["resolutions"][0]
    nlon, nlat = res["nlon"], res["nlat"]
    var = manifest["variables"][0]
    frame_path = os.path.join(
        REPO_ROOT, "archive", "models", "basement-age",
        manifest["path_template"].replace("{variable}", var["id"])
        .replace("{resolution}", res["id"]).replace("{frame}", manifest["frames"][0]["id"]),
    )
    with open(frame_path, "rb") as f:
        bytes_ = np.frombuffer(f.read(), dtype=np.uint8)
    sentinel = manifest["no_data_sentinel"]
    valid = bytes_ != sentinel
    age_ma = var["encode_min"] + (bytes_.astype(np.float64) / 255) * (var["encode_max"] - var["encode_min"])
    return nlon, nlat, age_ma.reshape(nlat, nlon), valid.reshape(nlat, nlon)


def grid_lonlat(nlon: int, nlat: int, i: int, j: int) -> tuple[float, float]:
    """cellCenter() convention: lon is cell-centered (360 bins), lat is
    node-centered (181 exact-degree samples -90..90) -- see volume.ts."""
    lon = ((i + 0.5) / nlon) * 360 - 180
    lat = (j / (nlat - 1)) * 180 - 90
    return lon, lat


# ---------------------------------------------------------------------------
# BRIDGE-Valdes OTEMP frames -- fetched once, shared across every point
# (same principle as FrameByteCache: a frame's bytes cover the whole globe,
# so every point sampling the same age reuses the same decoded array).
# ---------------------------------------------------------------------------

def fetch_otemp_manifest() -> dict:
    r = requests.get(f"{GEODE_BASE}/models/bridge-valdes2021-ocean-depth/manifest.json")
    r.raise_for_status()
    return r.json()


def fetch_otemp_frame(manifest: dict, frame_id: str) -> np.ndarray:
    """Layer 0 (shallowest depth_labels_km entry) only -- CONTEXT.md's
    Productivity Signal convention (layerIndex=0), same as
    fetchClimateSeriesForCore()'s OTEMP usage in syntheticCore.ts."""
    os.makedirs(FRAME_CACHE_DIR, exist_ok=True)
    cache_path = os.path.join(FRAME_CACHE_DIR, f"{frame_id}.bin")
    if os.path.exists(cache_path):
        raw = open(cache_path, "rb").read()
    else:
        res = manifest["resolutions"][0]
        path = (manifest["path_template"]
                .replace("{variable}", manifest["default_variable"])
                .replace("{resolution}", res["id"])
                .replace("{frame}", frame_id))
        url = f"{GEODE_BASE}/models/{manifest['id']}/{path}"
        r = requests.get(url)
        r.raise_for_status()
        raw = r.content
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        with open(cache_path, "wb") as f:
            f.write(raw)
    if raw[:2] == b"\x1f\x8b":  # cached file may still be gzipped from an older run
        raw = gzip.decompress(raw)

    res = manifest["resolutions"][0]
    nlon, nlat, ndepth = res["nlon"], res["nlat"], res["ndepth"]
    plane = nlon * nlat
    all_bytes = np.frombuffer(raw, dtype=np.uint8)
    layer0 = all_bytes[0:plane].reshape(nlat, nlon)
    return layer0


def sample_otemp(layer0: np.ndarray, var_info: dict, sentinel: int, lon: float, lat: float, nlon: int, nlat: int) -> float:
    p_lon = (lon + 180) / 360
    i_lon = int(np.floor(p_lon * nlon)) % nlon
    p_lat = (lat + 90) / 180
    j_lat = min(nlat - 1, max(0, round(p_lat * (nlat - 1))))
    byte = int(layer0[j_lat, i_lon])
    if byte == sentinel:
        return float("nan")
    return var_info["encode_min"] + (byte / 255) * (var_info["encode_max"] - var_info["encode_min"])


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stride", type=int, default=2, help="grid decimation (1 = native 1deg resolution)")
    ap.add_argument("--limit", type=int, default=None, help="cap number of ocean points (debug)")
    ap.add_argument("--lat-correction", action="store_true",
                     help="apply the experimental |latitude|-banded rate correction (see lithology_model.py)")
    args = ap.parse_args()

    print("Loading reconstruction (Scotese/PALEOMAP static polygons + rotations)...")
    polygons = parse_static_polygons(os.path.join(
        REPO_ROOT, "archive", "reconstructions", "scotese-paleomap", "staticpolygons", "geometry.bin"))
    table = load_rotations(os.path.join(
        REPO_ROOT, "archive", "reconstructions", "scotese-paleomap", "staticpolygons", "rotations.json"))
    bounds = precompute_bounds(polygons)
    print(f"  {len(polygons)} static polygons, {len(table.plates)} plates in rotation table")

    print("Loading basement age grid (Seton et al. 2020)...")
    nlon_age, nlat_age, age_grid, valid_grid = load_basement_age_grid()

    print("Loading CCD curves...")
    ccd_published = CcdCurve(os.path.join(REPO_ROOT, "archive", "ccd", "published_ccd_curve.json"))
    ccd_co2 = CcdCurve(os.path.join(REPO_ROOT, "archive", "ccd", "co2_linked_ccd_curve.json"))

    print("Fetching BRIDGE-Valdes OTEMP manifest...")
    otemp_manifest = fetch_otemp_manifest()
    otemp_var = next(v for v in otemp_manifest["variables"] if v["id"] == "OTEMP")
    otemp_sentinel = otemp_manifest["no_data_sentinel"]
    otemp_res = otemp_manifest["resolutions"][0]
    frames = sorted(otemp_manifest["frames"], key=lambda f: f["age_ma"])
    print(f"  {len(frames)} frames, ages {frames[0]['age_ma']}-{frames[-1]['age_ma']} Ma")

    print(f"Fetching/caching {len(frames)} OTEMP frames (layer 0)...")
    t0 = time.time()
    frame_layers = {}
    for k, fr in enumerate(frames):
        frame_layers[fr["id"]] = fetch_otemp_frame(otemp_manifest, fr["id"])
        if (k + 1) % 20 == 0 or k == len(frames) - 1:
            print(f"  {k + 1}/{len(frames)} ({time.time() - t0:.1f}s)")

    # Grid points: native 1deg basement-age grid, decimated by --stride,
    # keeping only cells with a valid (non-sentinel) Basement Age.
    js = range(0, nlat_age, args.stride)
    is_ = range(0, nlon_age, args.stride)
    points = []
    for j in js:
        for i in is_:
            if valid_grid[j, i]:
                lon, lat = grid_lonlat(nlon_age, nlat_age, i, j)
                points.append((lon, lat, float(age_grid[j, i])))
    if args.limit:
        points = points[: args.limit]
    print(f"{len(points)} ocean grid points at stride={args.stride}")

    results = []
    t0 = time.time()
    n_no_plate = 0
    for k, (lon, lat, basement_age_ma) in enumerate(points):
        assignment = assign_plate(polygons, bounds, table, lon, lat, 0.0)
        if assignment is None:
            n_no_plate += 1
            continue
        frame_point = create_unbounded_plate_frame_point(assignment, table, lon, lat, 0.0)

        layers = []  # (decompacted_thickness_m, phi0, decay_m, grain_density), youngest first
        used_frames = [fr for fr in frames if fr["age_ma"] <= basement_age_ma]
        last_probs = None
        for idx, fr in enumerate(used_frames):
            pos = position_at(frame_point, table, fr["age_ma"])
            if pos is None:
                continue
            p_lon, p_lat = pos
            otemp_c = sample_otemp(
                frame_layers[fr["id"]], otemp_var, otemp_sentinel, p_lon, p_lat,
                otemp_res["nlon"], otemp_res["nlat"],
            )
            crustal_age_ma = basement_age_ma - fr["age_ma"]
            ocean_depth_km = age_to_depth_km(crustal_age_ma)

            ccd_km = ccd_published.at(fr["age_ma"])
            if ccd_km is None:
                ccd_km = ccd_co2.at(fr["age_ma"])

            if ccd_km is None or np.isnan(otemp_c):
                probs = last_probs  # carry the last valid mixture forward rather than drop to zero
            else:
                probs = classify_lithology_probabilistic(ocean_depth_km, ccd_km, otemp_c)
                last_probs = probs

            # This layer spans from fr's own age out to the NEXT OLDER used
            # frame's age (or to basement_age_ma for the last one) -- the
            # layer deposited across that interval is characterized by this
            # (younger-edge) frame's own climate/classification.
            next_age = used_frames[idx + 1]["age_ma"] if idx + 1 < len(used_frames) else basement_age_ma
            dt_kyr = max(0.0, next_age - fr["age_ma"]) * 1000
            if probs is None or dt_kyr <= 0:
                continue

            rate_cm_kyr = sum(probs[c] * RATE_CM_KYR[c] for c in RATE_CM_KYR)
            if args.lat_correction:
                rate_cm_kyr *= latitude_rate_multiplier(abs(p_lat))  # step's own PALEO-latitude
            phi0 = sum(probs[c] * COMPACTION[c]["phi0"] for c in COMPACTION)
            decay_m = sum(probs[c] * COMPACTION[c]["decay_m"] for c in COMPACTION)
            grain = sum(probs[c] * COMPACTION[c]["grain_density"] for c in COMPACTION)
            decompacted_m = (rate_cm_kyr / 100.0) * dt_kyr
            layers.append((decompacted_m, phi0, decay_m, grain))

        predicted_thickness_m = compact_column(layers)
        decompacted_thickness_m = sum(l[0] for l in layers)
        results.append({
            "lon": lon, "lat": lat, "basement_age_ma": basement_age_ma,
            "predicted_thickness_m": predicted_thickness_m,
            "decompacted_thickness_m": decompacted_thickness_m,
        })

        if (k + 1) % 1000 == 0:
            elapsed = time.time() - t0
            rate = (k + 1) / elapsed
            eta = (len(points) - k - 1) / rate if rate > 0 else float("nan")
            print(f"  {k + 1}/{len(points)} points ({elapsed:.0f}s elapsed, ETA {eta:.0f}s)")

    print(f"Done: {len(results)} points computed, {n_no_plate} had no plate assignment.")
    out_name = "predicted_thickness_latcorrected.json" if args.lat_correction else "predicted_thickness.json"
    output_path = os.path.join(os.path.dirname(__file__), "data", out_name)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        json.dump({"stride": args.stride, "lat_correction": args.lat_correction, "points": results}, f)
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
