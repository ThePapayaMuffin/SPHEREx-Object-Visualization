"""Targets, per-frame positions and fake mode. Offline."""
import io

import numpy as np
import pytest
from astropy.coordinates import SkyCoord
from astropy.time import Time
from fastapi.testclient import TestClient
from PIL import Image

from spherex_api import config, targets
from spherex_api.main import app
from spherex_api.targets import PRESETS


def test_wise0855_simbad_j2000_lands_on_plan_coordinates_in_2010():
    # The plan's coordinates (WISE designation) should be the J2000 SIMBAD position
    # moved to ~2010.4. If this holds, our epoch handling is consistent.
    t = PRESETS["wise0855"]
    p = t.position_at(Time(2010.4, format="jyear").mjd)
    assert p.separation(SkyCoord(133.795129, -7.245147, unit="deg")).arcsec < 3


def test_barnard_moves_about_10_arcsec_per_year_north():
    t = PRESETS["barnard"]
    a, b = t.position_at(Time(2025.0, format="jyear").mjd), t.position_at(Time(2026.0, format="jyear").mjd)
    assert 10.0 < a.separation(b).arcsec < 10.8
    assert b.dec > a.dec


def test_static_coordinates_do_not_move():
    t = targets.Target("x", "x", 10.0, 20.0, 2000.0)
    assert t.position_at(60000).separation(t.position_at(61000)).arcsec == 0


@pytest.fixture
def fake_mode(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE", tmp_path)
    monkeypatch.setattr(config, "FAKE", True)
    return TestClient(app)


def test_fake_mode_end_to_end_with_moving_target(fake_mode):
    r = fake_mode.get("/api/frames", params={"target": "wise0855", "det": "D6"})
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["synthetic"] is True and m["releases_present"] == ["fake"]
    assert m["counts"]["frames"] == 8 and m["counts"]["failed"] == 0
    assert all(4.42 <= f["lambda_um"] <= 5.0 for f in m["frames"])
    assert len({f["lambda_um"] for f in m["frames"]}) > 1  # wavelength changes per exposure

    first, last = m["frames"][0]["target_pos"]["px"], m["frames"][-1]["target_pos"]["px"]
    assert last[0] > first[0]  # moves west = to the right in a north-up, east-left image
    assert abs(last[1] - first[1]) < 1  # mostly east-west motion

    # The fake star is drawn at the epoch position: the PNG is brighter there.
    f = m["frames"][-1]
    im = np.array(Image.open(io.BytesIO(fake_mode.get(f["png"]).content)))[..., 0].astype(float)
    x, y = (int(round(v)) for v in f["target_pos"]["px"])
    assert im[y, x] > np.median(im) + 20


def test_unknown_name_is_404(fake_mode, monkeypatch):
    def nope(name):
        raise targets.TargetNotFound("No object named 'zzz'")
    monkeypatch.setattr(targets, "_sesame", nope)
    assert fake_mode.get("/api/frames", params={"target": "zzz"}).status_code == 404
    assert fake_mode.get("/api/resolve", params={"name": "zzz"}).status_code == 404


def test_needs_target_or_coordinates(fake_mode):
    assert fake_mode.get("/api/frames").status_code == 422
    assert fake_mode.get("/api/frames", params={"ra": 10}).status_code == 422


def test_targets_list(fake_mode):
    ids = [t["id"] for t in fake_mode.get("/api/targets").json()]
    assert ids == ["wise0855", "barnard", "epsindib", "rwaur", "rdra"]
