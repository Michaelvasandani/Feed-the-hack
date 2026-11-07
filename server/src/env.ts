import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load the repo-root .env (gitignored) without a dependency.
for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env")]) {
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  break;
}

export const env = {
  oriane: process.env.ORIANE_API_KEY ?? "",
  gmi: process.env.GMI_API_KEY ?? "",
  llmModel: process.env.GMI_LLM_MODEL ?? "openai/gpt-6-luna",
  fastModel: process.env.GMI_FAST_MODEL ?? "google/gemini-3.8-flash",
  videoModel: process.env.GMI_VIDEO_MODEL ?? "kling-3.0-turbo-t2v",
  port: Number(process.env.PORT ?? 8787),
};
