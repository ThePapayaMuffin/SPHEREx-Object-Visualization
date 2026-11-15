"""Catalogue stars in a patch, for overlays: Gaia DR3 (optical) and CatWISE2020 (infrared).

Positions are moved to the date of the SPHEREx frames using each source's own
catalogued proper motion (Gaia positions are epoch J2016.0; CatWISE2020 motion-fit
positions are epoch MJD 57170, ~2015.4). Queried from VizieR, trying mirrors in
order because the main CDS host has been returning 404s. Cached on disk.
"""
import math
import time

import astropy.units as u
import numpy as np
from astropy.coordinates import SkyCoord
from astropy.time import Time
from astroquery.vizier import Vizier

from . import cache, config

SERVERS = ["vizier.cfa.harvard.edu", "vizier.idia.ac.za", "vizier.cds.unistra.fr"]
GAIA, CATWISE = "I/355/gaiadr3", "II/365/catwise"
GAIA_EPOCH = Time(2016.0, format="jyear").mjd
CATWISE_EPOCH = 57170.0
MAX_PER_CATALOGUE = 400
# Only sources SPHEREx could plausibly show in a single exposure, so the overlay stays readable.
# (WISE 0855 itself is W2 ~ 13.9.) Fainter catalogue entries are dropped.
GAIA_MAX_G, CATWISE_MAX_W2 = 19.0, 15.5


def _query(catalog: str, ra: float, dec: float, width: float, columns: list[str]):
    last = None
    for server in SERVERS:
        try:
            v = Vizier(columns=columns, row_limit=5000, timeout=30)
            v.VIZIER_SERVER = server
            res = v.query_region(SkyCoord(ra, dec, unit="deg"), width=width * u.deg, catalog=catalog)
            return res[0] if len(res) else []
        except Exception as e:  # noqa: BLE001 - try the next mirror
            last = e
    raise RuntimeError(f"VizieR unreachable ({str(last)[:120]})")


def _num(v, default=0.0) -> float:
    if v is np.ma.masked:  # blank catalogue value
        return default
    try:
        f = float(v)
        return default if math.isnan(f) else f
    except (TypeError, ValueError):
        return default


def _move(ra, dec, pmra_mas, pmdec_mas, years):
    """Linear proper motion; fine for ~10 yr over a 0.3 deg patch."""
    return (ra + pmra_mas * years / 3.6e6 / math.cos(math.radians(dec)), dec + pmdec_mas * years / 3.6e6)


def field_stars(ra: float, dec: float, fov: float, epoch_mjd: float) -> dict:
    if config.FAKE:
        return {"epochMjd": epoch_mjd, "objects": [], "notes": ["Catalogue overlays are off with synthetic data."]}
    path = config.CACHE / "field" / f"{cache.key(GAIA_MAX_G, CATWISE_MAX_W2, round(ra, 4), round(dec, 4), round(fov, 3), round(epoch_mjd))}.json"
    hit = cache.json_get(path)
    if hit:
        return hit

    width, objects, notes = fov * 1.05, [], []
    t0 = time.time()
    try:
        g = _query(GAIA, ra, dec, width, ["Source", "RA_ICRS", "DE_ICRS", "Gmag", "pmRA", "pmDE"])
        yrs = (epoch_mjd - GAIA_EPOCH) / 365.25
        rows = sorted((r for r in g if _num(r["Gmag"], 99) <= GAIA_MAX_G), key=lambda r: _num(r["Gmag"], 99))[:MAX_PER_CATALOGUE] if len(g) else []
        for r in rows:
            p = _move(_num(r["RA_ICRS"]), _num(r["DE_ICRS"]), _num(r["pmRA"]), _num(r["pmDE"]), yrs)
            objects.append({"name": f"Gaia DR3 {r['Source']}", "ra": round(p[0], 7), "dec": round(p[1], 7),
                            "mag": round(_num(r["Gmag"], 99), 2), "band": "G", "source": "gaia"})
    except Exception as e:  # noqa: BLE001
        notes.append(f"Gaia DR3 unavailable: {e}")
    try:
        # Asking VizieR for specific CatWISE columns returns nothing, so take all ("**").
        c = _query(CATWISE, ra, dec, width, ["**"])
        yrs = (epoch_mjd - CATWISE_EPOCH) / 365.25
        rows = sorted((r for r in c if _num(r["W2mproPM"], 99) <= CATWISE_MAX_W2), key=lambda r: _num(r["W2mproPM"], 99))[:MAX_PER_CATALOGUE] if len(c) else []
        for r in rows:  # CatWISE proper motions are in arcsec/yr
            p = _move(_num(r["RAPMdeg"]), _num(r["DEPMdeg"]), _num(r["pmRA"]) * 1000, _num(r["pmDE"]) * 1000, yrs)
            objects.append({"name": f"CWISE {r['Name']}", "ra": round(p[0], 7), "dec": round(p[1], 7),
                            "mag": round(_num(r["W2mproPM"], 99), 2), "band": "W2", "source": "catwise"})
    except Exception as e:  # noqa: BLE001
        notes.append(f"CatWISE2020 unavailable: {e}")

    out = {"epochMjd": epoch_mjd, "objects": objects, "notes": notes, "seconds": round(time.time() - t0, 1),
           "limits": {"gaia_G": GAIA_MAX_G, "catwise_W2": CATWISE_MAX_W2}}
    if not notes:  # only cache complete answers
        cache.json_put(path, out)
    return out
