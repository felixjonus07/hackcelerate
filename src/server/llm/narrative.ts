/**
 * Narrative orchestration: cache → model → validate (one retry) → fallback.
 * The rules engine owns every number; the model writes language only (§9.1).
 * Dependencies are injectable so the adversarial suite can replay recorded model outputs.
 */
import { cacheGet, cacheSet, hashKey } from "../cache";
import { llmEnabled } from "../env";
import { logger } from "../logger";
import type { Policy } from "../policy/schema";
import { callModel as liveCallModel, type ModelCall } from "./adapter";
import { FALLBACK_NOTICE, templatedNarrative } from "./fallback";
import { buildFacts, buildMessages, type FactsInput, PROMPT_VERSION } from "./prompt";
import type { Narrative } from "./schema";
import { validateNarrative } from "./validator";

export interface NarrativeResult {
  narrative: Narrative;
  fallback: boolean;
  notice: string | null;
  model: Pick<ModelCall, "provider" | "model" | "promptVersion"> | null;
  removed: { field: string; sentence: string; check: string }[];
  warnings: string[];
  /** Model calls made for this narrative (0 when no model was used). */
  attempts: number;
  /** The first model output parsed and matched the schema without a retry (§15.2). */
  firstAttemptOk: boolean;
  /** Ids of evidence whose free text was cut to the length cap before the model saw it. */
  truncations: string[];
}

export interface NarrativeDeps {
  /** Defaults to whether an OpenRouter key is configured. */
  enabled?: boolean;
  callModel?: (
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    promptVersion: string,
  ) => Promise<ModelCall>;
  /** `null` turns the cache off. */
  cache?: {
    get: <T>(key: string) => Promise<T | null>;
    set: (key: string, value: unknown, ttl: number) => Promise<void>;
  } | null;
}

export async function generateNarrative(
  input: FactsInput,
  policy: Policy,
  deps: NarrativeDeps = {},
): Promise<NarrativeResult> {
  const enabled = deps.enabled ?? llmEnabled;
  const call = deps.callModel ?? liveCallModel;
  const cache = deps.cache === undefined ? { get: cacheGet, set: cacheSet } : deps.cache;
  const { layer, truncations } = buildFacts(input, policy);
  if (truncations.length) logger.info({ truncations }, "untrusted text truncated before model call");

  const fallback = (extra: Partial<NarrativeResult> = {}): NarrativeResult => ({
    narrative: templatedNarrative(input, policy),
    fallback: true,
    notice: FALLBACK_NOTICE,
    model: null,
    removed: [],
    warnings: [],
    attempts: 0,
    firstAttemptOk: false,
    truncations,
    ...extra,
  });
  if (!enabled) return fallback();

  const key = `narrative:${hashKey(layer, policy.policy_version, PROMPT_VERSION)}`;
  const hit = await cache?.get<NarrativeResult>(key);
  if (hit) return hit;

  const messages = buildMessages(layer, policy);
  let attempts = 0;
  try {
    attempts++;
    let first = await call(messages, PROMPT_VERSION);
    let v = validateNarrative(first.content, layer);
    const firstAttemptOk = !v.failedAt;
    if (v.failedAt) {
      // One retry with the parser/schema error included (§9.3 steps 1–2).
      attempts++;
      first = await call(
        [
          ...messages,
          { role: "assistant", content: first.content },
          {
            role: "user",
            content: `That output failed ${v.failedAt} validation: ${v.error?.slice(0, 500)}. Return corrected JSON only.`,
          },
        ],
        PROMPT_VERSION,
      );
      v = validateNarrative(first.content, layer);
    }
    if (!v.narrative || !v.ok) return fallback({ warnings: v.warnings, removed: v.removed, attempts, firstAttemptOk });
    const result: NarrativeResult = {
      narrative: v.narrative,
      fallback: false,
      notice: null,
      model: { provider: first.provider, model: first.model, promptVersion: first.promptVersion },
      removed: v.removed,
      warnings: v.warnings,
      attempts,
      firstAttemptOk,
      truncations,
    };
    await cache?.set(key, result, 60 * 60 * 24 * 14);
    return result;
  } catch (err) {
    logger.warn({ err: String(err) }, "model unavailable; using templated fallback");
    return fallback({ attempts });
  }
}
