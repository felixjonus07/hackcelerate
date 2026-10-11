/** Choosing quests (§9.1): rules decide the components, pgvector orders the rest. */
import { describe, expect, it } from "vitest";
import { db } from "../../db";
import { opportunities, remediationLibrary } from "../../db/schema";
import { embedMissing, nearestOpportunity, remediationDistances } from "../../embeddings";
import { dbAvailable } from "../../testing/db";
import { fakeEmbedder } from "../../testing/fake-embedder";
import { selectRemediation } from "../remediation";

const up = await dbAvailable();
const c = (id: string, componentKey: string, standardItem: string | null = null) => ({
  id,
  componentKey,
  standardItem,
});

describe("selectRemediation (rules)", () => {
  const rows = [
    c("a", "aptitude"),
    c("b", "domain", "gdt"),
    c("c", "domain", "factory"),
    c("d", "mock_interview"),
    c("e", "domain", "sw"),
  ];

  it("orders by the cost of the gap, then prefers an item the student lacks", () => {
    const out = selectRemediation(rows, ["domain", "aptitude"], new Set(["factory"]), null, 5);
    expect(out.map((r) => r.id)).toEqual(["c", "b", "e", "a"]);
  });
  it("drops components with no gap and respects the limit", () => {
    expect(selectRemediation(rows, ["domain"], new Set(), null, 2).map((r) => r.id)).toEqual(["b", "c"]);
  });
  it("uses semantic distance to order items of equal rank", () => {
    const d = new Map([
      ["b", 0.6],
      ["c", 0.2],
      ["e", 0.4],
    ]);
    expect(selectRemediation(rows, ["domain"], new Set(), d, 3).map((r) => r.id)).toEqual(["c", "e", "b"]);
  });
  it("never lets distance override the rule order", () => {
    const d = new Map([
      ["a", 0.0],
      ["b", 0.9],
    ]);
    expect(selectRemediation(rows, ["domain", "aptitude"], new Set(), d, 2).map((r) => r.id)[0]).toBe("b");
  });
});

describe.skipIf(!up)("pgvector matching", () => {
  it("embeds the catalog, ranks the closest remediation item and finds an open opportunity", async () => {
    const [gdt, factory] = await db
      .insert(remediationLibrary)
      .values([
        {
          track: "corporate_placement",
          componentKey: "domain_practical_evidence",
          title: "Take the timed GD&T assessment",
          action: "Complete a timed GD&T assessment on the platform in the campus screening format.",
          defaultTargetDays: 14,
          requiredEvidenceType: "platform_timed_assessment",
        },
        {
          track: "corporate_placement",
          componentKey: "domain_practical_evidence",
          title: "Get your factory log attested",
          action: "Ask the training office to attest your factory internship log.",
          defaultTargetDays: 30,
          requiredEvidenceType: "attested_log",
        },
      ])
      .returning();
    const [open, expired] = await db
      .insert(opportunities)
      .values([
        {
          track: "corporate_placement",
          type: "assessment",
          title: "Campus GD&T screening practice round",
          sourceUrl: "https://example.org/gdt",
          deadline: new Date("2099-01-01"),
          verifiedAt: new Date(),
        },
        {
          track: "corporate_placement",
          type: "assessment",
          title: "Old GD&T screening round",
          sourceUrl: "https://example.org/old",
          deadline: new Date("2020-01-01"),
          verifiedAt: new Date(),
        },
      ])
      .returning();

    const done = await embedMissing(fakeEmbedder);
    expect(done.pending).toBe(0);

    const d = await remediationDistances(
      [gdt.id, factory.id],
      "Timed GD&T assessment: no counted evidence yet",
      fakeEmbedder,
    );
    expect(d?.get(gdt.id)).toBeLessThan(d?.get(factory.id) ?? 0);

    const o = await nearestOpportunity(
      "corporate_placement",
      "Take the timed GD&T assessment",
      new Date(),
      fakeEmbedder,
    );
    expect(o?.id).toBe(open.id);
    expect(o?.id).not.toBe(expired.id); // past its deadline
  });

  it("returns null distances when no embedder is available, so rules decide alone", async () => {
    expect(await remediationDistances(["x"], "anything", async () => null)).toBeNull();
  });
});
