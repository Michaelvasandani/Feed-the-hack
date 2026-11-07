import "./env.js";
import cors from "cors";
import express, { type Response } from "express";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyVideos } from "./classify.js";
import { env } from "./env.js";
import { fetchVideos } from "./fetch.js";
import { askBoard, discoverCreators, draftMessage, generateSampleVideo, nextBrief, sampleVideoStatus } from "./insights.js";
import { buildBoard } from "./metrics.js";
import type { Board, Campaign, VideosFile } from "./types.js";

const ROOT = resolve(process.cwd(), "..");
const DATA = resolve(process.cwd(), "data");
mkdirSync(resolve(DATA, "boards"), { recursive: true });

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "campaign";
const store = {
  read<T>(kind: string, id: string): T | null {
    const p = resolve(DATA, kind, `${slug(id)}.json`);
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  },
  write(kind: string, id: string, data: unknown) {
    mkdirSync(resolve(DATA, kind), { recursive: true });
    writeFileSync(resolve(DATA, kind, `${slug(id)}.json`), JSON.stringify(data));
  },
};

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const wrap = (fn: (req: express.Request, res: Response) => Promise<unknown>) => (req: express.Request, res: Response) =>
  fn(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: String(e?.message ?? e) });
  });

app.get("/api/health", (_req, res) => res.json({ ok: true, oriane: !!env.oriane, gmi: !!env.gmi, model: env.llmModel }));

/** Same-origin image proxy so WebGL can texture Oriane thumbnails (content images lack CORS headers). */
app.get("/api/img", wrap(async (req, res) => {
  const u = new URL(String(req.query.u ?? ""));
  if (u.protocol !== "https:" || !u.hostname.endsWith(".oriane.xyz")) return res.status(400).end();
  const r = await fetch(u);
  if (!r.ok) return res.status(r.status).end();
  res.setHeader("Content-Type", r.headers.get("content-type") ?? "image/webp");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.end(Buffer.from(await r.arrayBuffer()));
}));

app.get("/api/demo-campaign", (_req, res) => res.json(JSON.parse(readFileSync(resolve(ROOT, "fixtures/campaign.json"), "utf8"))));

/** Thumbnails for the landing-page 3D wall: from saved boards, falling back to the fixtures. */
app.get("/api/showcase", (_req, res) => {
  const dir = resolve(DATA, "boards");
  const urls = new Set<string>();
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    for (const v of (JSON.parse(readFileSync(resolve(dir, f), "utf8")) as Board).videos) if (v.thumbnailUrl) urls.add(v.thumbnailUrl);
  }
  for (const v of (JSON.parse(readFileSync(resolve(ROOT, "fixtures/videos.json"), "utf8")) as VideosFile).videos) if (v.thumbnailUrl) urls.add(v.thumbnailUrl);
  res.json([...urls].slice(0, 28));
});

app.get("/api/boards", (_req, res) => {
  const dir = resolve(DATA, "boards");
  const list = existsSync(dir)
    ? readdirSync(dir).map((f) => {
        const b: Board = JSON.parse(readFileSync(resolve(dir, f), "utf8"));
        return { id: b.campaign.id, brandName: b.campaign.brandName, videos: b.totals.videos, views: b.totals.views, generatedAt: b.generatedAt };
      })
    : [];
  res.json(list);
});

app.get("/api/campaigns/:id", (req, res) => {
  const c = store.read<Campaign>("campaigns", String(req.params.id));
  c ? res.json(c) : res.status(404).json({ error: "not found" });
});

app.get("/api/boards/:id", (req, res) => {
  const b = store.read<Board>("boards", String(req.params.id));
  b ? res.json(b) : res.status(404).json({ error: "not found" });
});

/** Run the whole pipeline: fetch → classify → metrics. Streams progress as NDJSON lines. */
app.post("/api/run", wrap(async (req, res) => {
  const campaign: Campaign = req.body.campaign;
  const source: "live" | "fixtures" = req.body.source ?? "live";
  if (!campaign?.brand?.name || !campaign.creators?.length) return res.status(400).json({ error: "campaign with brand and creators required" });
  campaign.id ||= slug(`${campaign.brand.name}-${campaign.window.start}`);
  campaign.brand.aliases = campaign.brand.aliases?.length ? campaign.brand.aliases : [campaign.brand.name.toLowerCase()];

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  const send = (o: unknown) => res.write(JSON.stringify(o) + "\n");
  const log = (message: string) => send({ type: "progress", message });

  try {
    store.write("campaigns", campaign.id, campaign);
    let vf: VideosFile;
    if (source === "fixtures") {
      log("Loading sample videos from fixtures…");
      vf = JSON.parse(readFileSync(resolve(ROOT, "fixtures/videos.json"), "utf8"));
    } else {
      vf = await fetchVideos(campaign, log);
    }
    send({ type: "stage", stage: "classify" });
    vf.videos = await classifyVideos(vf.videos, campaign.brand.name, log);
    send({ type: "stage", stage: "metrics" });
    const board = buildBoard(campaign, vf);
    store.write("boards", campaign.id, board);
    log("Board ready.");
    send({ type: "done", board });
  } catch (e: any) {
    console.error(e);
    send({ type: "error", message: String(e?.message ?? e) });
  }
  res.end();
}));

const needBoard = (id: string) => {
  const b = store.read<Board>("boards", id);
  if (!b) throw new Error("Board not found — run the campaign first");
  return b;
};

app.post("/api/boards/:id/discover", wrap(async (req, res) => {
  const c = store.read<Campaign>("campaigns", String(req.params.id));
  if (!c) return res.status(404).json({ error: "campaign not found" });
  const cached = store.read<any>("discover", String(req.params.id));
  if (cached && !req.body?.refresh) return res.json(cached);
  const out = await discoverCreators(c);
  store.write("discover", String(req.params.id), out);
  res.json(out);
}));

app.post("/api/boards/:id/draft", wrap(async (req, res) => {
  const b = needBoard(String(req.params.id));
  const cr = b.creators.find((c) => c.name === req.body.creatorName);
  if (!cr) return res.status(404).json({ error: "creator not found" });
  res.json(await draftMessage(b, cr));
}));

app.post("/api/boards/:id/brief", wrap(async (req, res) => {
  const cached = store.read<any>("briefs", String(req.params.id));
  if (cached && !req.body?.refresh) return res.json(cached);
  const out = await nextBrief(needBoard(String(req.params.id)));
  store.write("briefs", String(req.params.id), out);
  res.json(out);
}));

app.post("/api/boards/:id/ask", wrap(async (req, res) => {
  res.json({ answer: await askBoard(needBoard(String(req.params.id)), String(req.body.question ?? "")) });
}));

app.post("/api/video", wrap(async (req, res) => res.json(await generateSampleVideo(String(req.body.prompt ?? "")))));

/** Poll a generation; on success, save the MP4 locally (provider links expire) and remember it for the board. */
app.get("/api/video/:requestId", wrap(async (req, res) => {
  const s = await sampleVideoStatus(String(req.params.requestId));
  const boardId = req.query.board ? slug(String(req.query.board)) : null;
  if (s.videoUrl && boardId) {
    const file = resolve(DATA, "videos", `${boardId}.mp4`);
    mkdirSync(resolve(DATA, "videos"), { recursive: true });
    const r = await fetch(s.videoUrl);
    if (r.ok) {
      writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      return res.json({ ...s, videoUrl: `/api/boards/${boardId}/video.mp4?t=${Date.now()}` });
    }
  }
  res.json(s);
}));
app.get("/api/boards/:id/video.mp4", (req, res) => {
  const file = resolve(DATA, "videos", `${slug(String(req.params.id))}.mp4`);
  existsSync(file) ? res.sendFile(file) : res.status(404).end();
});

// Serve the built web app (single-process deploy, e.g. on a GMI Cloud container).
const dist = resolve(ROOT, "web/dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(resolve(dist, "index.html")));
}

app.listen(env.port, () => console.log(`API on http://localhost:${env.port}`));
