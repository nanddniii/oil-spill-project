"""
Synthetic AIS dataset for Member 3 development/testing.

No real AIS feed is wired into the repository yet (Member 2's origin
output is also still mocked), so this module produces a small, deterministic
synthetic AIS record set that exercises every scenario called out in the
Member 3 spec:

    - vessel close to spill origin
    - vessel far from origin
    - vessel present at the wrong time
    - vessel whose trajectory passes near the origin
    - vessel moving away from the origin
    - vessel with an AIS transmission gap

Each record matches the schema:
    mmsi, vessel_name, timestamp (ISO-8601 str), latitude, longitude,
    speed (knots), heading (degrees), vessel_type

Normal AIS reporting cadence here is 5 minutes (a realistic interval),
matched to the default gap_threshold_minutes (10) in config/ais_config.py
so only genuinely missing pings are flagged as anomalies -- not the
regular reporting interval itself.
"""

from datetime import datetime, timedelta

# Mock spill origin/time used across the demo dataset and tests. Matches the
# shape Member 2's real output is expected to have.
MOCK_ORIGIN = {"latitude": 12.84, "longitude": 74.62}
MOCK_UNCERTAINTY_KM = 3.5
MOCK_SPILL_TIME = "2026-08-20T14:00:00"


def _iso(base: datetime, minutes: int) -> str:
    return (base + timedelta(minutes=minutes)).isoformat()


def _lerp(a, b, t):
    return a + (b - a) * t


def _vessel_track(mmsi, name, vessel_type, waypoints, spill_time, step_minutes=5):
    """
    Build evenly-spaced (every `step_minutes`) AIS pings by interpolating
    between `waypoints` = [(minute_offset, lat, lon, speed, heading), ...].
    Any waypoint pair can be skipped over (no interpolated pings emitted)
    by passing skip_after=True on this helper's caller -- see MV CLOSEWATCH
    below for the deliberate transmission gap.
    """
    records = []
    for i in range(len(waypoints) - 1):
        m0, lat0, lon0, spd0, hdg0 = waypoints[i]
        m1, lat1, lon1, spd1, hdg1 = waypoints[i + 1]
        span = m1 - m0
        steps = max(1, span // step_minutes)
        for s in range(steps + (1 if i == len(waypoints) - 2 else 0)):
            t = s / steps
            minute = m0 + span * t
            records.append({
                "mmsi": mmsi,
                "vessel_name": name,
                "timestamp": _iso(spill_time, minute),
                "latitude": round(_lerp(lat0, lat1, t), 5),
                "longitude": round(_lerp(lon0, lon1, t), 5),
                "speed": round(_lerp(spd0, spd1, t), 1),
                "heading": round(_lerp(hdg0, hdg1, t), 1),
                "vessel_type": vessel_type,
            })
    return records


def get_synthetic_ais_dataset() -> list:
    """
    Returns a synthetic AIS dataset covering the scenarios above.
    Deterministic (no randomness) so tests are reproducible.
    """
    spill_time = datetime.fromisoformat(MOCK_SPILL_TIME)
    origin_lat, origin_lon = MOCK_ORIGIN["latitude"], MOCK_ORIGIN["longitude"]

    records = []

    # --- Scenario 1: vessel close to origin, shortly before spill, with a
    #     genuine AIS transmission gap straddling the spill time ---
    records += _vessel_track(
        "111111111", "MV CLOSEWATCH", "Tanker",
        waypoints=[
            (-30, origin_lat + 0.06, origin_lon + 0.05, 12.0, 220),
            (-10, origin_lat + 0.01, origin_lon + 0.005, 11.0, 230),
        ],
        spill_time=spill_time,
    )
    # deliberate 35-minute gap: no pings from -10 to +25
    records += _vessel_track(
        "111111111", "MV CLOSEWATCH", "Tanker",
        waypoints=[
            (25, origin_lat - 0.02, origin_lon - 0.03, 10.5, 235),
            (45, origin_lat - 0.05, origin_lon - 0.06, 10.0, 235),
        ],
        spill_time=spill_time,
    )

    # --- Scenario 2: vessel far from origin the whole time ---
    records += _vessel_track(
        "222222222", "MV FARAWAY", "Cargo",
        waypoints=[
            (-30, origin_lat + 1.8, origin_lon + 1.6, 14.0, 90),
            (0, origin_lat + 1.75, origin_lon + 1.55, 14.0, 90),
            (30, origin_lat + 1.7, origin_lon + 1.5, 14.0, 90),
        ],
        spill_time=spill_time,
    )

    # --- Scenario 3: vessel near origin but at the WRONG time (way outside window) ---
    records += _vessel_track(
        "333333333", "MV WRONGTIME", "Tanker",
        waypoints=[
            (-600, origin_lat + 0.01, origin_lon + 0.01, 9.0, 180),
            (-570, origin_lat, origin_lon, 9.0, 180),
        ],
        spill_time=spill_time,
    )

    # --- Scenario 4: vessel trajectory PASSES near origin (pings straddle it) ---
    records += _vessel_track(
        "444444444", "MV PASSTHROUGH", "Bulk Carrier",
        waypoints=[
            (-20, origin_lat + 0.15, origin_lon - 0.15, 16.0, 300),
            (-5, origin_lat + 0.02, origin_lon - 0.01, 16.0, 300),
            (10, origin_lat - 0.10, origin_lon + 0.12, 16.0, 300),
        ],
        spill_time=spill_time,
    )

    # --- Scenario 5: vessel moving AWAY from origin (was near before, now leaving) ---
    records += _vessel_track(
        "555555555", "MV DEPARTING", "Fishing",
        waypoints=[
            (-15, origin_lat + 0.01, origin_lon + 0.01, 13.0, 45),
            (5, origin_lat + 0.25, origin_lon + 0.28, 13.5, 45),
            (25, origin_lat + 0.55, origin_lon + 0.60, 14.0, 45),
        ],
        spill_time=spill_time,
    )

    # --- Duplicate record injected on purpose (preprocessing must dedupe) ---
    records.append(dict(records[0]))

    # --- Invalid record injected on purpose (preprocessing must catch, not silently drop) ---
    records.append({
        "mmsi": "666666666",
        "vessel_name": "MV BADDATA",
        "timestamp": "not-a-timestamp",
        "latitude": 999,       # out of range
        "longitude": origin_lon,
        "speed": 10.0,
        "heading": 100,
        "vessel_type": "Tanker",
    })

    return records
