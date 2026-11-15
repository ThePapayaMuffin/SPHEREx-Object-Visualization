"""Synthetic SPHEREx-like data for SPHEREX_FAKE=1 (frontend work while IRSA is down).

Everything here is invented. Manifests built from it carry "synthetic": true and
release "fake" so the UI can show a banner. Shapes and metadata mimic the real
pipeline: rotated detector WCS, zodi pedestal, DR1 flag names, a wavelength that
changes every exposure, a saturated star with OVERFLOW + TRANSIENT pixels, and the
target drawn at its true epoch position (so movers really move).
"""
import io

import numpy as np
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.wcs import WCS

from . import config

DR1_FLAGS = {0: "TRANSIENT", 1: "OVERFLOW", 2: "SUR_ERROR", 6: "NONFUNC", 7: "DICHROIC",
             9: "MISSING_DATA", 10: "HOT", 11: "COLD", 12: "FULLSAMPLE", 14: "PHANMISS",
             15: "NONLINEAR", 17: "PERSIST", 19: "OUTLIER", 20: "CROSSTALK", 21: "SOURCE",
             22: "GHOST", 23: "GHOST_FPA", 24: "GHOST_EXT", 25: "STREAK", 26: "BLOOM",
             27: "SNOWBALL", 28: "HALO"}
BANDS = {"D1": (0.75, 1.09, 39), "D2": (1.10, 1.62, 41), "D3": (1.63, 2.41, 41),
         "D4": (2.42, 3.82, 35), "D5": (3.83, 4.41, 112), "D6": (4.42, 5.00, 128)}


def fake_rows() -> list[dict]:
    """6 detectors x 8 visits over one year (like DR1's baseline). As in SPHEREx, detector
    pairs D1+D4, D2+D5, D3+D6 see a field at the same moment; pairs come ~a day apart."""
    pair = {"D1": 0, "D4": 0, "D2": 1, "D5": 1, "D3": 2, "D6": 2}
    rows = []
    for v in range(8):
        for det in BANDS:
            mjd = 60800.5 + v * 52 + pair[det] * 1.1
            rows.append({"url": f"fake://spherex/fake/l2b-fake-1/{det}/{mjd:.2f}.fits",
                         "detector": det, "mjd": mjd, "release": "fake", "obs_id": f"fake-{v}-{det}"})
    return rows


def fake_cutout(row: dict, center: SkyCoord, size_deg: float, target_pos: SkyCoord | None) -> bytes:
    det, mjd = row["detector"], row["mjd"]
    seed = int(mjd * 100) % 2**32
    rng = np.random.default_rng(seed)
    n = int(round(size_deg * 3600 / config.PIX_ARCSEC))

    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [center.ra.deg, center.dec.deg]
    w.wcs.crpix = [(n + 1) / 2, (n + 1) / 2]
    s, th = config.PIX_ARCSEC / 3600, np.radians(rng.uniform(0, 360))
    w.wcs.cd = [[-s * np.cos(th), s * np.sin(th)], [s * np.sin(th), s * np.cos(th)]]

    yy, xx = np.mgrid[:n, :n]
    zodi = rng.uniform(0.3, 0.6) * (1 + 0.2 * (xx / n))
    img = zodi + rng.normal(0, 0.02, (n, n))
    flags = np.zeros((n, n), np.int64)

    def add_star(pos, amp, sigma=0.9):
        x, y = (float(v) for v in w.world_to_pixel(pos))
        r2 = (xx - x) ** 2 + (yy - y) ** 2
        img[:] += amp * np.exp(-r2 / (2 * sigma**2))
        flags[r2 < 4] |= 1 << 21  # SOURCE
        return x, y, r2

    # Field stars: fixed on the sky (same every epoch), seeded from the field centre.
    frng = np.random.default_rng(int(abs(center.ra.deg * 1e3 + center.dec.deg * 1e5)) % 2**32)
    half = size_deg / 2.2
    for _ in range(18):
        add_star(SkyCoord(center.ra.deg + frng.uniform(-half, half) / np.cos(center.dec.radian),
                          center.dec.deg + frng.uniform(-half, half), unit="deg"),
                 frng.uniform(0.05, 0.6))
    # One saturated star with an OVERFLOW core and TRANSIENT ring.
    _, _, r2 = add_star(SkyCoord(center.ra.deg + half * 0.6 / np.cos(center.dec.radian),
                                 center.dec.deg - half * 0.5, unit="deg"), 8.0, 1.4)
    flags[r2 < 2] |= 1 << 1
    flags[(r2 >= 2) & (r2 < 6)] |= 1 << 0
    # The target, at its epoch position, with a slow brightness cycle.
    if target_pos is not None:
        add_star(target_pos, 0.35 * (1 + 0.5 * np.sin(mjd / 60)))
    # A couple of hot pixels.
    for _ in range(3):
        flags[rng.integers(n), rng.integers(n)] |= 1 << 10

    lo, hi, R = BANDS[det]
    lam = lo + rng.uniform(0.05, 0.95) * (hi - lo)
    hdr = w.to_header()
    hdr["SYN_LAM"], hdr["SYN_BW"] = round(lam, 4), round(lam / R, 4)
    hdr["SYNTHET"] = (True, "FAKE DATA - not SPHEREx")
    fh = fits.Header()
    for b, name in DR1_FLAGS.items():
        fh[f"MSKN{b:04d}"] = name
    hdul = fits.HDUList([
        fits.PrimaryHDU(),
        fits.ImageHDU(img.astype(np.float32), hdr, name="IMAGE"),
        fits.ImageHDU(flags.astype(np.int32), fh, name="FLAGS"),
        fits.ImageHDU(zodi.astype(np.float32), hdr, name="ZODI"),
    ])
    buf = io.BytesIO()
    hdul.writeto(buf)
    return buf.getvalue()
