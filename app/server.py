"""Chains the parts: campaign -> fetch -> classify -> metrics -> insights -> board, and serves the UI.

The UI is the React app in web/ (Feedboard). In development run it with Vite (`npm run dev` in web/),
which proxies /api here; `npm run build` makes web/dist, which this server then serves itself.

Run: .venv/bin/uvicorn app.server:app --reload --port 8000
"""
import json
import re
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, Response, StreamingResponse

from app import insights
from app.classify import classify_videos
from app.fetch import OrianeError, discover_prospects, fetch_videos
from app.metrics import build_board
from app.relevance import filter_relevant

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "fixtures"
STORE = ROOT / "out" / "store"
DIST = ROOT / "web" / "dist"

app = FastAPI(title="Campaign Board")


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")[:60] or "campaign"


def store_read(kind, id_):
    p = STORE / kind / f"{slug(id_)}.json"
    return json.loads(p.read_text()) if p.exists() else None


def store_write(kind, id_, doc):
    (STORE / kind).mkdir(parents=True, exist_ok=True)
    (STORE / kind / f"{slug(id_)}.json").write_text(json.dumps(doc, ensure_ascii=False))


def need_board(id_):
    b = store_read("boards", id_)
    if not b:
        raise HTTPException(404, "Board not found. Run the campaign first.")
    return b


def run_pipeline(campaign, live, log=lambda msg: None, stage=lambda name: None):
    if live:
        log(f"Searching TikTok & Instagram for {', '.join(campaign['brand']['aliases'])}…")
        videos = fetch_videos(campaign)
    else:
        log("Loading sample videos from fixtures…")
        videos = json.loads((FIXTURES / "videos.json").read_text())
    log(f"Found {len(videos['videos'])} videos ({sum(not v.get('tagged') for v in videos['videos'])} untagged).")
    if campaign.get("discover"):
        videos = filter_relevant(campaign, videos)
    stage("classify")
    log("Labeling formats…")
    labeled = classify_videos(videos)
    stage("metrics")
    log("Reading hooks and comments, writing insights…")
    board = insights.add_insights(build_board(campaign, labeled))
    store_write("boards", campaign["id"], board)
    return board


@app.get("/api/health")
def health():
    import os
    return {"ok": True, "oriane": bool(os.environ.get("ORIANE_API_KEY")), "gmi": bool(os.environ.get("GMI_API_KEY"))}


@app.get("/api/demo-campaign")
def demo_campaign():
    return json.loads((FIXTURES / "campaign.json").read_text())


@app.post("/api/run")
async def run(request: Request):
    """Runs the whole pipeline, streaming progress as NDJSON lines."""
    body = await request.json()
    camp, live = body.get("campaign") or {}, body.get("source", "live") == "live"
    if not camp.get("brand", {}).get("name") or not (camp.get("creators") or camp.get("discover")):
        raise HTTPException(400, "campaign needs a brand and at least one creator")
    camp["id"] = camp.get("id") or slug(f'{camp["brand"]["name"]}-{camp["window"]["start"]}')
    camp["brand"]["aliases"] = camp["brand"].get("aliases") or [camp["brand"]["name"].lower()]
    camp["brand"].setdefault("handles", {})
    store_write("campaigns", camp["id"], camp)
    return StreamingResponse(_stream(camp, live), media_type="application/x-ndjson")


def _stream(camp, live):
    """Yield NDJSON progress lines while the pipeline runs in a worker thread."""
    import queue
    import threading
    q = queue.Queue()

    def work():
        try:
            board = run_pipeline(camp, live, log=lambda m: q.put({"type": "progress", "message": m}),
                                 stage=lambda s: q.put({"type": "stage", "stage": s}))
            q.put({"type": "progress", "message": "Board ready."})
            q.put({"type": "done", "board": board})
        except Exception as e:  # noqa: BLE001 - surface any failure to the UI
            q.put({"type": "error", "message": str(e)})
        q.put(None)

    threading.Thread(target=work, daemon=True).start()
    while (item := q.get()) is not None:
        yield json.dumps(item, ensure_ascii=False) + "\n"


@app.get("/api/boards")
def boards():
    out = []
    for p in sorted((STORE / "boards").glob("*.json")) if (STORE / "boards").exists() else []:
        b = json.loads(p.read_text())
        out.append({"id": b["campaign"]["id"], "brandName": b["campaign"]["brandName"], "videos": b["totals"]["videos"],
                    "views": b["totals"]["views"], "generatedAt": b.get("generatedAt")})
    return out


@app.get("/api/boards/{id_}")
def board(id_: str):
    return need_board(id_)


@app.get("/api/campaigns/{id_}")
def campaign(id_: str):
    c = store_read("campaigns", id_)
    if not c:
        raise HTTPException(404, "not found")
    return c


@app.post("/api/boards/{id_}/discover")
async def discover(id_: str, request: Request):
    body = await request.json() if await request.body() else {}
    camp = store_read("campaigns", id_)
    if not camp:
        raise HTTPException(404, "campaign not found")
    cached = store_read("discover", id_)
    if cached is not None and not body.get("refresh"):
        return cached
    try:
        out = discover_prospects(camp)
    except OrianeError as e:
        raise HTTPException(502, str(e)) from e
    store_write("discover", id_, out)
    return out


@app.post("/api/boards/{id_}/draft")
async def draft(id_: str, request: Request):
    b, name = need_board(id_), (await request.json()).get("creatorName")
    cr = next((c for c in b["creators"] if c["name"] == name), None)
    if not cr:
        raise HTTPException(404, "creator not found")
    return insights.draft_message(b, cr)


@app.post("/api/boards/{id_}/brief")
async def brief(id_: str, request: Request):
    body = await request.json() if await request.body() else {}
    cached = store_read("briefs", id_)
    if cached and not body.get("refresh"):
        return cached
    out = insights.next_brief(need_board(id_))
    store_write("briefs", id_, out)
    return out


@app.post("/api/boards/{id_}/ask")
async def ask(id_: str, request: Request):
    b, q = need_board(id_), str((await request.json()).get("question") or "")
    try:
        return {"answer": insights.ask_board(b, q)}
    except RuntimeError as e:
        raise HTTPException(503, str(e)) from e


@app.post("/api/video")
async def video(request: Request):
    try:
        return insights.submit_sample_video(str((await request.json()).get("prompt") or ""))
    except RuntimeError as e:
        raise HTTPException(502, str(e)) from e


@app.get("/api/video/{request_id}")
def video_status(request_id: str, board: str | None = None):
    """Poll a generation; on success save the MP4 locally (provider links expire)."""
    s = insights.sample_video_status(request_id)
    if s["videoUrl"] and board:
        dest = STORE / "videos" / f"{slug(board)}.mp4"
        dest.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(urllib.request.Request(s["videoUrl"], headers={"User-Agent": "campaign-board/1.0"}),
                                    timeout=120) as r:
            dest.write_bytes(r.read())
        return {**s, "videoUrl": f"/api/boards/{slug(board)}/video.mp4?t={int(time.time() * 1000)}"}
    return s


@app.api_route("/api/boards/{id_}/video.mp4", methods=["GET", "HEAD"])
def saved_video(id_: str):
    p = STORE / "videos" / f"{slug(id_)}.mp4"
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p, media_type="video/mp4")


@app.get("/api/showcase")
def showcase():
    """Thumbnails for the landing-page 3D wall: saved boards first, then the fixtures."""
    urls = []
    docs = [json.loads(p.read_text()) for p in (STORE / "boards").glob("*.json")] if (STORE / "boards").exists() else []
    docs.append(json.loads((FIXTURES / "videos.json").read_text()))
    for d in docs:
        urls += [v["thumbnailUrl"] for v in d["videos"] if v.get("thumbnailUrl") and v["thumbnailUrl"] not in urls]
    return urls[:28]


@app.get("/api/img")
def img(u: str):
    """Same-origin image proxy so WebGL can texture Oriane thumbnails (they lack CORS headers)."""
    p = urlparse(u)
    if p.scheme != "https" or not (p.hostname or "").endswith(".oriane.xyz"):
        raise HTTPException(400)
    with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "campaign-board/1.0"}), timeout=30) as r:
        return Response(r.read(), media_type=r.headers.get("Content-Type", "image/webp"),
                        headers={"Cache-Control": "public, max-age=86400"})


# The built web app (web/dist). Without a build, point people at the Vite dev server.
@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404)
    if not DIST.exists():
        return HTMLResponse("<p>The web app isn't built. Run <code>npm run build</code> in <code>web/</code>, "
                            "or <code>npm run dev</code> there and open http://localhost:5173.</p>")
    f = DIST / path
    return FileResponse(f if path and f.is_file() else DIST / "index.html")
