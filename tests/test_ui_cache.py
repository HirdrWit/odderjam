"""The built UI's cache headers: index.html is always revalidated, hashed assets are immutable."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.main import UiFiles


@pytest.fixture
def client(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text('<script src="/assets/index-abc123.js"></script>')
    (tmp_path / "assets" / "index-abc123.js").write_text("console.log(1)")
    (tmp_path / "favicon.svg").write_text("<svg/>")
    app = FastAPI()
    app.mount("/", UiFiles(directory=tmp_path, html=True), name="ui")
    return TestClient(app)


def test_index_is_revalidated_every_load(client):
    for url in ("/", "/index.html"):
        r = client.get(url)
        assert r.status_code == 200
        assert r.headers["cache-control"] == "no-cache"


def test_hashed_assets_are_immutable(client):
    r = client.get("/assets/index-abc123.js")
    assert r.status_code == 200
    assert "immutable" in r.headers["cache-control"] and "max-age=31536000" in r.headers["cache-control"]


def test_other_root_files_are_revalidated(client):
    assert client.get("/favicon.svg").headers["cache-control"] == "no-cache"


def test_missing_asset_is_still_404(client):
    assert client.get("/assets/index-old.js").status_code == 404


def test_ui_files_is_used_for_the_real_mount():
    from backend import main
    mounts = [r for r in main.app.routes if getattr(r, "name", None) == "ui"]
    assert not mounts or isinstance(mounts[0].app, UiFiles)
