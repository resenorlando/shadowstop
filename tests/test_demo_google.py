"""Demo integrity and Google proxy boundaries; no remote requests or real keys."""
import pytest
from fastapi import HTTPException

from shadowstop.google_maps import google_get, rewrite_tile_uris, status
from shadowstop.server import verified_demo


def test_recorded_demo_reverifies_its_geometry_and_headline_values():
    result = verified_demo()
    assert result["verdict"]["accepted"]
    assert result["before"]["score"] == pytest.approx(0.1399)
    assert result["after"]["score"] == pytest.approx(0.7655)
    assert result["verdict"]["cost_gbp"] == 3350
    assert len(result["before"]["by_time"]) == 37
    assert result["rules"]["min_gain"] == 0.25


def test_google_requires_a_maps_key_and_does_not_reuse_gemini(monkeypatch):
    monkeypatch.delenv("GOOGLE_MAPS_API_KEY", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "unrelated-test-credential")
    assert not status()["configured"]
    with pytest.raises(HTTPException) as error:
        google_get("https://tile.googleapis.com/v1/3dtiles/root.json", {})
    assert error.value.status_code == 503


def test_google_tile_uris_keep_session_but_never_return_keys():
    data = {"root": {"content": {"uri": "https://tile.googleapis.com/v1/3dtiles/datasets/test/1.json?session=abc&key=secret"}}, "asset": {"copyright": "Google Maps"}}
    result = rewrite_tile_uris(data, "https://tile.googleapis.com/v1/3dtiles/root.json?key=secret")
    assert result["root"]["content"]["uri"] == "/api/google/tiles/datasets/test/1.json?session=abc"
    assert result["asset"]["copyright"] == "Google Maps"
    assert "secret" not in str(result)


def test_google_tile_proxy_rejects_foreign_origins():
    with pytest.raises(HTTPException):
        rewrite_tile_uris({"uri": "https://example.org/private"}, "https://tile.googleapis.com/v1/3dtiles/root.json")
