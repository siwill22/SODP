#!/usr/bin/env python3
"""Export PALEOMAP's static polygons + rotations for browser-side plate
assignment (Scotese plate trajectory, CONTEXT.md / ADR-0002).

The Scotese static polygons already in Geode's own archive are continental-
only (245 polygons, per ADR-0002) -- no oceanic coverage at all, useless for
a tool whose whole premise is querying ocean points. The PALEOMAP Global
Plate Model (Scotese's own, via GPlates) is different: verified directly by
summing polygon area, its present-day-valid polygons cover ~100% of the
sphere (not just continents) -- see the 2026-09-08 conversation where this
was confirmed with pygplates before committing to it. Its own
PALEOMAP_PlateModel.rot sits alongside the polygons in the same source
directory, so this is a matched, single-provenance pair -- NOT the kind of
cross-model mismatch ADR-0002 has to reason its way past for Scotese-vs-
Seton; that pairing is unrelated to this one and still stands on its own.

Output format matches Geode's own prep_staticpolygons.py / prep_coastlines.py
exactly (ESSP v1 geometry.bin + {ages, anchor, plates} rotations.json) so
Geode's core/staticPolygons.ts and core/rotation.ts read this with zero
modification -- ADR-0001's whole premise. This script is self-contained
rather than importing Geode's prep/ modules -- ADR-0001 chose a one-time
copy over a shared dependency between the two repos, and that applies to
prep tooling too, not just the viewer's core/.

KNOWN GAP: continental/oceanic classification. Geode's own
prep_staticpolygons.py derives this from a per-Reconstruction-Model
feature-type mapping (CONTINENTAL_FEATURE_TYPES), checked directly against
each model's own shapefile. PALEOMAP's features are ~99.6% (469/471)
'gpml:UnclassifiedFeature' -- there is no equivalent feature-type signal to
check here. Every polygon is written with continental=False rather than
guessed from plate-id numbering conventions, which would look derived but
wouldn't be. This is informational metadata only -- core/staticPolygons.ts's
assignPlate() never filters on it, SODP only ever queries ocean points to
begin with -- but it means `continental` on every PlateAssignment/
PlateFramePoint from this source is not meaningful. Fix by sourcing a real
per-feature continental/oceanic classification if that ever becomes load-
bearing for something.

Output:
  archive/reconstructions/scotese-paleomap/manifest.json
  archive/reconstructions/scotese-paleomap/staticpolygons/geometry.bin
  archive/reconstructions/scotese-paleomap/staticpolygons/rotations.json

Usage:
    python prep_scotese_static_polygons.py \\
        --polygons /path/to/PALEOMAP_PlatePolygons.gpml \\
        --rotations /path/to/PALEOMAP_PlateModel.rot
"""

import argparse
import json
import math
import struct
from pathlib import Path

import numpy as np
import pygplates

DEFAULT_AGE_MAX = 340.0  # safely above the Seton et al. (2020) grid's own
# max basement age (338.68 Ma when this was written) -- Preserved Crust
# queries never need a rotation older than a point's own basement age
# (ADR-0002), so nothing past this is reachable.
DEFAULT_AGE_STEP = 1.0  # matches core/rotation.ts's rotationAt(), which
# slerps between bracketing 1 Ma samples.
ANCHOR = 0


def finite_or(value, fallback):
    return fallback if not math.isfinite(value) else value


def export_geometry(gpml_path, out_path):
    features = pygplates.FeatureCollection(str(gpml_path))

    polys = []
    plate_ids = set()
    n_skipped_non_polygon = 0
    for feature in features:
        plate_id = feature.get_reconstruction_plate_id()
        begin, end = feature.get_valid_time()
        appear = finite_or(begin, 1.0e9)
        disappear = finite_or(end, -1.0e9)

        for geom in feature.get_all_geometries():
            if not isinstance(geom, pygplates.PolygonOnSphere):
                n_skipped_non_polygon += 1
                continue
            pts = np.array([p.to_xyz() for p in geom.get_points()], dtype=np.float64)
            if len(pts) < 3:
                continue
            polys.append((plate_id, False, appear, disappear, pts.astype(np.float32)))
            plate_ids.add(plate_id)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "wb") as fh:
        fh.write(b"ESSP")
        fh.write(struct.pack("<II", 1, len(polys)))
        for plate_id, continental, appear, disappear, pts in polys:
            fh.write(struct.pack("<iBxxxffI", plate_id, 1 if continental else 0,
                                  appear, disappear, len(pts)))
            pts.tofile(fh)

    npts = sum(len(p) for _, _, _, _, p in polys)
    mb = out_path.stat().st_size / 1024 / 1024
    print(f"  static polygons  {len(polys)} polygons, {npts} points, {mb:.2f} MB"
          f"  ({n_skipped_non_polygon} non-polygon geometries skipped)")
    print(f"  plates           {len(plate_ids)} distinct ids")

    # Present-day area coverage, as a live sanity check that this really is
    # oceanic-inclusive and not silently back to a continental-only set --
    # the whole reason this source was chosen over Geode's archived Scotese.
    total_area = 0.0
    for feature in features:
        if not feature.is_valid_at_time(0):
            continue
        for geom in feature.get_all_geometries():
            if isinstance(geom, pygplates.PolygonOnSphere):
                total_area += geom.get_area()
    frac = total_area / (4 * math.pi)
    print(f"  present-day area coverage: {frac * 100:.1f}% of sphere"
          f"{'  (WARNING: looks continental-only, expected ~100%)' if frac < 0.8 else ''}")

    return sorted(plate_ids)


def export_rotations(rot_path, plate_ids, ages, out_path):
    model = pygplates.RotationModel([str(rot_path)])

    plates = {}
    stuck = []
    for pid in plate_ids:
        quats = []
        for age in ages:
            rot = model.get_rotation(float(age), int(pid), anchor_plate_id=ANCHOR)
            plat, plon, angle_deg = rot.get_lat_lon_euler_pole_and_angle_degrees()
            pole_lat, pole_lon, angle = map(math.radians, (plat, plon, angle_deg))
            clat = math.cos(pole_lat)
            ax = clat * math.cos(pole_lon)
            ay = clat * math.sin(pole_lon)
            az = math.sin(pole_lat)
            s = math.sin(angle / 2.0)
            quats.append([round(ax * s, 7), round(ay * s, 7), round(az * s, 7),
                          round(math.cos(angle / 2.0), 7)])
        if all(q == quats[0] for q in quats):
            stuck.append(pid)
        plates[str(pid)] = quats

    out = {"ages": [float(a) for a in ages], "anchor": ANCHOR, "plates": plates}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out))
    mb = out_path.stat().st_size / 1024 / 1024
    print(f"  rotations        {len(plates)} plates x {len(ages)} ages, {mb:.2f} MB")

    if stuck:
        print(f"  ! {len(stuck)} plate(s) have IDENTICAL rotation at every age from "
              f"{ages[0]:.0f}-{ages[-1]:.0f} Ma -- either genuinely static (fine near "
              f"the anchor plate) or missing from PALEOMAP_PlateModel.rot (pygplates "
              f"returns identity silently, it does not error): {sorted(stuck)}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--polygons", type=Path, required=True)
    ap.add_argument("--rotations", type=Path, required=True)
    ap.add_argument("--age-max", type=float, default=DEFAULT_AGE_MAX)
    ap.add_argument("--age-step", type=float, default=DEFAULT_AGE_STEP)
    ap.add_argument("--out", type=Path, default=Path("archive/reconstructions/scotese-paleomap"))
    args = ap.parse_args()

    print(f"loading {args.polygons}")
    plate_ids = export_geometry(args.polygons, args.out / "staticpolygons" / "geometry.bin")

    ages = np.arange(0.0, args.age_max + args.age_step / 2, args.age_step)
    print(f"\nresolving rotations 0-{args.age_max:.0f} Ma from {args.rotations}")
    export_rotations(args.rotations, plate_ids, ages, args.out / "staticpolygons" / "rotations.json")

    manifest = {
        "id": "scotese-paleomap",
        "name": "Scotese PALEOMAP Global Plate Model",
        "citation": "Scotese, C.R., PALEOMAP Global Plate Model (via GPlates), "
                     "PALEOMAP_PlatePolygons.gpml + PALEOMAP_PlateModel.rot",
        "source_fetch": "local files, not gprm-fetched -- see --polygons/--rotations "
                         "args this was generated with",
        "age_min": 0.0,
        "age_max": float(args.age_max),
        "has_boundaries": False,
        "has_static_polygons": True,
        "static_polygons": {
            "geometry": "staticpolygons/geometry.bin",
            "rotations": "staticpolygons/rotations.json",
        },
        "known_gaps": [
            "continental/oceanic flag is not meaningful on this source -- every "
            "polygon is written continental=False; see this script's module doc.",
        ],
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"\nwrote {args.out / 'manifest.json'}")


if __name__ == "__main__":
    main()
