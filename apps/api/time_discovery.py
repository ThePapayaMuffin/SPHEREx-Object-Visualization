"""Time the ways of finding SPHEREx images at a position, run side by side.

Run:  .venv/Scripts/python time_discovery.py
"""
from concurrent.futures import ThreadPoolExecutor
import time

import astropy.units as u
from astropy.coordinates import SkyCoord
from astroquery.ipac.irsa import Irsa

ra, dec = 133.795129, -7.245147  # WISE 0855 catalogue position

QUERIES = {
    "TAP artifact JOIN plane (plan)": f"""
        SELECT 'https://irsa.ipac.caltech.edu/' || a.uri AS url,
               p.energy_bandpassname AS band, p.time_bounds_lower AS mjd
        FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid
        WHERE 1 = CONTAINS(POINT('ICRS', {ra}, {dec}), p.poly)
        ORDER BY p.time_bounds_lower""",
    "TAP obscore (no join)": f"""
        SELECT access_url, energy_bandpassname, t_min, obs_collection
        FROM spherex.obscore
        WHERE 1 = CONTAINS(POINT('ICRS', {ra}, {dec}), s_region)""",
}


def timed(name, fn, tries=8):
    """Retry IRSA 502s; report only the time of the attempt that succeeded."""
    for i in range(tries):
        t0 = time.time()
        try:
            return name, len(fn()), time.time() - t0, None, i
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                return name, None, time.time() - t0, e, i
            time.sleep(5)


def run_tap(item):
    name, adql = item
    return timed(name, lambda: Irsa.query_tap(adql).to_table())


def run_sia(_):
    return timed("SIA2 spherex_dr1", lambda: Irsa.query_sia(
        pos=(SkyCoord(ra, dec, unit="deg"), 1 * u.arcsec), collection="spherex_dr1"))


with ThreadPoolExecutor(3) as pool:
    futs = [pool.submit(run_tap, q) for q in QUERIES.items()] + [pool.submit(run_sia, None)]
    for f in futs:
        name, n, dt, err, retries = f.result()
        print(f"{name:34s} {dt:7.1f}s  rows={n}  retries={retries}"
              + (f"  ERROR {str(err)[:80]}" if err else ""))
