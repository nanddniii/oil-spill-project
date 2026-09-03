"""
AIS preprocessing for Member 3.

Takes raw AIS records (dicts) and turns them into clean, validated,
vessel-grouped, time-sorted data ready for candidate filtering /
distance / trajectory / gap analysis. Invalid records are never silently
dropped -- they are reported back via `errors` so callers (and Member 4's
API layer) can surface data-quality issues instead of hiding them.
"""

from datetime import datetime, timezone
from collections import defaultdict


REQUIRED_FIELDS = ("mmsi", "timestamp", "latitude", "longitude")


def _parse_timestamp(value):
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value))
        except (ValueError, TypeError):
            return None

    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def validate_record(record: dict) -> tuple:
    """
    Validate a single AIS record.
    Returns (is_valid: bool, error: str | None).
    """
    for field in REQUIRED_FIELDS:
        if record.get(field) in (None, ""):
            return False, f"missing required field '{field}'"

    lat, lon = record.get("latitude"), record.get("longitude")
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return False, "latitude/longitude are not numeric"

    if not (-90 <= lat <= 90):
        return False, f"latitude {lat} out of range [-90, 90]"
    if not (-180 <= lon <= 180):
        return False, f"longitude {lon} out of range [-180, 180]"

    if _parse_timestamp(record.get("timestamp")) is None:
        return False, f"invalid timestamp '{record.get('timestamp')}'"

    speed = record.get("speed")
    if speed is not None:
        try:
            if float(speed) < 0:
                return False, f"negative speed {speed}"
        except (TypeError, ValueError):
            return False, f"speed '{speed}' is not numeric"

    return True, None


def _record_key(record: dict) -> tuple:
    """Identity used for de-duplication."""
    return (
        record.get("mmsi"),
        str(record.get("timestamp")),
        round(float(record.get("latitude")), 6),
        round(float(record.get("longitude")), 6),
    )


def preprocess_ais_records(raw_records: list) -> dict:
    """
    Validate, de-duplicate, normalize, sort, and group raw AIS records.

    Returns:
        {
            "vessels": { mmsi: [sorted, normalized records...] },
            "errors": [ {"record": <raw record>, "reason": <str>}, ... ],
            "valid_count": int,
            "invalid_count": int,
            "duplicate_count": int,
        }
    """
    errors = []
    seen = set()
    duplicate_count = 0
    by_vessel = defaultdict(list)

    for raw in raw_records:
        is_valid, reason = validate_record(raw)
        if not is_valid:
            errors.append({"record": raw, "reason": reason})
            continue

        key = _record_key(raw)
        if key in seen:
            duplicate_count += 1
            continue
        seen.add(key)

        normalized = {
            "mmsi": str(raw["mmsi"]),
            "vessel_name": raw.get("vessel_name", "UNKNOWN"),
            "timestamp": _parse_timestamp(raw["timestamp"]),
            "latitude": float(raw["latitude"]),
            "longitude": float(raw["longitude"]),
            "speed": float(raw["speed"]) if raw.get("speed") is not None else None,
            "heading": float(raw["heading"]) if raw.get("heading") is not None else None,
            "vessel_type": raw.get("vessel_type", "UNKNOWN"),
        }
        by_vessel[normalized["mmsi"]].append(normalized)

    for mmsi in by_vessel:
        by_vessel[mmsi].sort(key=lambda r: r["timestamp"])

    return {
        "vessels": dict(by_vessel),
        "errors": errors,
        "valid_count": sum(len(v) for v in by_vessel.values()),
        "invalid_count": len(errors),
        "duplicate_count": duplicate_count,
    }


def detect_gaps(records: list, gap_threshold_minutes: float) -> list:
    """
    Detect AIS transmission gaps within a single vessel's sorted record list.

    A gap is any interval between two consecutive pings that exceeds
    `gap_threshold_minutes`. This is a neutral data-quality/anomaly signal
    only -- it is NOT proof of any wrongdoing on its own.

    Returns a list of:
        {"gap_start": iso str, "gap_end": iso str, "gap_duration_minutes": float}
    """
    gaps = []
    for prev, curr in zip(records, records[1:]):
        delta_minutes = (curr["timestamp"] - prev["timestamp"]).total_seconds() / 60.0
        if delta_minutes > gap_threshold_minutes:
            gaps.append({
                "gap_start": prev["timestamp"].isoformat(),
                "gap_end": curr["timestamp"].isoformat(),
                "gap_duration_minutes": round(delta_minutes, 1),
            })
    return gaps
