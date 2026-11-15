"""Targets: the five challenge presets plus any name resolvable by CDS Sesame.

A target carries astrometry (position at a reference epoch + proper motion +
parallax), so we can say where it is *on the date of each SPHEREx exposure*.
That matters: WISE 0855 is ~2' from its catalogue position by 2025.

Preset astrometry was taken from Sesame/SIMBAD on 2026-11-15 (positions are at
epoch J2000, SIMBAD's convention) and is pinned here so presets work offline.
"""
import time
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from urllib.parse import quote

import astropy.units as u
import requests
from astropy.coordinates import Distance, SkyCoord
from astropy.time import Time

from . import cache, config

SESAME = "https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/S"


@dataclass
class Target:
    id: str
    name: str
    ra: float              # deg, ICRS, at `epoch`
    dec: float
    epoch: float           # Julian year of ra/dec
    pmra: float = 0.0      # mas/yr, includes cos(dec)
    pmdec: float = 0.0     # mas/yr
    plx: float = 0.0       # mas
    source: str = ""       # where the astrometry came from
    notes: str = ""        # what to expect in SPHEREx, honestly
    suggested_detector: str | None = None
    suggested_fov: float | None = None   # deg; tighter for faint targets so each pixel is big on screen

    @property
    def moves(self) -> bool:
        return abs(self.pmra) + abs(self.pmdec) > 0

    def position_at(self, mjd: float) -> SkyCoord:
        """Position on a given date (proper motion only; see note on parallax)."""
        if not self.moves:
            return SkyCoord(self.ra, self.dec, unit="deg")
        # Parallax is used as distance for correct space motion. The annual parallax
        # *wobble* seen from SPHEREx's orbit is not applied: <=0.55" (<0.1 px) for these targets.
        c = SkyCoord(self.ra * u.deg, self.dec * u.deg,
                     pm_ra_cosdec=self.pmra * u.mas / u.yr, pm_dec=self.pmdec * u.mas / u.yr,
                     distance=Distance(parallax=max(self.plx, 0.01) * u.mas),
                     obstime=Time(self.epoch, format="jyear"))
        p = c.apply_space_motion(new_obstime=Time(mjd, format="mjd"))
        return SkyCoord(p.ra, p.dec)

    def to_json(self) -> dict:
        return {**asdict(self), "moves": self.moves}


PRESETS: dict[str, Target] = {t.id: t for t in [
    Target("wise0855", "WISE 0855-0714", 133.81890825, -7.247048, 2000.0,
           -8123.7, 673.2, 439.0, "SIMBAD (Kirkpatrick et al. 2021)",
           "Coldest known brown dwarf (~250 K). Invisible below ~4 um; faint even in D5/D6, near "
           "single-exposure limits, so treat any detection as marginal. Moves ~1.3 px/yr west; "
           "about 2' from its 2010 WISE position by 2025.", "D6"),
    Target("barnard", "Barnard's Star", 269.4520769586187, 4.69336496657667, 2000.0,
           -801.551, 10362.394, 546.9759, "SIMBAD (Gaia DR3)",
           "Fastest-moving star in the sky (~10.4\"/yr north, ~1.7 px/yr). Bright enough to "
           "saturate: expect OVERFLOW at the core in most frames; follow the motion, not the core flux."),
    Target("epsindib", "eps Indi B", 331.04414658852124, -56.78284419511611, 2000.0,
           3981.977, -2466.832, 270.658, "SIMBAD (Gaia DR3)",
           "T1+T6 brown-dwarf binary 0.66\" apart: one unresolved source to SPHEREx. ~0.75 px/yr. "
           "eps Indi A (V=4.7) 6.7' away can cause GHOST/HALO flags. Strong CH4/H2O spectral bands."),
    Target("rwaur", "RW Aurigae", 76.95652603458, 30.40143817389, 2000.0,
           7.23, -20.33, 15.42, "SIMBAD (Hipparcos)",
           "Young T Tauri binary with a disk; irregular variable. Effectively stationary: a "
           "brightness-change target. Core saturates in most frames (OVERFLOW)."),
    Target("rdra", "R Draconis", 248.16761083295, 66.75497941722, 2000.0,
           -20.643, 6.149, 1.2509, "SIMBAD (Gaia DR3)",
           "Mira variable near the north ecliptic pole, so the most SPHEREx visits of the five. "
           "Large infrared brightness swings; core saturates in most frames."),
]}


class TargetNotFound(LookupError):
    pass


def _sesame(name: str) -> Target:
    r = requests.get(f"{SESAME}?{quote(name)}", timeout=30, headers={"User-Agent": config.USER_AGENT})
    r.raise_for_status()
    res = ET.fromstring(r.text).find(".//Resolver")
    if res is None or res.find("jradeg") is None:
        raise TargetNotFound(f"No object named {name!r} in SIMBAD/NED/VizieR")

    def num(path, default=0.0):
        el = res.find(path)
        return float(el.text) if el is not None and el.text else default

    return Target(
        id=name, name=(res.findtext("oname") or name).strip(),
        ra=num("jradeg"), dec=num("jdedeg"), epoch=2000.0,
        pmra=num("pm/pmRA"), pmdec=num("pm/pmDE"), plx=num("plx/v"),
        source=f"CDS Sesame ({res.get('name', 'resolver')})",
    )


def resolve(name: str) -> Target:
    """Preset id (e.g. 'wise0855'), or any object name ("Barnard's Star", 'M101')."""
    key = name.strip().lower().replace(" ", "")
    if key in PRESETS:
        return PRESETS[key]
    path = config.CACHE / "targets" / f"{cache.key(name.strip().lower())}.json"
    hit = cache.json_get(path)
    if hit:
        return Target(**{k: v for k, v in hit.items() if k != "moves"})
    last = None
    for i in range(2):
        try:
            t = _sesame(name.strip())
            cache.json_put(path, t.to_json())
            return t
        except TargetNotFound:
            raise
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1)
    raise TargetNotFound(f"Name lookup failed (CDS unreachable?): {str(last)[:150]}")
