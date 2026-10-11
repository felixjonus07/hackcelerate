/**
 * Narrative orchestration: cache → model → validate (one retry) → fallback.
 * The rules engine owns every number; the model writes language only (§9.1).
 */
import { cacheGet, cacheSet, hashKey } from "../cache";
import { llmEnabled } from "../env";
import { logger } from "../logger";
import type { Policy } from "../policy/schema";
import { callModel, type ModelCall } from "./adapter";
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
}

export async function generateNarrative(input: FactsInput, policy: Policy): Promise<NarrativeResult> {
  const { layer, truncations } = buildFacts(input, policy);
  if (truncations.length) logger.info({ truncations }, "untrusted text truncated before model call");

  const fallback = (warnings: string[] = []): NarrativeResult => ({
    narrative: templatedNarrative(input, policy),
    fallback: true,
    notice: FALLBACK_NOTICE,
    model: null,
    removed: [],
    warnings,
  });
  if (!llmEnabled) return fallback();

  const key = `narrative:${hashKey(layer, policy.policy_version, PROMPT_VERSION)}`;
  const hit = await cacheGet<NarrativeResult>(key);
  if (hit) return hit;

  const messages = buildMessages(layer, policy);
  try {
    let call = await callModel(messages, PROMPT_VERSION);
    let v = validateNarrative(call.content, layer);
    if (v.failedAt) {
      // One retry with the parser/schema error included (§9.3 steps 1–2).
      call = await callModel(
        [
          ...messages,
          { role: "assistant", content: call.content },
          {
            role: "user",
            content: `That output failed ${v.failedAt} validation: ${v.error?.slice(0, 500)}. Return corrected JSON only.`,
          },
        ],
        PROMPT_VERSION,
      );
      v = validateNarrative(call.content, layer);
    }
    if (!v.narrative || !v.ok) return fallback(v.warnings);
    const result: NarrativeResult = {
      narrative: v.narrative,
      fallback: false,
      notice: null,
      model: {
        provider: call.provider,
        model: call.model,
        promptVersion: call.promptVersion,
      },
      removed: v.removed,
      warnings: v.warnings,
    };
    await cacheSet(key, result, 60 * 60 * 24 * 14);
    return result;
  } catch (err) {
    logger.warn({ err: String(err) }, "model unavailable; using templated fallback");
    return fallback();
  }
}
