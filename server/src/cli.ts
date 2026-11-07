/**
 * Run pipeline stages on the PLAN.md JSON contracts.
 *   npm run pipeline -- fetch    ../fixtures/campaign.json  out/videos.json
 *   npm run pipeline -- classify ../fixtures/videos.json    out/videos.labeled.json [campaign.json]
 *   npm run pipeline -- metrics  ../fixtures/campaign.json  out/videos.labeled.json  out/board.json
 */
import "./env.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { classifyVideos } from "./classify.js";
import { fetchVideos } from "./fetch.js";
import { buildBoard } from "./metrics.js";

const [stage, a, b, c] = process.argv.slice(2);
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const write = (p: string, d: unknown) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(d, null, 1));
  console.log("wrote", p);
};

if (stage === "fetch") {
  write(b ?? "out/videos.json", await fetchVideos(read(a), console.log));
} else if (stage === "classify") {
  const vf = read(a);
  const brand = c ? read(c).brand.name : "the brand";
  vf.videos = await classifyVideos(vf.videos, brand, console.log);
  write(b ?? "out/videos.labeled.json", vf);
  for (const v of vf.videos) console.log(v.creatorHandle.padEnd(22), String(v.format).padEnd(12), v.formatConfidence?.toFixed(2), v.formatReason);
} else if (stage === "metrics") {
  write(c ?? "out/board.json", buildBoard(read(a), read(b)));
} else {
  console.log("usage: pipeline <fetch|classify|metrics> ...  (see src/cli.ts)");
}
