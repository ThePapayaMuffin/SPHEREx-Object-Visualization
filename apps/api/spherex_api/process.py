"""Turn one SPHEREx cutout into a frame on a shared north-up grid.

Per frame we also record what a scientist would need to trust it:
the wavelength and bandwidth *at the target* (it differs every exposure),
which quality flags are set at the target, and how much of the frame is masked.
"""
import io
import re
import warnings

import numpy as np
from astropy import log
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.visualization import AsinhStretch, ImageNormalize, ZScaleInterval
from astropy.wcs import WCS, FITSFixedWarning
from PIL import Image
from reproject import reproject_interp
from scipy.ndimage import uniform_filter

from . import config

log.setLevel("WARNING")  # silences the harmless SIP/CTYPE notice in SPHEREx headers
warnings.filterwarnings("ignore", category=FITSFixedWarning)

# Pixels we hide: TRANSIENT, OVERFLOW, SUR_ERROR, NONFUNC, MISSING_DATA, HOT, OUTLIER.
# (SOURCE is informational and deliberately NOT masked.) Verified against MSKN* in DR1.
BAD_BITS = (0, 1, 2, 6, 9, 10, 19)
BAD = sum(1 << b for b in BAD_BITS)


def grid_wcs(ra: float, dec: float, fov_deg: float):
    """North-up, east-left TAN grid at native SPHEREx pixel scale, centred on target."""
    n = max(8, int(round(fov_deg * 3600 / config.PIX_ARCSEC)))
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [ra, dec]
    w.wcs.crpix = [n / 2 + 0.5, n / 2 + 0.5]
    w.wcs.cdelt = [-config.PIX_ARCSEC / 3600, config.PIX_ARCSEC / 3600]
    return w, (n, n)


def open_fits(data: bytes) -> fits.HDUList:
    return fits.open(io.BytesIO(data))


def flag_names(header) -> dict[int, str]:
    """Bit -> name, read from the file itself (MSKNnnnn keywords)."""
    return {int(k[4:]): str(header[k]) for k in header if re.fullmatch(r"MSKN\d+", k)}


def _wavelength(hdul, x: float, y: float):
    """Wavelength + bandwidth (µm) at a pixel, via the WCS-WAVE lookup table."""
    try:
        sw = WCS(hdul["IMAGE"].header, fobj=hdul, key="W")
        sw.sip = None
        lam, bw = sw.pixel_to_world(x, y)
        return round(float(lam.to_value("um")), 4), round(float(bw.to_value("um")), 4)
    except Exception:  # noqa: BLE001 - missing table or bad header: report unknown
        h = hdul["IMAGE"].header
        if "SYN_LAM" in h:  # synthetic data (fake.py) carries its wavelength in the header
            return float(h["SYN_LAM"]), float(h["SYN_BW"])
        return None, None


def process(hdul, grid, shape, ra: float, dec: float, zodi: bool = True):
    """Return (array on grid with NaN where masked, per-frame info dict)."""
    img = hdul["IMAGE"].data.astype(float)
    if zodi and "ZODI" in hdul:
        img = img - hdul["ZODI"].data
    flags = hdul["FLAGS"].data.astype(np.int64)
    good = ((flags & BAD) == 0) & np.isfinite(img)
    w = WCS(hdul["IMAGE"].header)

    # Bilinear reprojection turns every bad pixel into ~4 blank output pixels (2% -> 8%).
    # So: fill bad pixels from good neighbours, reproject, then re-apply the mask with
    # nearest-neighbour so exactly the output pixels that came from bad pixels are blank.
    num = uniform_filter(np.where(good, img, 0.0), size=3)
    den = uniform_filter(good.astype(float), size=3)
    fallback = float(np.median(img[good])) if good.any() else 0.0
    filled = np.where(good, img, np.where(den > 0, num / np.maximum(den, 1e-9), fallback))
    arr, _ = reproject_interp((filled, w), grid, shape_out=shape)
    keep, _ = reproject_interp((good.astype(float), w), grid, shape_out=shape, order="nearest-neighbor")
    arr[~(np.nan_to_num(keep) > 0.5)] = np.nan

    x, y = (float(v) for v in w.world_to_pixel(SkyCoord(ra, dec, unit="deg")))
    lam, bw = _wavelength(hdul, x, y)
    xi, yi = int(round(x)), int(round(y))
    h, wd = flags.shape
    if 0 <= xi < wd and 0 <= yi < h:
        patch = flags[max(0, yi - 1):yi + 2, max(0, xi - 1):xi + 2]
        bits = int(np.bitwise_or.reduce(patch.ravel()))
        names = flag_names(hdul["FLAGS"].header)
        at_target = [names.get(b, f"BIT{b}") for b in range(32) if bits & (1 << b)]
    else:
        at_target = None  # target fell outside this cutout

    info = {
        "lambda_um": lam,
        "bw_um": bw,
        "flags_at_target": at_target,
        "masked_frac": round(float(np.isnan(arr).mean()), 3),
    }
    return arr, info


def shared_norm(arrays: list[np.ndarray]) -> ImageNormalize:
    """One stretch for all frames of a detector, so brightness changes are real,
    not artefacts of re-stretching each frame."""
    vals = np.concatenate([a[np.isfinite(a)].ravel() for a in arrays]) if arrays else np.zeros(1)
    if vals.size == 0:
        vals = np.zeros(1)
    vmin, vmax = ZScaleInterval().get_limits(vals[:: max(1, vals.size // 200_000)])
    if vmax <= vmin:
        vmax = vmin + 1
    return ImageNormalize(vmin=vmin, vmax=vmax, stretch=AsinhStretch(), clip=True)


def to_png(arr: np.ndarray, norm: ImageNormalize) -> bytes:
    """Greyscale + alpha PNG; masked/no-data pixels are fully transparent.
    Under the transparency they get the background level (0 after median subtraction),
    not black, so smoothing in the viewer doesn't smear dark rings around them."""
    finite = np.isfinite(arr)
    grey = (np.nan_to_num(np.asarray(norm(np.where(finite, arr, 0.0))), nan=0) * 255)
    la = np.dstack([grey.clip(0, 255).astype(np.uint8), (finite * 255).astype(np.uint8)])
    buf = io.BytesIO()
    # (h, w, 2) uint8 is read as "LA"; flipud because PNG row 0 is the top (north).
    Image.fromarray(np.ascontiguousarray(np.flipud(la))).save(buf, format="PNG", optimize=True)
    return buf.getvalue()
