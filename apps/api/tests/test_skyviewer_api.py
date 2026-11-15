"""The skyviewer-shaped endpoints (POST /api/cutout, /api/resolve, /api/catalog). Offline."""
import pytest
from fastapi.testclient import TestClient

from spherex_api import config, targets
from spherex_api.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE", tmp_path)
    monkeypatch.setattr(config, "FAKE", True)
    return TestClient(app)


def test_cutout_matches_readme_contract(client):
    r = client.post("/api/cutout", json={"ra": 133.795, "dec": -7.245, "fovDeg": 0.1})
    assert r.status_code == 200, r.text
    c = r.json()
    for k in ("ra", "dec", "fovDeg", "layers", "frames", "overlays"):
        assert k in c
    assert c["layers"] == ["D1", "D2", "D3", "D4", "D5", "D6"]
    times = [f["time"] for f in c["frames"]]
    assert times == sorted(times)
    for f in c["frames"]:
        assert f["images"] and set(f["images"]) == set(f["meta"])
        for url in f["images"].values():
            assert url.startswith("http://testserver/api/frames/")  # absolute, loadable cross-origin
    # Image URLs actually serve PNGs.
    url = c["frames"][0]["images"][c["layers"][0]].replace("http://testserver", "")
    assert client.get(url).headers["content-type"] == "image/png"
    assert c["synthetic"] is True


def test_cutout_clamps_large_fov(client):
    c = client.post("/api/cutout", json={"ra": 10, "dec": 20, "fovDeg": 2}).json()
    assert c["fovDeg"] == config.MAX_FOV_DEG and c["fovClamped"] is True and c["requestedFovDeg"] == 2


def test_cutout_with_target_follows_motion_and_recentres(client):
    c = client.post("/api/cutout", json={"ra": 133.795, "dec": -7.245, "fovDeg": 0.1,
                                         "target": "wise0855"}).json()
    # Centre is the 2025-26 position, ~2' west of the WISE-era coordinates sent.
    assert c["ra"] < 133.795 - 0.02
    assert c["overlays"][0]["source"] == "target"
    px = [f["meta"]["D6"]["target_pos"]["px"][0] for f in c["frames"] if "D6" in f["images"]]
    assert px == sorted(px) and px[-1] > px[0]  # moves west (right) over time


def test_cutout_per_detector_limit(client):
    c = client.post("/api/cutout", json={"ra": 10, "dec": 20, "fovDeg": 0.05, "perDetector": 3}).json()
    per = {d: sum(d in f["images"] for f in c["frames"]) for d in c["layers"]}
    assert set(per.values()) == {3}
    # The first and last visit of each detector are kept (8 fake visits from 2025-05 to 2026-05).
    d6 = [f["meta"]["D6"]["iso"] for f in c["frames"] if "D6" in f["images"]]
    assert d6[0].startswith("2025-05") and d6[-1].startswith("2026-05")


def test_resolve_q_returns_overlay_object(client):
    o = client.get("/api/resolve", params={"q": "barnard"}).json()
    assert o["name"] == "Barnard's Star" and {"ra", "dec", "source"} <= set(o)
    assert o["dec"] > 4.693 + 0.05  # "now" position, ~4.5' north of J2000


def test_resolve_unknown_404(client, monkeypatch):
    def nope(n):
        raise targets.TargetNotFound("nope")
    monkeypatch.setattr(targets, "_sesame", nope)
    assert client.get("/api/resolve", params={"q": "zzz"}).status_code == 404


def test_catalog(client):
    cat = client.get("/api/catalog").json()
    assert len(cat) >= 15 and all({"name", "ra", "dec", "source"} <= set(o) for o in cat)


def test_cors_preflight_for_post(client):
    r = client.options("/api/cutout", headers={"Origin": "http://localhost:5173",
                                               "Access-Control-Request-Method": "POST",
                                               "Access-Control-Request-Headers": "content-type"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
