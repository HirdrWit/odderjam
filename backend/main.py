from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import alerts, scan
from .providers.books import us_only
from .routes import bets
from .providers import cache_info, get_snapshot


@asynccontextmanager
async def lifespan(_app: FastAPI):
    alerts.start()
    yield
    alerts.stop()


app = FastAPI(title="odderjam", lifespan=lifespan)
app.include_router(bets.router)
app.include_router(bets.bankroll_router)
app.include_router(alerts.router)


def _us_markets(markets: dict) -> dict:
    """Markets with prices filtered to US books; outcomes and markets left empty are dropped."""
    out = {}
    for key, outcomes in markets.items():
        kept = [{**o, "prices": us_only(o["prices"])} for o in outcomes]
        kept = [o for o in kept if o["prices"]]
        if kept:
            out[key] = kept
    return out


@app.get("/api/odds")
def odds_screen(sport: str | None = None):
    shown = [{**e, "markets": _us_markets(e["markets"])} for e in get_snapshot()
             if not sport or e["sport"] == sport]
    return [e for e in shown if e["markets"]]


@app.get("/api/ev")
def positive_ev(book: str | None = None, min_ev: float = 0.0, method: str = "multiplicative", kelly: float = 0.25,
                market: str | None = None):
    bankroll = max(bets.bankroll_info()["current"], 0.0)
    return scan.ev_rows(get_snapshot(), book=book, min_ev=min_ev, method=method, kelly=kelly, market=market,
                        bankroll=bankroll)


@app.get("/api/arbs")
def arbs(min_profit: float = 0.0, market: str | None = None):
    return scan.arb_rows(get_snapshot(), min_profit=min_profit, market=market)


@app.post("/api/refresh")
def refresh():
    get_snapshot(force=True)
    return cache_info()


@app.get("/api/cache")
def cache():
    return cache_info()


@app.get("/api/health")
def health():
    return {"ok": True}


dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if dist.exists():
    app.mount("/", StaticFiles(directory=dist, html=True), name="ui")
