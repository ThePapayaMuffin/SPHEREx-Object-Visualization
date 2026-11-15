"""Find every SPHEREx spectral image that covers a sky position.

Returns plain dicts: {url, detector, mjd, release, obs_id}, sorted by time.
Results are cached for QUERY_TTL; if IRSA is down we fall back to an older
cached answer rather than failing (and say so in the metadata).
"""
import re
import time

import astropy.units as u
from astropy.coordinates import SkyCoord
from astroquery.ipac.irsa import Irsa

from . import cache, config


class IrsaUnavailable(RuntimeError):
    """IRSA did not answer after retries and nothing usable was cached."""


def _retry(fn):
    last = None
    for i in range(config.QUERY_RETRIES):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 - IRSA errors come in many types
            last = e
            if i < config.QUERY_RETRIES - 1:
                time.sleep(0.5 * 2 ** i)
    raise IrsaUnavailable(f"IRSA did not respond after {config.QUERY_RETRIES} tries: {str(last)[:200]}")


def _release(url: str, fallback: str) -> str:
    m = re.search(r"/spherex/([a-z]+\d+)/", url)
    return m.group(1) if m else fallback


def _row(url, band, mjd, obs_id, collection):
    return {
        "url": url,
        "detector": str(band).replace("SPHEREx-", ""),
        "mjd": float(mjd),
        "release": _release(url, collection.replace("spherex_", "")),
        "obs_id": str(obs_id),
    }


def _query_sia(ra: float, dec: float) -> list[dict]:
    pos = (SkyCoord(ra, dec, unit="deg"), 1 * u.arcsec)
    rows = []
    for col in config.RELEASES:
        t = _retry(lambda: Irsa.query_sia(pos=pos, collection=col))
        rows += [_row(str(r["access_url"]), r["energy_bandpassname"], r["t_min"], r["obs_id"], col)
                 for r in t]
    return rows


def _query_tap(ra: float, dec: float) -> list[dict]:
    adql = f"""
    SELECT 'https://irsa.ipac.caltech.edu/' || a.uri AS url,
           p.energy_bandpassname AS band, p.time_bounds_lower AS mjd, p.planeid AS obs_id
    FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid
    WHERE 1 = CONTAINS(POINT('ICRS', {ra}, {dec}), p.poly)"""
    t = _retry(lambda: Irsa.query_tap(adql).to_table())
    return [_row(str(r["url"]), r["band"], r["mjd"], r["obs_id"], "tap") for r in t]


def discover(ra: float, dec: float) -> tuple[list[dict], dict]:
    """Return (rows, meta). meta.source is 'live', 'cache', 'stale-cache' or 'fake'."""
    if config.FAKE:
        from .fake import fake_rows
        return fake_rows(), {"method": "fake", "releases": ["fake"], "source": "fake",
                             "queried_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "seconds": 0}
    path = config.CACHE / "queries" / f"{cache.key(config.DISCOVERY, config.RELEASES, round(ra, 4), round(dec, 4))}.json"
    fresh = cache.json_get(path, max_age=config.QUERY_TTL)
    if fresh:
        return fresh["rows"], {**fresh["meta"], "source": "cache"}

    query = _query_sia if config.DISCOVERY == "sia" else _query_tap
    try:
        t0 = time.time()
        rows = query(ra, dec)
    except IrsaUnavailable:
        stale = cache.json_get(path)
        if stale:
            return stale["rows"], {**stale["meta"], "source": "stale-cache"}
        raise

    seen, unique = set(), []
    for r in sorted(rows, key=lambda r: r["mjd"]):
        if r["url"] not in seen:
            seen.add(r["url"])
            unique.append(r)
    meta = {
        "method": config.DISCOVERY,
        "releases": config.RELEASES,
        "queried_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "seconds": round(time.time() - t0, 1),
    }
    cache.json_put(path, {"rows": unique, "meta": meta})
    return unique, {**meta, "source": "live"}
