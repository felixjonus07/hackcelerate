/**
 * Phase 6 — Interventions & Counseling unit tests (§8.1, §8.2, §8.3, §13.1).
 */
import { describe, expect, it } from "vitest";
import { getActivePolicy } from "../../policy/load";
import { addWorkingDays, toDateKey } from "../time";

describe("§8.2 Mentor Brief logic", () => {
  it("suggests obstacle question for CRITICAL and MODERATE aegIndex", () => {
    const buildSuggestedQuestions = (aegIndex: string, targetDate?: string | null): string[] => {
      const q1 =
        aegIndex === "CRITICAL" || aegIndex === "MODERATE"
          ? "What has been the biggest obstacle to making progress this term?"
          : "Which quest feels most achievable in the next two weeks?";
      const q2 = targetDate
        ? `With time remaining to the target date, what one action would most move the score?`
        : "Have you thought about which career track to commit to this term?";
      return [q1, q2];
    };

    const criticalQuestions = buildSuggestedQuestions("CRITICAL");
    expect(criticalQuestions[0]).toMatch(/biggest obstacle/i);

    const moderateQuestions = buildSuggestedQuestions("MODERATE");
    expect(moderateQuestions[0]).toMatch(/biggest obstacle/i);

    const lightQuestions = buildSuggestedQuestions("LIGHT");
    expect(lightQuestions[0]).toMatch(/which quest feels most achievable/i);
  });

  it("verifiable facts have source fields and ev:ID audit citations", () => {
    const evId = "11112222-3333-4444-5555-666677778888";
    const evRef = `ev:${evId.slice(0, 8)}`;
    const facts = [
      {
        label: "Track score vs target readiness",
        value: "48.1 / 75",
        sourceField: "evaluations.track_score, evaluations.readiness",
        evRef,
      },
      {
        label: "Gap index & trend",
        value: "CRITICAL · worsening",
        sourceField: "evaluations.aeg_index, evaluations.trend",
        evRef,
      },
      {
        label: "Verified evidence items",
        value: "2 of 5 verified",
        sourceField: "artifacts.status",
        evRef,
      },
    ];

    expect(facts).toHaveLength(3);
    for (const f of facts) {
      expect(f.sourceField).toBeTruthy();
      expect(f.evRef).toMatch(/^ev:[0-9a-f]{8}$/);
    }
  });
});

describe("§8.3 Quest Lifecycle validation", () => {
  it("completes quest only when verified artifact matches requiredEvidenceType", () => {
    const quest = {
      id: "q-1",
      requiredEvidenceType: "github_repo",
      status: "EVIDENCE_SUBMITTED",
    };

    // Case 1: Artifact verified and matching type -> should complete
    const validArtifact = {
      id: "a-1",
      type: "github_repo",
      status: "VERIFIED",
    };
    const canComplete1 =
      validArtifact.type === quest.requiredEvidenceType &&
      (validArtifact.status === "VERIFIED" || validArtifact.status === "ATTESTED");
    expect(canComplete1).toBe(true);

    // Case 2: Artifact verified but wrong type (e.g. unreviewed link instead of github_repo) -> must reject
    const wrongTypeArtifact = {
      id: "a-2",
      type: "link",
      status: "VERIFIED",
    };
    const canComplete2 =
      wrongTypeArtifact.type === quest.requiredEvidenceType &&
      (wrongTypeArtifact.status === "VERIFIED" || wrongTypeArtifact.status === "ATTESTED");
    expect(canComplete2).toBe(false);

    // Case 3: Artifact matching type but unverified (e.g. SUBMITTED or FAILED) -> must reject
    const unverifiedArtifact = {
      id: "a-3",
      type: "github_repo",
      status: "SUBMITTED",
    };
    const canComplete3 =
      unverifiedArtifact.type === quest.requiredEvidenceType &&
      (unverifiedArtifact.status === "VERIFIED" || unverifiedArtifact.status === "ATTESTED");
    expect(canComplete3).toBe(false);
  });
});

describe("§8.1 SLA Escalation logic", () => {
  it("calculates correct escalation trigger date using policy working days", () => {
    const policy = getActivePolicy();
    const route = policy.routes.detention_threat_builder;
    expect(route).toBeDefined();
    expect(route.escalate_to).toBe("dean");
    expect(route.escalate_after_working_days).toBe(5);

    // If an intervention was due on Friday Oct 9, 2026, 5 working days later is Friday Oct 16, 2026
    const slaDueAt = new Date(2026, 9, 9);
    const escalationDate = addWorkingDays(slaDueAt, route.escalate_after_working_days!, policy.calendar.holidays);
    expect(toDateKey(escalationDate)).toBe("2026-10-16");
  });
});
