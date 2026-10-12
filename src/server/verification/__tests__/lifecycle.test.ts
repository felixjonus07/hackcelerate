/** Evidence lifecycle (§6.1): the table is enforced exhaustively, by actor, and re-checks follow it. */
import { describe, expect, it } from "vitest";
import { loadPolicyFile } from "../../policy/file";
import { VERIFICATION_STATUSES, type VerificationStatus } from "../../policy/schema";
import {
  afterRecheck,
  assertTransition,
  attestationExpired,
  canTransition,
  nextCheckAfter,
  TRANSITIONS,
  TransitionError,
} from "../lifecycle";

const policy = loadPolicyFile();

describe("the transition table", () => {
  const pairs = VERIFICATION_STATUSES.flatMap((f) => VERIFICATION_STATUSES.map((t) => [f, t] as const));

  it.each(pairs)("%s → %s is allowed only if the table lists it", (from, to) => {
    expect(canTransition(from, to)).toBe(TRANSITIONS[from].includes(to));
  });

  it("matches §6.1 for the states the plan names", () => {
    expect(TRANSITIONS.SUBMITTED).toEqual(["UNDER_CHECK"]);
    expect(TRANSITIONS.UNDER_CHECK).toEqual(
      expect.arrayContaining(["VERIFIED", "LIVE_UNVERIFIED", "SELF_REPORTED", "UNVERIFIED"]),
    );
    expect(TRANSITIONS.ATTESTED).toEqual(["REJECTED", "STALE"]);
    expect(TRANSITIONS.VERIFIED).toEqual(["STALE"]);
    expect(TRANSITIONS.STALE).toEqual(["VERIFIED", "UNVERIFIED"]);
    expect(TRANSITIONS.REJECTED).toEqual(["SUBMITTED"]); // the student may resubmit with new evidence
  });

  it("nothing jumps straight to VERIFIED or ATTESTED from a student's submission", () => {
    expect(canTransition("SUBMITTED", "VERIFIED")).toBe(false);
    expect(canTransition("SUBMITTED", "ATTESTED")).toBe(false);
    expect(canTransition("UNVERIFIED", "VERIFIED")).toBe(false);
  });
});

describe("who may set a state", () => {
  it("only the system sets VERIFIED, and only a named reviewer sets ATTESTED", () => {
    expect(canTransition("UNDER_CHECK", "VERIFIED", "system")).toBe(true);
    expect(canTransition("UNDER_CHECK", "VERIFIED", "student")).toBe(false);
    expect(canTransition("UNDER_CHECK", "VERIFIED", "reviewer")).toBe(false);
    expect(canTransition("UNDER_CHECK", "ATTESTED", "reviewer")).toBe(true);
    expect(canTransition("UNDER_CHECK", "ATTESTED", "system")).toBe(false);
    expect(canTransition("SELF_REPORTED", "ATTESTED", "student")).toBe(false);
  });
  it("a student only submits", () => {
    expect(canTransition("REJECTED", "SUBMITTED", "student")).toBe(true);
    expect(canTransition("UNVERIFIED", "SUBMITTED", "student")).toBe(true);
    expect(canTransition("SUBMITTED", "UNDER_CHECK", "student")).toBe(false);
  });
  it("either a reviewer or the system may reject", () => {
    expect(canTransition("UNDER_CHECK", "REJECTED", "reviewer")).toBe(true);
    expect(canTransition("SELF_REPORTED", "REJECTED", "system")).toBe(true);
    expect(canTransition("ATTESTED", "REJECTED", "student")).toBe(false);
  });
  it("assertTransition throws a clear error for a forbidden move", () => {
    expect(() => assertTransition("VERIFIED", "ATTESTED", "reviewer")).toThrow(TransitionError);
    expect(() => assertTransition("UNDER_CHECK", "VERIFIED", "student")).toThrow(/student cannot set VERIFIED/);
    expect(() => assertTransition("UNDER_CHECK", "VERIFIED", "system")).not.toThrow();
  });
});

describe("re-checks (§6.1): one failure makes it stale, two make it unverified", () => {
  const cases: [VerificationStatus, boolean, VerificationStatus][] = [
    ["VERIFIED", true, "VERIFIED"],
    ["VERIFIED", false, "STALE"],
    ["STALE", true, "VERIFIED"],
    ["STALE", false, "UNVERIFIED"],
    ["LIVE_UNVERIFIED", true, "LIVE_UNVERIFIED"],
    ["LIVE_UNVERIFIED", false, "STALE"],
    ["ATTESTED", false, "ATTESTED"],
    ["SELF_REPORTED", false, "SELF_REPORTED"],
  ];
  it.each(cases)("%s with pass=%s → %s", (from, passed, to) => {
    expect(afterRecheck(from, passed)).toBe(to);
  });
  it("every outcome of a re-check is a legal transition", () => {
    for (const [from, passed] of cases) {
      const next = afterRecheck(from, passed);
      if (next !== from) expect(canTransition(from, next, "system")).toBe(true);
    }
  });
});

describe("when the next check is due", () => {
  const from = new Date("2026-10-11T00:00:00Z");
  const days = (d: Date | null) => (d ? Math.round((+d - +from) / 86_400_000) : null);
  it("GitHub every 30 days, portfolios every 30 days", () => {
    expect(days(nextCheckAfter("VERIFIED", "github", from, policy))).toBe(30);
    expect(days(nextCheckAfter("LIVE_UNVERIFIED", "link", from, policy))).toBe(30);
  });
  it("DOIs and certificates are checked at submission only", () => {
    expect(nextCheckAfter("VERIFIED", "crossref", from, policy)).toBeNull();
    expect(nextCheckAfter("VERIFIED", "certificate", from, policy)).toBeNull();
  });
  it("an attestation is reviewed again after its review period, and lapses then", () => {
    expect(days(nextCheckAfter("ATTESTED", "reviewer", from, policy))).toBe(policy.verification.attested_review_days);
    expect(attestationExpired(from, new Date(+from + 364 * 86_400_000), policy)).toBe(false);
    expect(attestationExpired(from, new Date(+from + 365 * 86_400_000), policy)).toBe(true);
  });
  it("states that are not re-checked have no due date", () => {
    expect(nextCheckAfter("UNVERIFIED", "github", from, policy)).toBeNull();
    expect(nextCheckAfter("REJECTED", "link", from, policy)).toBeNull();
  });
});
