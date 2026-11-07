import { env } from "./env.js";

const LLM_BASE = "https://api.gmi-serving.com/v1";
const QUEUE_BASE = "https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey";

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string | Part[] };

export async function chat(messages: ChatMessage[], opts: { model?: string; json?: boolean; maxTokens?: number } = {}): Promise<string> {
  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.gmi}` },
    body: JSON.stringify({
      model: opts.model ?? env.llmModel,
      messages,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`GMI chat ${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 300)}`);
  return json.choices?.[0]?.message?.content ?? "";
}

export async function chatJSON<T>(messages: ChatMessage[], opts: { model?: string } = {}): Promise<T> {
  const text = await chat(messages, { ...opts, json: true });
  const m = text.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : text) as T;
}

// ---- Video / image generation (request queue) ----

async function queue(path: string, init?: RequestInit) {
  const res = await fetch(`${QUEUE_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.gmi}`, ...(init?.headers ?? {}) },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GMI queue ${path} ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

export const submitGeneration = (model: string, payload: Record<string, unknown>) =>
  queue("/requests", { method: "POST", body: JSON.stringify({ model, payload }) }) as Promise<{ request_id: string; status: string }>;

export const getGeneration = (id: string) =>
  queue(`/requests/${encodeURIComponent(id)}`) as Promise<{ request_id: string; status: string; outcome: any }>;

export const getModelInfo = (model: string) => queue(`/models/${encodeURIComponent(model)}`);
