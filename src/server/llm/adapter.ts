/**
 * OpenRouter adapter (§9.4). Records provider, model, temperature and prompt
 * version for every call. The model has no tools and cannot write anywhere.
 */
import { env } from "../env";

export interface ModelCall {
  provider: "openrouter";
  model: string;
  temperature: number;
  promptVersion: string;
  latencyMs: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  content: string;
}

export class LlmUnavailableError extends Error {}

export async function callModel(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  promptVersion: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ModelCall> {
  if (!env.OPENROUTER_API_KEY) throw new LlmUnavailableError("OPENROUTER_API_KEY is not set");
  const started = Date.now();
  const res = await fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.APP_URL,
      "X-Title": "AspirEdge AI",
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL,
      temperature: env.OPENROUTER_TEMPERATURE,
      messages,
      response_format: { type: "json_object" },
      max_tokens: 1600,
      provider: {
        data_collection: "deny",
      },
    }),
    signal: opts.signal ?? AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new LlmUnavailableError(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: ModelCall["usage"];
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new LlmUnavailableError("Empty completion");
  return {
    provider: "openrouter",
    model: env.OPENROUTER_MODEL,
    temperature: env.OPENROUTER_TEMPERATURE,
    promptVersion,
    latencyMs: Date.now() - started,
    usage: body.usage,
    content,
  };
}
