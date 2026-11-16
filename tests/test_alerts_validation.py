"""POST /api/alerts/rules rejects negative or non-finite min_value (odderjam-46)."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import main, providers

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)
    monkeypatch.setattr(providers, "peek_snapshot", lambda: [])
    return TestClient(main.app, raise_server_exceptions=False)


def post_raw(client, body):
    """Post a raw JSON body, so values like 1e999 and NaN reach the server unchanged."""
    return client.post("/api/alerts/rules", content=body, headers={"content-type": "application/json"})


@pytest.mark.parametrize("kind", ["ev", "arb"])
@pytest.mark.parametrize("value", [-5, -0.5, -500])
def test_add_rule_rejects_negative_min_value(client, kind, value):
    r = client.post("/api/alerts/rules", json={"kind": kind, "min_value": value})
    assert r.status_code == 422
    assert r.json()["detail"][0]["loc"][-1] == "min_value"
    assert client.get("/api/alerts/rules").json() == []


@pytest.mark.parametrize("literal", ["1e999", "-1e999", "NaN", "Infinity"])
def test_add_rule_rejects_non_finite_min_value(client, literal):
    r = post_raw(client, '{"kind": "ev", "min_value": %s}' % literal)
    assert r.status_code == 422
    assert r.json()["detail"][0]["loc"][-1] == "min_value"
    assert client.get("/api/alerts/rules").json() == []


@pytest.mark.parametrize("body,expected", [
    ({"kind": "ev"}, 0.0),
    ({"kind": "ev", "min_value": 0}, 0.0),
    ({"kind": "arb", "min_value": 0.5}, 0.5),
    ({"kind": "ev", "min_value": 12}, 12.0),
])
def test_add_rule_accepts_zero_and_positive(client, body, expected):
    r = client.post("/api/alerts/rules", json=body)
    assert r.status_code == 200
    assert r.json()["min_value"] == expected


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_rule_form_error_js():
    result = subprocess.run(["node", "--test", "src/alerts.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def _alerts_component():
    jsx = (SRC / "main.jsx").read_text()
    match = re.search(r"\nfunction Alerts\(\) \{(.*?)\n\}\n", jsx, re.S)
    assert match, "Alerts component not found in main.jsx"
    return match.group(1)


def test_alerts_form_shows_inline_error():
    """No DOM runner in this repo: check the Alerts form validates, checks the response and renders the error."""
    body = _alerts_component()
    assert "ruleFormError(" in body, "Alerts form does not validate Min % before posting"
    assert ".ok" in body, "Alerts form does not check the POST response"
    assert 'role="alert"' in body, "Alerts form has no inline error element"
