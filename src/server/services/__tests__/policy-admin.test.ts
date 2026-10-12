/** Policy versions end to end (§3.3): drafts, approvals, activation, re-evaluation, the reported-period guard. */
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db";
import { auditEvents, policyVersions } from "../../db/schema";
import { loadPolicyFile } from "../../policy/file";
import { getActivePolicy, getActivePolicyInfo, invalidatePolicyCache } from "../../policy/load";
import type { Policy } from "../../policy/schema";
import { ME_27 } from "../../rules/fixtures";
import { dbAvailable } from "../../testing/db";
import { insertEvaluation, insertStudent, insertUser } from "../../testing/fixtures";
import { approveVersion, createDraft, listPolicyVersions, PolicyError, rolloverPolicies } from "../policy-admin";
import { enqueueReevaluation, studentsNeedingReevaluation } from "../reevaluation";

const queued: { name: string; data: unknown; jobId?: string }[] = [];
vi.mock("../../queue", () => ({
  enqueue: async (name: string, data: unknown, jobId?: string) => {
    queued.push({ name, data, jobId });
  },
}));

const up = await dbAvailable();
const base = loadPolicyFile();
const draft = (version: string, edit: (p: Policy) => void = () => undefined) => {
  const p = structuredClone(base);
  p.policy_version = version;
  p.effective_from = "2026-10-12";
  edit(p);
  return p;
};

describe.skipIf(!up)("policy administration", () => {
  let registrar: { id: string; role: string };
  let dean: { id: string; role: string };
  let mentor: { id: string; role: string };

  beforeAll(async () => {
    registrar = { ...(await insertUser(db, "registrar")), role: "registrar" };
    dean = { ...(await insertUser(db, "dean")), role: "dean" };
    mentor = { ...(await insertUser(db, "faculty_mentor")), role: "faculty_mentor" };
  });
  beforeEach(() => {
    queued.length = 0;
    invalidatePolicyCache();
  });

  it("falls back to the file when no version is active", async () => {
    const info = await getActivePolicyInfo();
    expect(info.source).toBe("file");
    expect(info.policy.policy_version).toBe(base.policy_version);
  });

  it("drafts a version and works out how many approvals its change needs", async () => {
    const other = await createDraft(
      registrar,
      draft("t-attendance", (p) => {
        p.attendance.requirement_pct = 80;
      }),
    );
    // First version ever: nothing was in force in the database, so the file is compared and attendance changed alone.
    expect(other).toMatchObject({ status: "DRAFT", approvalsRequired: 1, changedSections: ["attendance"] });

    const persona = await createDraft(
      registrar,
      draft("t-persona", (p) => {
        p.personas.detention_threat_builder.attendance_below_pct = 60;
      }),
    );
    expect(persona.approvalsRequired).toBe(2);
    expect(persona.changedSections).toEqual(["personas"]);
    expect((await listPolicyVersions()).map((v) => v.version)).toEqual(
      expect.arrayContaining(["t-attendance", "t-persona"]),
    );
  });

  it("rejects a duplicate version and an invalid document", async () => {
    await expect(createDraft(registrar, draft("t-attendance"))).rejects.toMatchObject({ code: "exists" });
    await expect(createDraft(registrar, { policy_version: "x" })).rejects.toThrow();
  });

  it("activates a one-approval change on the first approval and retires what it replaces", async () => {
    const r = await approveVersion(registrar, "t-attendance");
    expect(r).toEqual({ status: "ACTIVE", approvals: 1, required: 1 });
    invalidatePolicyCache();
    const info = await getActivePolicyInfo(new Date("2026-10-13"));
    expect(info.source).toBe("database");
    expect(info.policy).toMatchObject({ policy_version: "t-attendance", status: "ACTIVE" });
    expect(info.policy.attendance.requirement_pct).toBe(80);
    expect((await getActivePolicy()).policy_version).toBe("t-attendance");
    // Activation flags every student for re-evaluation under the new version.
    expect(queued.every((q) => q.name === "evaluation")).toBe(true);
  });

  it("needs two approvals from different offices for a persona change", async () => {
    await expect(approveVersion(mentor, "t-persona")).rejects.toMatchObject({ code: "approver" });
    expect(await approveVersion(registrar, "t-persona")).toEqual({ status: "DRAFT", approvals: 1, required: 2 });
    await expect(approveVersion(registrar, "t-persona")).rejects.toMatchObject({ code: "approver" });
    const second = await approveVersion(dean, "t-persona");
    expect(second).toEqual({ status: "ACTIVE", approvals: 2, required: 2 });

    const rows = await db.select().from(policyVersions);
    const byVersion = Object.fromEntries(rows.map((r) => [r.version, r]));
    expect(byVersion["t-persona"].approvals.map((a) => a.role)).toEqual(["registrar", "dean"]);
    expect(byVersion["t-persona"].status).toBe("ACTIVE");
    // Both versions start tomorrow, so neither has replaced the other yet.
    expect(byVersion["t-attendance"].status).toBe("ACTIVE");
    // Once the newer version's date arrives, the rollover retires the one it supersedes.
    expect(await rolloverPolicies(new Date("2026-10-13"))).toEqual(["t-attendance"]);
    const after = await db.select().from(policyVersions).where(eq(policyVersions.version, "t-attendance"));
    expect(after[0].status).toBe("RETIRED");
    expect(after[0].retiredAt).toBeInstanceOf(Date);
    expect(await rolloverPolicies(new Date("2026-10-13"))).toEqual([]);
  });

  it("refuses to approve a version that is no longer a draft, or does not exist", async () => {
    await expect(approveVersion(dean, "t-persona")).rejects.toMatchObject({ code: "not_draft" });
    await expect(approveVersion(dean, "nope")).rejects.toMatchObject({ code: "not_found" });
  });

  it("blocks a version that would start inside a period already reported to the auditors", async () => {
    await createDraft(
      registrar,
      draft("t-late", (p) => {
        p.leaderboard.default_opt_in = true;
        p.effective_from = "2026-10-01"; // earlier than the report below, so it would rewrite a reported period
      }),
    );
    await db.insert(auditEvents).values({
      actorUserId: dean.id,
      actorRole: "dean",
      action: "audit_report.export",
      entityType: "report",
      entityId: "t-persona",
      purpose: "audit_request",
      policyVersion: "t-persona",
      result: "allowed",
    });
    const err = await approveVersion(registrar, "t-late").catch((e) => e);
    expect(err).toBeInstanceOf(PolicyError);
    expect(err.code).toBe("retroactive");
    expect((await db.select().from(policyVersions).where(eq(policyVersions.version, "t-late")))[0].status).toBe(
      "DRAFT",
    );
  });
});

describe.skipIf(!up)("re-evaluation after a policy change", () => {
  beforeEach(() => {
    queued.length = 0;
  });

  it("flags students whose latest evaluation used another version, and those never evaluated", async () => {
    const evaluated = await insertStudent(db);
    const fresh = await insertStudent(db);
    const never = await insertStudent(db);
    await insertEvaluation(db, evaluated.id, ME_27); // written under 2026.10-v1
    await insertEvaluation(db, fresh.id, ME_27);

    const underOld = await studentsNeedingReevaluation("2099.1-v9");
    expect(underOld).toEqual(expect.arrayContaining([evaluated.id, fresh.id, never.id]));
    const underCurrent = await studentsNeedingReevaluation(base.policy_version);
    expect(underCurrent).toContain(never.id);
    expect(underCurrent).not.toContain(evaluated.id);
  });

  it("queues one job per affected student with a stable id, so a repeat is a no-op", async () => {
    const r = await enqueueReevaluation("2099.2-v1", "user-1");
    expect(r.queued).toBe(r.affected);
    expect(queued.length).toBe(r.affected);
    expect(queued[0]).toMatchObject({ name: "evaluation", data: { reason: "policy_change", requestedBy: "user-1" } });
    expect(queued.every((q) => q.jobId?.startsWith("reeval-2099.2-v1-"))).toBe(true);
  });
});
