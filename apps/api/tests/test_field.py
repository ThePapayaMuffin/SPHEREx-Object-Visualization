"""Field-star overlays (/api/field). Offline: VizieR is faked."""
import numpy as np
import pytest
from fastapi.testclient import TestClient

from spherex_api import config, field
from spherex_api.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE", tmp_path)
    calls = []

    def fake_query(catalog, ra, dec, width, columns):
        calls.append(catalog)
        if catalog == field.GAIA:  # one star moving 1000 mas/yr east, one with blank motion
            return [{"Source": 1, "RA_ICRS": 10.0, "DE_ICRS": 0.0, "Gmag": 12.0, "pmRA": 1000.0, "pmDE": 0.0},
                    {"Source": 2, "RA_ICRS": 10.01, "DE_ICRS": 0.0, "Gmag": 15.0, "pmRA": np.ma.masked, "pmDE": np.ma.masked}]
        return [{"Name": "J004000.00+000000.0", "RAPMdeg": 10.0, "DEPMdeg": 0.0, "pmRA": -1.0, "pmDE": 0.0, "W2mproPM": 9.5}]

    monkeypatch.setattr(field, "_query", fake_query)
    c = TestClient(app); c.calls = calls
    return c


def test_field_moves_stars_to_the_frame_date(client):
    epoch = field.GAIA_EPOCH + 365.25 * 10  # ten years after Gaia's epoch
    r = client.get("/api/field", params={"ra": 10, "dec": 0, "fov": 0.1, "mjd": epoch}).json()
    gaia = [o for o in r["objects"] if o["source"] == "gaia"]
    assert abs((gaia[0]["ra"] - 10.0) * 3600 - 10.0) < 0.01  # 1"/yr x 10 yr east
    assert gaia[1]["ra"] == 10.01                          # blank motion -> stays put
    cw = [o for o in r["objects"] if o["source"] == "catwise"][0]
    assert cw["name"].startswith("CWISE ") and cw["ra"] < 10.0  # CatWISE pm is arcsec/yr, moving west
    assert r["notes"] == []


def test_field_is_cached(client):
    p = {"ra": 10, "dec": 0, "fov": 0.1, "mjd": 61000}
    client.get("/api/field", params=p); n = len(client.calls); client.get("/api/field", params=p)
    assert len(client.calls) == n


def test_field_failure_is_reported_not_raised(client, monkeypatch):
    def down(*a):
        raise RuntimeError("VizieR unreachable")
    monkeypatch.setattr(field, "_query", down)
    r = client.get("/api/field", params={"ra": 11, "dec": 0, "fov": 0.1, "mjd": 61000})
    assert r.status_code == 200 and r.json()["objects"] == [] and len(r.json()["notes"]) == 2
