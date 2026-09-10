"""
Python port of src/core/staticPolygons.ts + src/core/rotation.ts -- the
Scotese/PALEOMAP plate reconstruction machinery the live TS app uses for
Phase 2 Synthetic Cores. Ported deliberately (ADR-0020: "constants only, not
the pipeline" from pyBacktrack) rather than using pygplates against a
different plate model, so this validation script reconstructs points with
the EXACT SAME reconstruction the live app ships -- reading the same prepped
archive files (archive/reconstructions/scotese-paleomap/staticpolygons/
{geometry.bin,rotations.json}), not re-deriving anything from raw PALEOMAP
sources.

Every function here is a direct line-for-line port of its TS counterpart --
see the docstrings for the source file. No shortcuts, no pygplates.
"""
import json
import math
import struct
from dataclasses import dataclass

import numpy as np


# ---------------------------------------------------------------------------
# geometry.bin / rotations.json parsing -- staticPolygons.ts parseStaticPolygons()
# ---------------------------------------------------------------------------

@dataclass
class StaticPolygon:
    plate_id: int
    continental: bool
    begin_age: float  # larger Ma value: when this crust appeared
    end_age: float  # smaller Ma value, ~0
    points: np.ndarray  # (n, 3) present-day unit vectors, geographic frame


def parse_static_polygons(path: str) -> list[StaticPolygon]:
    with open(path, "rb") as f:
        buf = f.read()
    magic = buf[0:4].decode()
    if magic != "ESSP":
        raise ValueError(f"bad static-polygon magic: {magic}")
    version = struct.unpack_from("<I", buf, 4)[0]
    if version != 1:
        raise ValueError(f"static polygons are version {version}, expected 1")
    npolys = struct.unpack_from("<I", buf, 8)[0]

    polygons = []
    o = 12
    for _ in range(npolys):
        plate_id = struct.unpack_from("<i", buf, o)[0]; o += 4
        continental = buf[o] != 0; o += 4  # 1 byte + 3 padding
        begin_age = struct.unpack_from("<f", buf, o)[0]; o += 4
        end_age = struct.unpack_from("<f", buf, o)[0]; o += 4
        npts = struct.unpack_from("<I", buf, o)[0]; o += 4
        pts = np.frombuffer(buf, dtype="<f4", count=npts * 3, offset=o).reshape(npts, 3)
        o += npts * 3 * 4
        polygons.append(StaticPolygon(plate_id, continental, begin_age, end_age, pts))
    return polygons


@dataclass
class RotationTable:
    ages: list[float]
    anchor: int
    plates: dict[str, np.ndarray]  # plateId(str) -> (nages, 4) quaternions [x,y,z,w]


def load_rotations(path: str) -> RotationTable:
    with open(path) as f:
        d = json.load(f)
    plates = {k: np.array(v, dtype=np.float64) for k, v in d["plates"].items()}
    return RotationTable(ages=d["ages"], anchor=d["anchor"], plates=plates)


# ---------------------------------------------------------------------------
# rotation.ts -- rotationAt (slerp), rotateVector, conjugateQuaternion
# ---------------------------------------------------------------------------

def rotation_at(table: RotationTable, plate_id: int, age: float) -> np.ndarray:
    """Slerp a plate's rotation between the bracketing 1 Ma samples. Returns
    identity [0,0,0,1] for a plate id with no rotation entry (rotation.ts's
    own fallback)."""
    quats = table.plates.get(str(plate_id))
    if quats is None:
        return np.array([0.0, 0.0, 0.0, 1.0])

    ages = table.ages
    lo = max(0, min(len(ages) - 2, int(math.floor((age - ages[0]) / (ages[1] - ages[0])))))
    t = max(0.0, min(1.0, (age - ages[lo]) / (ages[lo + 1] - ages[lo])))

    a = quats[lo].copy()
    b = quats[lo + 1]

    d = float(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])
    if d < 0:
        a = -a
        d = -d

    if d > 0.9995:
        v = a + t * (b - a)
        n = np.linalg.norm(v) or 1.0
        return v / n

    theta = math.acos(min(1.0, d))
    s = math.sin(theta)
    w0 = math.sin((1 - t) * theta) / s
    w1 = math.sin(t * theta) / s
    return w0 * a + w1 * b


def rotate_vector(q: np.ndarray, v: np.ndarray) -> np.ndarray:
    """v' = q*v*q^-1, expanded (rotation.ts's rotateVector, vectorized over
    the last axis for a single q and a single v, or an (N,4)/(N,3) batch)."""
    qx, qy, qz, qw = q[..., 0], q[..., 1], q[..., 2], q[..., 3]
    x, y, z = v[..., 0], v[..., 1], v[..., 2]
    tx = 2 * (qy * z - qz * y)
    ty = 2 * (qz * x - qx * z)
    tz = 2 * (qx * y - qy * x)
    rx = x + qw * tx + (qy * tz - qz * ty)
    ry = y + qw * ty + (qz * tx - qx * tz)
    rz = z + qw * tz + (qx * ty - qy * tx)
    return np.stack([rx, ry, rz], axis=-1)


def conjugate_quaternion(q: np.ndarray) -> np.ndarray:
    return np.array([-q[0], -q[1], -q[2], q[3]])


# ---------------------------------------------------------------------------
# lon/lat <-> geographic-frame XYZ -- staticPolygons.ts's private helpers
# ---------------------------------------------------------------------------

def lonlat_to_xyz(lon_deg: float, lat_deg: float) -> np.ndarray:
    lon_r, lat_r = math.radians(lon_deg), math.radians(lat_deg)
    cl = math.cos(lat_r)
    return np.array([cl * math.cos(lon_r), cl * math.sin(lon_r), math.sin(lat_r)])


def xyz_to_lonlat(v: np.ndarray) -> tuple[float, float]:
    r = np.linalg.norm(v) or 1.0
    lat = math.degrees(math.asin(max(-1.0, min(1.0, v[2] / r))))
    lon = math.degrees(math.atan2(v[1], v[0]))
    return lon, lat


# ---------------------------------------------------------------------------
# assignPlate() -- point-in-polygon with the centroid/radius pre-filter
# ---------------------------------------------------------------------------

def _spherical_triangle_signed_area(a, b, c) -> float:
    triple = (a[0] * (b[1] * c[2] - b[2] * c[1])
              - a[1] * (b[0] * c[2] - b[2] * c[0])
              + a[2] * (b[0] * c[1] - b[1] * c[0]))
    ab = float(np.dot(a, b))
    bc = float(np.dot(b, c))
    ca = float(np.dot(c, a))
    return 2 * math.atan2(triple, 1 + ab + bc + ca)


def _polygon_area(points: np.ndarray) -> float:
    n = len(points)
    if n < 3:
        return 0.0
    a = points[0]
    area = 0.0
    for i in range(1, n - 1):
        area += _spherical_triangle_signed_area(a, points[i], points[i + 1])
    return abs(area)


def _is_point_in_polygon(p: np.ndarray, points: np.ndarray) -> bool:
    """Tangent-plane winding test -- staticPolygons.ts's isPointInPolygon(),
    same hemisphere-limited caveat (only ever called after the centroid/
    radius pre-filter below)."""
    p_dot_p = float(np.dot(p, p))
    d = (points @ p) / p_dot_p
    tangents = points - d[:, None] * p
    norms = np.linalg.norm(tangents, axis=1)
    norms[norms == 0] = 1.0
    dirs = tangents / norms[:, None]

    a = dirs
    b = np.roll(dirs, -1, axis=0)
    cross = np.cross(a, b)
    sin_part = cross @ p
    cos_part = np.sum(a * b, axis=1)
    total = np.sum(np.arctan2(sin_part, cos_part))
    return abs(total) > math.pi


def _polygon_centroid(points: np.ndarray) -> np.ndarray:
    s = points.sum(axis=0)
    n = np.linalg.norm(s) or 1.0
    return s / n


def _polygon_radius(points: np.ndarray, centroid: np.ndarray) -> float:
    dots = np.clip(points @ centroid, -1.0, 1.0)
    return float(np.max(np.arccos(dots)))


@dataclass
class PolygonBounds:
    centroid: np.ndarray
    radius: float
    area: float


def precompute_bounds(polygons: list[StaticPolygon]) -> list[PolygonBounds]:
    out = []
    for poly in polygons:
        c = _polygon_centroid(poly.points)
        r = _polygon_radius(poly.points, c)
        a = _polygon_area(poly.points)
        out.append(PolygonBounds(c, r, a))
    return out


HALF_PI = math.pi / 2


@dataclass
class PlateAssignment:
    plate_id: int
    continental: bool
    begin_age: float


def assign_plate(
    polygons: list[StaticPolygon], bounds: list[PolygonBounds], table: RotationTable,
    lon: float, lat: float, reference_age: float = 0.0,
) -> PlateAssignment | None:
    """staticPolygons.ts's assignPlate() -- largest overlapping polygon wins,
    each candidate gated by a centroid+radius pre-filter before the real
    (hemisphere-limited) point-in-polygon test ever runs."""
    p = lonlat_to_xyz(lon, lat)

    best_area = -1.0
    best_poly = None
    for poly, b in zip(polygons, bounds):
        if reference_age > poly.begin_age or reference_age < poly.end_age:
            continue

        q_inv = conjugate_quaternion(rotation_at(table, poly.plate_id, reference_age))
        p_at_present = rotate_vector(q_inv, p)

        if b.radius < HALF_PI:
            ang = math.acos(max(-1.0, min(1.0, float(np.dot(p_at_present, b.centroid)))))
            if ang > b.radius:
                continue
        if not _is_point_in_polygon(p_at_present, poly.points):
            continue

        if b.area > best_area:
            best_area = b.area
            best_poly = poly

    if best_poly is None:
        return None
    return PlateAssignment(best_poly.plate_id, best_poly.continental, best_poly.begin_age)


@dataclass
class PlateFramePoint:
    plate_id: int
    continental: bool
    begin_age: float
    present_day_xyz: np.ndarray


def create_unbounded_plate_frame_point(
    assignment: PlateAssignment, table: RotationTable, lon: float, lat: float, reference_age: float = 0.0,
) -> PlateFramePoint:
    """createPlateFramePoint() + syntheticCore.ts's createUnboundedPlateFramePoint():
    begin_age forced up to the rotation table's own max age, so Basement Age
    (not the static polygon's own often-degenerate age field) is what bounds
    the walk -- see ADR-0002/syntheticCore.ts's module doc."""
    p = lonlat_to_xyz(lon, lat)
    q_inv = conjugate_quaternion(rotation_at(table, assignment.plate_id, reference_age))
    present_day_xyz = rotate_vector(q_inv, p)
    max_table_age = table.ages[-1]
    return PlateFramePoint(
        assignment.plate_id, assignment.continental,
        max(assignment.begin_age, max_table_age), present_day_xyz,
    )


def position_at(point: PlateFramePoint, table: RotationTable, age: float) -> tuple[float, float] | None:
    """staticPolygons.ts's positionAt() -- None if age exceeds this point's
    own begin_age (never reached in practice here since begin_age is forced
    to the table's max via create_unbounded_plate_frame_point)."""
    if age > point.begin_age:
        return None
    q = rotation_at(table, point.plate_id, age)
    xyz = rotate_vector(q, point.present_day_xyz)
    return xyz_to_lonlat(xyz)
