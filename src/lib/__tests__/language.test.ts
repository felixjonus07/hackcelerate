import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { GAP_STUDENT, TREND_STUDENT, VERIFICATION_LABELS } from "../labels";
import { LANGUAGE_AVOID, PERSONA_TERMS, STUDENT_BANNED } from "../language";

/**
 * Language standards linter (§14.3). Student-facing copy must never carry persona names or the
 * discouraged phrases. Sources that only staff see are not scanned; student screens, components and
 * the generators that write student text are.
 */
const ROOT = join(__dirname, "..", "..", "..");
const STUDENT_SOURCES = [
  "src/app/student",
  "src/components/passport",
  "src/components/what-if",
  "src/components/consent",
  "src/components/onboarding",
  "src/server/llm/fallback.ts",
  "src/server/services/wellbeing.ts",
  "src/server/services/remediation.ts",
  "src/server/services/quests.ts",
];

function files(path: string): string[] {
  const abs = join(ROOT, path);
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__"))
    .map((f) => join(abs, f));
}

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("language standards (§14.3)", () => {
  for (const source of STUDENT_SOURCES) {
    for (const file of files(source)) {
      it(`${relative(ROOT, file)} has no discouraged phrases`, () => {
        const text = stripComments(readFileSync(file, "utf8"));
        for (const banned of STUDENT_BANNED) {
          expect(text.match(banned)?.[0] ?? null, `matched ${banned}`).toBeNull();
        }
      });
    }
  }

  it("student label sets carry no discouraged phrase", () => {
    const copy = [
      ...Object.values(GAP_STUDENT),
      ...Object.values(TREND_STUDENT),
      ...Object.values(VERIFICATION_LABELS),
    ];
    for (const line of copy) for (const banned of STUDENT_BANNED) expect(line).not.toMatch(banned);
  });

  it("every discouraged phrase in the standard is caught by the linter", () => {
    for (const phrase of LANGUAGE_AVOID) {
      expect(
        STUDENT_BANNED.some((re) => re.test(phrase)),
        `"${phrase}" is not covered`,
      ).toBe(true);
    }
    expect(PERSONA_TERMS.length).toBeGreaterThan(0);
  });
});
