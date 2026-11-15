"""Stage 1 pipeline: target -> discover -> cutouts -> common grid -> PNGs + manifest.

Each finished frame set lives in cache/frames/<key>/ (manifest.json + NNN.png).
The key includes the exact list of image URLs, so when IRSA adds new
exposures the set is rebuilt automatically, and old sets are never wrong.

Moving targets: the grid is centred on the target's position at the median
epoch of the frames, and every frame records where the target is *on that
frame's date* (sky coords + PNG pixel), which is also where we read the
wavelength and flags.
"""
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from astropy.time import Time

from . import cache, config
from .discover import discover
from .fetch import get_cutout
from .process import BAD_BITS, grid_wcs, open_fits, process, shared_norm, to_png
from .targets import Target

DETECTOR_RANGE_UM = {  # nominal band edges, for labels
    "D1": (0.75, 1.09), "D2": (1.10, 1.62), "D3": (1.63, 2.41),
    "D4": (2.42, 3.82), "D5": (3.83, 4.41), "D6": (4.42, 5.00),
}
DISCOVERY_EPOCH_MJD = Time(2025.9, format="jyear").mjd  # mid-DR1/QR3; any epoch works for a 3.5 deg image

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock(k: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(k, threading.Lock())


def _version(url: str) -> str | None:
    for part in url.split("/"):
        if part.startswith("l2b-"):
            return part
    return None


def _spread(rows: list[dict], limit: int) -> list[dict]:
    """Pick up to `limit` rows spread evenly over time (keeps the full baseline)."""
    if len(rows) <= limit:
        return rows
    idx = np.unique(np.linspace(0, len(rows) - 1, limit).round().astype(int))
    return [rows[i] for i in idx]


def build_frames(target: Target, fov: float = 0.1, det: str = "D6",
                 limit: int = 40, zodi: bool = True) -> dict:
    ref = target.position_at(DISCOVERY_EPOCH_MJD)
    rows, disc = discover(ref.ra.deg, ref.dec.deg)
    n_found_all = len(rows)
    if det != "all":
        rows = [r for r in rows if r["detector"] == det]
    n_found = len(rows)
    rows = _spread(rows, limit)

    center = target.position_at(float(np.median([r["mjd"] for r in rows]))) if rows else ref
    cra, cdec = float(center.ra.deg), float(center.dec.deg)

    k = cache.key(target.ra, target.dec, target.epoch, target.pmra, target.pmdec,
                  round(fov, 4), det, zodi, config.PROC_VERSION, *[r["url"] for r in rows])
    out = config.CACHE / "frames" / k
    with _lock(k):
        done = cache.json_get(out / "manifest.json")
        if done:
            return {**done, "discovery": disc, "cached": True}

        grid, shape = grid_wcs(cra, cdec, fov)
        size = fov * 1.5  # cutouts come in detector orientation; pad so rotation still covers the grid
        positions = [target.position_at(r["mjd"]) for r in rows]

        if config.FAKE:
            from .fake import fake_cutout
            def fetch_one(r, p):
                return fake_cutout(r, center, size, p)
        else:
            def fetch_one(r, p):
                return get_cutout(r["url"], cra, cdec, size)

        t0 = time.time()
        with ThreadPoolExecutor(config.WORKERS) as pool:
            futures = [pool.submit(fetch_one, r, p) for r, p in zip(rows, positions)]
        frames, failed = [], []
        for r, pos, f in zip(rows, positions, futures):
            try:
                with open_fits(f.result()) as hdul:
                    arr, info = process(hdul, grid, shape, pos.ra.deg, pos.dec.deg, zodi=zodi)
            except Exception as e:  # noqa: BLE001 - one bad exposure must not sink the set
                failed.append({"obs_id": r["obs_id"], "error": str(e)[:200]})
                continue
            arr = arr - np.nanmedian(arr) if np.isfinite(arr).any() else arr
            frames.append((r, pos, arr, info))
        fetch_s = round(time.time() - t0, 1)

        norms = {d: shared_norm([a for r, _, a, _ in frames if r["detector"] == d])
                 for d in {r["detector"] for r, _, _, _ in frames}}

        n = shape[0]
        manifest_frames = []
        for i, (r, pos, arr, info) in enumerate(frames):
            name = f"{i:03d}.png"
            cache.write_atomic(out / name, to_png(arr, norms[r["detector"]]))
            gx, gy = (float(v) for v in grid.world_to_pixel(pos))
            manifest_frames.append({
                "index": i,
                "png": f"/api/frames/{k}/{name}",
                "mjd": round(r["mjd"], 5),
                "iso": Time(r["mjd"], format="mjd").isot[:19] + "Z",
                "detector": r["detector"],
                **info,
                "target_pos": {  # where the target is on THIS frame's date
                    "ra": round(float(pos.ra.deg), 7),
                    "dec": round(float(pos.dec.deg), 7),
                    "px": [round(gx, 2), round((n - 1) - gy, 2)],  # PNG pixels, (0,0) = top-left pixel centre
                },
                "release": r["release"],
                "version": _version(r["url"]),
                "obs_id": r["obs_id"],
                "source_url": r["url"],
            })

        manifest = {
            "key": k,
            "synthetic": config.FAKE,
            "target": target.to_json(),
            "center": {"ra": cra, "dec": cdec},
            "fov_deg": fov,
            "detector": det,
            "detector_range_um": DETECTOR_RANGE_UM.get(det),
            "zodi_subtracted": zodi,
            "masked_bits": list(BAD_BITS),
            "grid": {  # enough for the frontend to place anything else on the frames
                "npix": n,
                "pix_arcsec": config.PIX_ARCSEC,
                "crval": [cra, cdec],
                "crpix": list(map(float, grid.wcs.crpix)),
                "cdelt": list(map(float, grid.wcs.cdelt)),
                "projection": "TAN, north up, east left",
            },
            "counts": {
                "exposures_at_position": n_found_all,
                "exposures_this_detector": n_found,
                "requested": len(rows),
                "frames": len(manifest_frames),
                "failed": len(failed),
            },
            "message": (None if manifest_frames else
                        "No SPHEREx exposures found here yet." if not rows else
                        "Every cutout download failed; IRSA may be struggling. Try again shortly."),
            "releases_present": sorted({f["release"] for f in manifest_frames}),
            "failed": failed,
            "build_seconds": fetch_s,
            "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "proc_version": config.PROC_VERSION,
            "frames": manifest_frames,
        }
        # Only cache complete-enough sets, so a flaky IRSA run gets retried next time.
        if manifest_frames and len(failed) <= max(1, len(rows) // 10):
            cache.json_put(out / "manifest.json", manifest)
        return {**manifest, "discovery": disc, "cached": False}
