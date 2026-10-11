/**
 * Verification job (§6.2): runs the source-specific check for one artifact and moves it through the
 * lifecycle. Network failures never decide a verdict: the item stays where it is and is tried again
 * by the re-check scheduler. A link that stays unreachable for 14 days becomes UNVERIFIED (§4.3).
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { artifacts, studentIdentities, students } from "../db/schema";
import { env } from "../env";
import { checkArtifactUrl, reachabilityWindowExpired } from "../ingestion/quality";
import { getActivePolicy } from "../policy/load";
import type { VerificationStatus } from "../policy/schema";
import { localDate } from "../rules/calendar";
import { applyTransition, type CheckKind } from "./apply";
import { doiFrom } from "./claims";
import { decideDoi, fetchWork, splitName } from "./crossref";
import { flagDuplicateClaim, flagReusedText, raiseFlag } from "./flags";
import { decideRepository, fetchRepoReport } from "./github";
import type { Fetcher } from "./http";
import { afterRecheck, nextCheckAfter } from "./lifecycle";
import { decideLink, fetchLink } from "./link";
import type { Resolver } from "./ssrf";

export type VerifyKind = "github" | "crossref" | "link" | "certificate";

export interface VerifyDeps {
  fetcher?: Fetcher;
  resolver?: Resolver;
  now?: Date;
  githubToken?: string;
  crossrefMailto?: string;
}

export interface VerifyOutcome {
  status: VerificationStatus;
  changed: boolean;
  /** The check could not give a verdict yet; the scheduler will try again. */
  pending: boolean;
}

const HOUR = 3_600_000;
const RECHECK_STATES: VerificationStatus[] = ["VERIFIED", "LIVE_UNVERIFIED", "STALE"];

export async function verifyArtifact(
  artifactId: string,
  kind: VerifyKind,
  deps: VerifyDeps = {},
): Promise<VerifyOutcome> {
  const policy = await getActivePolicy();
  const now = deps.now ?? new Date();
  const [a] = await db.select().from(artifacts).where(eq(artifacts.id, artifactId)).limit(1);
  if (!a) return { status: "UNVERIFIED", changed: false, pending: false };
  const [student] = await db.select().from(students).where(eq(students.id, a.studentId)).limit(1);
  const [identity] = await db
    .select()
    .from(studentIdentities)
    .where(eq(studentIdentities.studentId, a.studentId))
    .limit(1);
  const system = { kind: "system" as const };
  const checkKind: CheckKind = kind;

  let status = a.status;
  if (status === "SUBMITTED") {
    await applyTransition(a.id, "UNDER_CHECK", system, "Queued for automatic check", { now, checkKind });
    status = "UNDER_CHECK";
  }
  const recheck = RECHECK_STATES.includes(status);
  if (status !== "UNDER_CHECK" && !recheck) return { status, changed: false, pending: false };

  const defer = async (hours: number) => {
    await db
      .update(artifacts)
      .set({ nextCheckAt: new Date(now.getTime() + hours * HOUR), lastCheckedAt: now })
      .where(eq(artifacts.id, a.id));
    return { status, changed: false, pending: true } satisfies VerifyOutcome;
  };
  const settle = async (decided: VerificationStatus, reason: string): Promise<VerifyOutcome> => {
    // A re-check follows §6.1: one failure → STALE, two → UNVERIFIED, a pass restores.
    const next = recheck
      ? decided === "VERIFIED" && status !== "VERIFIED"
        ? "VERIFIED"
        : afterRecheck(status, decided === "VERIFIED" || decided === status)
      : decided;
    if (next === status) {
      await db
        .update(artifacts)
        .set({ lastCheckedAt: now, nextCheckAt: nextCheckAfter(status, checkKind, now, policy) })
        .where(eq(artifacts.id, a.id));
      return { status, changed: false, pending: false };
    }
    await applyTransition(a.id, next, system, recheck ? `Re-check: ${reason}` : reason, { now, checkKind });
    return { status: next, changed: true, pending: false };
  };

  if (a.sourceUrl) {
    const urlCheck = checkArtifactUrl(a.sourceUrl, policy);
    if (!urlCheck.ok) return settle("UNVERIFIED", urlCheck.reason);
  }

  if (kind === "github") {
    if (!a.sourceUrl) return settle("UNVERIFIED", "No repository link was given");
    const report = await fetchRepoReport(a.sourceUrl, {
      login: student?.githubLogin,
      token: deps.githubToken ?? env.GITHUB_TOKEN,
      fetcher: deps.fetcher,
    });
    if (report.state === "error") return defer(1);
    const d = decideRepository(report, { verifiedLogin: student?.githubLogin ?? null }, a.id, policy);
    for (const f of d.flags)
      await raiseFlag({ studentId: a.studentId, check: f.check as "burst_commits", subjectId: a.id, detail: f.detail });
    const out = await settle(d.status, d.reason);
    await flagDuplicateClaim(a.id);
    await flagReusedText(a.id);
    return out;
  }

  if (kind === "crossref") {
    const doi = doiFrom(a.sourceUrl ?? "");
    if (!doi) return settle("UNVERIFIED", "No DOI could be read from the link");
    const report = await fetchWork(doi, { mailto: deps.crossrefMailto ?? env.CROSSREF_MAILTO, fetcher: deps.fetcher });
    if (report.state === "error") return defer(1);
    const d = decideDoi(report, splitName(identity?.displayName ?? ""));
    if (d.nameVariant)
      await raiseFlag({ studentId: a.studentId, check: "doi_name_variant", subjectId: a.id, detail: d.reason });
    const out = await settle(d.status, d.reason);
    await flagDuplicateClaim(a.id);
    return out;
  }

  if (kind === "link") {
    if (!a.sourceUrl) return settle("UNVERIFIED", "No link was given");
    const report = await fetchLink(
      a.sourceUrl,
      { displayName: identity?.displayName },
      { fetcher: deps.fetcher, resolver: deps.resolver },
    );
    const d = decideLink(report);
    if (
      d.retry &&
      !recheck &&
      !reachabilityWindowExpired(localDate(a.createdAt, policy.calendar), localDate(now, policy.calendar), policy)
    )
      return defer(24); // reachable within 14 days of submission (§4.3)
    return settle(d.status, d.reason);
  }

  // Certificates and letters are attested by a named reviewer; nothing automatic decides them.
  return { status, changed: false, pending: true };
}
