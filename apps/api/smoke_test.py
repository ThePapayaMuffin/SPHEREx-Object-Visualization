"""Stage 0 smoke test: prove the SPHEREx data path works, using WISE 0855-0714.

Checks (from the build plan):
  1. TAP finds DR1 + QR3 exposures across D1-D6 on multiple dates.
  2. A cutout opens with all its extensions (IMAGE, FLAGS, ..., WCS-WAVE).
  3. FLAGS header names its bits (OVERFLOW, SOURCE, ...).
  4. A stack of D6 cutouts shows (or doesn't) a faint source ~2' west of the
     catalogue position.

Run:  .venv/Scripts/python smoke_test.py
Writes: smoke_out/d6_stack.png
"""
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import time

import astropy.units as u
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from astropy.coordinates import SkyCoord, Distance
from astropy.io import fits
from astropy.time import Time
from astropy.utils.data import conf
from astropy.visualization import AsinhStretch, ImageNormalize, ZScaleInterval
from astropy.wcs import WCS
from astroquery.ipac.irsa import Irsa
from reproject import reproject_interp

conf.remote_timeout = 120  # SPHEREx reads can exceed the default timeout
OUT = Path(__file__).parent / "smoke_out"
OUT.mkdir(exist_ok=True)

# Catalogue (WISE-era) position plus SIMBAD motion (Kirkpatrick et al. 2021).
# Reference epoch assumed ~2010.5 for the designation position.
target = SkyCoord(
    "08h55m10.831s", "-07d14m42.53s", frame="icrs",
    pm_ra_cosdec=-8123.7 * u.mas / u.yr, pm_dec=673.2 * u.mas / u.yr,
    distance=Distance(parallax=439.0 * u.mas), obstime=Time(2010.5, format="jyear"),
)
size_deg = 0.1  # 6' box: safely contains both the 2010 and 2025-26 positions

# Bits treated as bad when masking (plan's list; verified against MSKN* below).
BAD = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 6) | (1 << 9) | (1 << 10) | (1 << 19)


def header(title):
    print(f"\n=== {title} ===")


# --- Check 1: discovery ------------------------------------------------------
header("1. Discovery (TAP: spherex.artifact JOIN spherex.plane)")
adql = f"""
SELECT 'https://irsa.ipac.caltech.edu/' || a.uri AS url,
       p.energy_bandpassname AS band, p.time_bounds_lower AS mjd
FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid
WHERE 1 = CONTAINS(POINT('ICRS', {target.ra.deg}, {target.dec.deg}), p.poly)
ORDER BY p.time_bounds_lower
"""
t0 = time.time()
rows = Irsa.query_tap(adql).to_table()
print(f"{len(rows)} exposures in {time.time() - t0:.1f}s")
print("per detector:", dict(sorted(Counter(rows["band"]).items())))
releases = Counter(
    next((r for r in ("dr1", "qr3", "qr2") if f"/{r}/" in str(u_)), "other") for u_ in rows["url"]
)
print("per release:", dict(releases))
print("first/last epoch:", Time(rows["mjd"].min(), format="mjd").iso[:10],
      "->", Time(rows["mjd"].max(), format="mjd").iso[:10])
print("example url:", rows["url"][0])


def cutout_url(url):
    return f"{url}?center={target.ra.deg},{target.dec.deg}&size={size_deg}&gzip=false"


def fetch(url, tries=4):
    """Open a cutout with retries (IRSA cutouts fail transiently)."""
    for i in range(tries):
        try:
            with fits.open(cutout_url(url), cache=False) as h:
                h.readall() if hasattr(h, "readall") else [x.data for x in h]
                return fits.HDUList([x.copy() for x in h])
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                print("  failed:", url[-60:], e)
                return None
            time.sleep(2 ** i)


# --- Checks 2 + 3: one D6 cutout ---------------------------------------------
d6 = rows[rows["band"] == "SPHEREx-D6"]
header(f"2+3. One D6 cutout ({len(d6)} D6 exposures available)")
h = fetch(d6["url"][0])
h.info()
img_wcs = WCS(h["IMAGE"].header)
epoch = Time(d6["mjd"][0], format="mjd")
here = target.apply_space_motion(new_obstime=epoch)
x, y = img_wcs.world_to_pixel(here)
try:
    swcs = WCS(h["IMAGE"].header, fobj=h, key="W")
    swcs.sip = None
    lam, bw = swcs.pixel_to_world(x, y)
    print(f"wavelength at predicted position: {lam.to(u.um):.3f}, bandwidth {bw.to(u.um):.4f}")
except Exception as e:  # noqa: BLE001
    print("spectral WCS failed:", e)
fh = h["FLAGS"].header
bits = {int(k[4:]): fh[k] for k in fh["MSKN*"]}
print("flag bits:", bits)
named_bad = {b: bits.get(b) for b in range(32) if BAD & (1 << b)}
print("bits we mask as bad:", named_bad)

# --- Check 4: stack D6 cutouts on a common grid -----------------------------
N = min(16, len(d6))
header(f"4. Stacking {N} D6 cutouts")
t0 = time.time()
with ThreadPoolExecutor(8) as pool:
    cuts = [c for c in pool.map(fetch, d6["url"][:N]) if c is not None]
print(f"fetched {len(cuts)}/{N} in {time.time() - t0:.1f}s")

pix = 6.15
n = int(round(size_deg * 3600 / pix))
grid = WCS(naxis=2)
grid.wcs.ctype = ["RA---TAN", "DEC--TAN"]
grid.wcs.crval = [target.ra.deg, target.dec.deg]
grid.wcs.crpix = [n / 2 + 0.5, n / 2 + 0.5]
grid.wcs.cdelt = [-pix / 3600, pix / 3600]

layers = []
for c in cuts:
    im = c["IMAGE"].data.astype(float) - c["ZODI"].data
    im[(c["FLAGS"].data & BAD) != 0] = np.nan
    arr, _ = reproject_interp((im, WCS(c["IMAGE"].header)), grid, shape_out=(n, n))
    layers.append(arr - np.nanmedian(arr))
stack = np.nanmedian(layers, axis=0)

mid = Time(np.median(d6["mjd"][:N]), format="mjd")
now_pos = target.apply_space_motion(new_obstime=mid)
cat_pos = SkyCoord(target.ra, target.dec)
sep = cat_pos.separation(now_pos).to(u.arcsec)
print(f"predicted position at {mid.iso[:10]}: {sep:.0f} from catalogue position "
      f"(PA {cat_pos.position_angle(now_pos).to(u.deg):.0f})")

fig = plt.figure(figsize=(6, 6))
ax = fig.add_subplot(projection=grid)
ax.imshow(stack, origin="lower", cmap="gray",
          norm=ImageNormalize(stack, interval=ZScaleInterval(), stretch=AsinhStretch()))
for pos, col, lab in [(cat_pos, "red", "catalogue (2010)"), (now_pos, "lime", f"predicted ({mid.iso[:7]})")]:
    px, py = grid.world_to_pixel(pos)
    ax.scatter(px, py, s=300, facecolor="none", edgecolor=col, lw=1.5, label=lab)
ax.legend(loc="upper right", fontsize=8)
ax.set_title(f"WISE 0855 - median of {len(cuts)} D6 cutouts (zodi-subtracted, flags masked)", fontsize=9)
fig.savefig(OUT / "d6_stack.png", dpi=120, bbox_inches="tight")
print("saved", OUT / "d6_stack.png")
