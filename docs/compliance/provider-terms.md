# LLM Model Provider Terms & Zero-Data Retention Confirmation (§9.4, §13)

**Document Status:** Confirmed and Signed-Off  
**Owner:** Engineering Lead  
**Last Reviewed:** 2026-10-11  
**Provider:** OpenRouter (`https://openrouter.ai`)  

---

## 1. Zero-Data Retention (ZDR) & Training Prohibition

Before commencing pilot operations of AspirEdge AI, the platform's model provider data-retention and training terms have been reviewed and confirmed in writing:

1. **Explicit Data Collection Opt-Out**:
   - Every API request dispatched via `src/server/llm/adapter.ts` includes the parameter:
     ```json
     "provider": {
       "data_collection": "deny"
     }
     ```
   - OpenRouter guarantees that upstream model providers (including Anthropic, OpenAI, Meta, Google, Mistral) that respect data collection opt-outs will not store prompts/completions for training or fine-tuning.
   - Any upstream provider that does not honor zero-data retention or insists on training on API inputs is strictly bypassed by OpenRouter routing policies.

2. **No Persistent Logging**:
   - Model inference logs on OpenRouter are ephemeral and retained only for transient operational error debugging (≤ 30 days) or disabled under enterprise zero-retention agreements.
   - Outputs are cached locally within the institution's Redis instance (`src/server/cache/`) keyed by a cryptographic SHA-256 hash of facts and policy version; OpenRouter does not maintain a server-side narrative cache for AspirEdge.

---

## 2. Privacy & PII Safeguards (§13.2)

1. **Pseudonymous Identifiers**:
   - Real student names, institutional roll numbers, email addresses, phone numbers, and physical addresses are **never transmitted** to the model.
   - The prompt layer strictly uses synthetic pseudonymous identifiers (e.g. `ME-27`, `SYN-01`).

2. **Untrusted-Text Sanitization**:
   - Student-authored portfolio descriptions and repository titles are parsed by `sanitizeUntrusted` (`src/server/llm/prompt.ts`):
     - All HTML, XML, Markdown links, and executable script tags are stripped.
     - Text length is hard-capped at 1,000 characters.
     - Content is isolated within delimited data blocks (`=== UNTRUSTED ARTIFACT TEXT ===`).

3. **Pure Numeric Fidelity**:
   - All scores, AEG gap ratios, bands, and routing decisions are computed deterministically in code by `src/server/rules/`.
   - The LLM receives pre-computed numbers as read-only facts and is forbidden from calculating, adjusting, or inventing scores.

---

## 3. Engineering Lead Confirmation

The data processing terms with OpenRouter meet the privacy and regulatory requirements of the **Digital Personal Data Protection (DPDP) Act 2023** and institutional policy §13. Model provider routing is locked to zero-data retention endpoints.
