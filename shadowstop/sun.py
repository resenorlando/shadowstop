"""Sun position from latitude, longitude and UTC time.

NOAA solar-calculator equations (Meeus-based); accurate to well under 0.1 degree,
which is far finer than the geometry we feed it. Azimuth is clockwise from north.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone


def _julian_day(dt: datetime) -> float:
    dt = dt.astimezone(timezone.utc)
    return dt.timestamp() / 86400.0 + 2440587.5


def sun_position(lat: float, lon: float, dt_utc: datetime) -> tuple[float, float]:
    """Return (azimuth_deg, elevation_deg) of the sun. Elevation includes standard refraction."""
    jd = _julian_day(dt_utc)
    t = (jd - 2451545.0) / 36525.0

    l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360.0
    m = 357.52911 + t * (35999.05029 - 0.0001537 * t)
    e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
    mr = math.radians(m)
    c = (math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t))
         + math.sin(2 * mr) * (0.019993 - 0.000101 * t)
         + math.sin(3 * mr) * 0.000289)
    true_long = l0 + c
    omega = math.radians(125.04 - 1934.136 * t)
    app_long = math.radians(true_long - 0.00569 - 0.00478 * math.sin(omega))
    eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
    eps = math.radians(eps0 + 0.00256 * math.cos(omega))
    decl = math.asin(math.sin(eps) * math.sin(app_long))

    y = math.tan(eps / 2) ** 2
    l0r = math.radians(l0)
    eq_time = 4 * math.degrees(
        y * math.sin(2 * l0r) - 2 * e * math.sin(mr) + 4 * e * y * math.sin(mr) * math.cos(2 * l0r)
        - 0.5 * y * y * math.sin(4 * l0r) - 1.25 * e * e * math.sin(2 * mr))  # minutes

    utc = dt_utc.astimezone(timezone.utc)
    minutes = utc.hour * 60 + utc.minute + utc.second / 60.0
    true_solar = (minutes + eq_time + 4 * lon) % 1440
    ha = true_solar / 4 - 180
    if ha < -180:
        ha += 360
    har = math.radians(ha)
    latr = math.radians(lat)

    cos_zen = math.sin(latr) * math.sin(decl) + math.cos(latr) * math.cos(decl) * math.cos(har)
    zen = math.degrees(math.acos(max(-1.0, min(1.0, cos_zen))))
    elev = 90.0 - zen
    az = (math.degrees(math.atan2(math.sin(har),
                                  math.cos(har) * math.sin(latr) - math.tan(decl) * math.cos(latr))) + 180.0) % 360.0

    # Atmospheric refraction (NOAA approximation)
    if elev > 85:
        refr = 0.0
    elif elev > 5:
        te = math.tan(math.radians(elev))
        refr = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5
    elif elev > -0.575:
        refr = 1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)))
    else:
        refr = -20.772 / math.tan(math.radians(elev))
    elev += refr / 3600.0
    return az, elev


def sun_vector(az_deg: float, el_deg: float) -> tuple[float, float, float]:
    """Unit vector pointing TOWARDS the sun, in local x=east, y=north, z=up."""
    az, el = math.radians(az_deg), math.radians(el_deg)
    return (math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el))


def local_to_utc(date_str: str, hh: int, mm: int, utc_offset: float) -> datetime:
    y, mo, d = (int(p) for p in date_str.split("-"))
    local = datetime(y, mo, d, hh, mm, tzinfo=timezone.utc)
    return local - timedelta(hours=utc_offset)
