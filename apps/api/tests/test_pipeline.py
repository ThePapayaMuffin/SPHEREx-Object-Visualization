"""Offline tests: fake SPHEREx-like cutouts, no IRSA needed.

Run:  .venv/Scripts/python -m pytest -q
"""
import io

import numpy as np
import pytest
from astropy.io import fits
from astropy.wcs import WCS
from fastapi.testclient import TestClient
from PIL import Image

from spherex_api import config, frames, process
from spherex_api.discover import IrsaUnavailable

RA, DEC = 133.795129, -7.245147
NAMES = {0: "TRANSIENT", 1: "OVERFLOW", 21: "SOURCE"}


def fake_cutout(star_offset_arcsec=(0.0, 0.0), rot_deg=37.0, overflow=False, n=59) -> bytes:
    """A rotated cutout (like a real detector) with one star and a zodi pedestal."""
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [RA, DEC]
    w.wcs.crpix = [(n + 1) / 2, (n + 1) / 2]
    s = config.PIX_ARCSEC / 3600
    c, sn = np.cos(np.radians(rot_deg)), np.sin(np.radians(rot_deg))
    w.wcs.cd = [[-s * c, s * sn], [s * sn, s * c]]

    rng = np.random.default_rng(0)
    yy, xx = np.mgrid[:n, :n]
    sx, sy = (float(v) for v in w.world_to_pixel_values(
        RA + star_offset_arcsec[0] / 3600 / np.cos(np.radians(DEC)), DEC + star_offset_arcsec[1] / 3600))
    img = 5.0 + rng.normal(0, 0.05, (n, n)) + 3 * np.exp(-((xx - sx) ** 2 + (yy - sy) ** 2) / 2)
    flags = np.zeros((n, n), np.int32)
    flags[int(round(sy)), int(round(sx))] |= 1 << 21  # SOURCE (informational, not masked)
    if overflow:
        flags[int(round(sy)), int(round(sx))] |= 1 << 1

    hdr = w.to_header()
    fh = fits.Header()
    for b, name in NAMES.items():
        fh[f"MSKN{b:04d}"] = name
    hdul = fits.HDUList([
        fits.PrimaryHDU(),
        fits.ImageHDU(img.astype(np.float32), hdr, name="IMAGE"),
        fits.ImageHDU(flags, fh, name="FLAGS"),
        fits.ImageHDU(np.full((n, n), 5.0, np.float32), hdr, name="ZODI"),
    ])
    buf = io.BytesIO()
    hdul.writeto(buf)
    return buf.getvalue()


@pytest.fixture
def fake_irsa(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE", tmp_path)
    rows = [{"url": f"https://irsa.example/spherex/dr1/l2b-v27-2026-197/f{i}.fits",
             "detector": "D6" if i % 2 == 0 else "D2", "mjd": 60800.0 + 30 * i,
             "release": "dr1", "obs_id": f"obs{i}"} for i in range(6)]
    calls = {"cutouts": 0}

    def get_cutout(url, ra, dec, size):
        calls["cutouts"] += 1
        i = int(url.rsplit("/f", 1)[-1].removesuffix(".fits"))
        return fake_cutout(star_offset_arcsec=(-10.0 * i, 0.0), overflow=(i == 4))

    monkeypatch.setattr(frames, "discover", lambda ra, dec: (rows, {"source": "live"}))
    monkeypatch.setattr(frames, "get_cutout", get_cutout)
    return calls


def test_reprojection_puts_north_up_and_east_left():
    # Star 30" east of centre on a rotated detector must land LEFT of centre.
    grid, shape = process.grid_wcs(RA, DEC, 0.05)
    with process.open_fits(fake_cutout(star_offset_arcsec=(30.0, 0.0))) as h:
        arr, info = process.process(h, grid, shape, RA, DEC)
    y, x = np.unravel_index(np.nanargmax(arr), arr.shape)
    cx = (shape[1] - 1) / 2
    assert x < cx - 3, "east should be left"
    assert abs(y - (shape[0] - 1) / 2) <= 1.5
    assert info["lambda_um"] is None  # no WCS-WAVE table in the fake file -> reported as unknown


def test_flags_read_from_header_and_masking():
    grid, shape = process.grid_wcs(RA, DEC, 0.05)
    with process.open_fits(fake_cutout(overflow=True)) as h:
        arr, info = process.process(h, grid, shape, RA, DEC)
    assert set(info["flags_at_target"]) == {"OVERFLOW", "SOURCE"}
    assert np.isnan(arr).any()  # OVERFLOW pixel masked
    with process.open_fits(fake_cutout()) as h:
        arr, info = process.process(h, grid, shape, RA, DEC)
    assert info["flags_at_target"] == ["SOURCE"]  # SOURCE alone is not masked


def test_png_is_transparent_where_masked():
    arr = np.array([[0.0, 1.0], [np.nan, 2.0]])
    im = Image.open(io.BytesIO(process.to_png(arr, process.shared_norm([arr]))))
    assert im.mode == "LA"
    a = np.array(im)[..., 1]
    assert a[0, 0] == 0 and a.sum() == 255 * 3  # flipped: NaN row is now on top


def test_api_builds_manifest_and_serves_pngs(fake_irsa):
    client = TestClient(frames_app())
    r = client.get("/api/frames", params={"ra": RA, "dec": DEC, "fov": 0.05, "det": "D6"})
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["counts"] == {"exposures_at_position": 6, "exposures_this_detector": 3,
                           "requested": 3, "frames": 3, "failed": 0}
    assert [f["detector"] for f in m["frames"]] == ["D6"] * 3
    assert m["frames"][0]["version"] == "l2b-v27-2026-197"
    assert m["frames"][0]["flags_at_target"] == ["SOURCE"]  # star sits on the target
    # Frame 2's saturated star has moved 40" west: flags are sampled AT THE TARGET, so none.
    assert m["frames"][2]["flags_at_target"] == []
    assert m["frames"][2]["masked_frac"] > 0  # ...but its OVERFLOW pixel is still masked
    png = client.get(m["frames"][0]["png"])
    assert png.status_code == 200 and png.headers["content-type"] == "image/png"

    # Second call is served from cache without new downloads.
    before = fake_irsa["cutouts"]
    m2 = client.get("/api/frames", params={"ra": RA, "dec": DEC, "fov": 0.05, "det": "D6"}).json()
    assert m2["cached"] is True and fake_irsa["cutouts"] == before


def test_limit_spreads_over_time(fake_irsa):
    m = TestClient(frames_app()).get(
        "/api/frames", params={"ra": RA, "dec": DEC, "fov": 0.05, "det": "all", "limit": 3}).json()
    mjds = [f["mjd"] for f in m["frames"]]
    assert mjds[0] == 60800.0 and mjds[-1] == 60950.0  # first and last epochs kept


def test_irsa_down_returns_503(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE", tmp_path)

    def down(ra, dec):
        raise IrsaUnavailable("502 Proxy Error")

    monkeypatch.setattr(frames, "discover", down)
    r = TestClient(frames_app()).get("/api/frames", params={"ra": RA, "dec": DEC})
    assert r.status_code == 503 and "IRSA is unavailable" in r.json()["detail"]


def test_bad_params_rejected():
    c = TestClient(frames_app())
    assert c.get("/api/frames", params={"ra": 400, "dec": 0}).status_code == 422
    assert c.get("/api/frames", params={"ra": 1, "dec": 0, "det": "D9"}).status_code == 422
    assert c.get("/api/frames/../../etc/passwd").status_code == 404


def frames_app():
    from spherex_api.main import app
    return app
