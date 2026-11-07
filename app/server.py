"""Chains the parts: campaign -> fetch -> classify -> metrics -> board, and serves the UI.

Run: .venv/bin/uvicorn app.server:app --reload --port 8000
"""
import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.classify import classify_videos
from app.fetch import OrianeError, fetch_videos
from app.metrics import build_board
from app.relevance import filter_relevant
from app.search import rank_videos

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "fixtures"
OUT = ROOT / "out"

app = FastAPI(title="Campaign Board")


class BoardRequest(BaseModel):
    campaign: dict
    live: bool = True


def run_pipeline(campaign, live):
    videos = fetch_videos(campaign) if live else json.loads((FIXTURES / "videos.json").read_text())
    if live:
        videos = rank_videos(campaign, filter_relevant(campaign, videos))
    # Sample mode must remain offline even when live model keys are configured.
    labeled = classify_videos(videos, backend=None if live else "keyword")
    board = build_board(campaign, labeled)
    OUT.mkdir(exist_ok=True)
    for name, doc in [("videos.json", videos), ("videos.labeled.json", labeled), ("board.json", board)]:
        (OUT / name).write_text(json.dumps(doc, indent=1, ensure_ascii=False))
    return board


@app.get("/")
def index():
    return FileResponse(ROOT / "web" / "index.html")


@app.get("/api/sample-campaign")
def sample_campaign():
    return json.loads((FIXTURES / "campaign.json").read_text())


@app.get("/api/sample-board")
def sample_board():
    return run_pipeline(sample_campaign(), live=False)


@app.post("/api/board")
def board(req: BoardRequest):
    camp = req.campaign
    if not camp.get("brand", {}).get("aliases"):
        raise HTTPException(400, "campaign needs at least one brand alias")
    if not camp.get("creators") and not camp.get("discover"):
        raise HTTPException(400, "add at least one creator, or turn on automatic discovery")
    try:
        return run_pipeline(camp, req.live)
    except OrianeError as e:
        raise HTTPException(502, str(e)) from e
    except (ValueError, KeyError, TypeError) as e:
        raise HTTPException(400, f"Invalid campaign: {e}") from e
