import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { ApproveButton, PolicyEditor } from "@/components/staff/policy-editor";
import { Card, CardHeader } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { getActivePolicyInfo } from "@/server/policy/load";
import { listPolicyVersions } from "@/server/services/policy-admin";

export const metadata: Metadata = { title: "Policy" };

async function Policy() {
  const user = await requireUser(["registrar", "dean", "hod", "auditor"]);
  const [versions, { policy }] = await Promise.all([listPolicyVersions(), getActivePolicyInfo()]);
  const canApprove = user.role === "registrar" || user.role === "dean";
  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader
          title="Versions"
          hint="A version in force is never edited. A change is a new version with its own start date."
        />
        <ul className="divide-y divide-line">
          {versions.map((v) => {
            const required = v.requiresTwoApprovals ? 2 : 1;
            const have = new Set(v.approvals.map((a) => a.userId)).size;
            const mine = v.approvals.some((a) => a.userId === user.id);
            return (
              <li key={v.version} className="flex flex-wrap items-start justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-extrabold">
                    {v.version}
                    <Tag kind={v.status === "ACTIVE" ? "low" : v.status === "DRAFT" ? "mod" : "neutral"}>
                      {v.status === "ACTIVE" ? "In force" : v.status === "DRAFT" ? "Draft" : "Retired"}
                    </Tag>
                  </p>
                  <p className="text-sm text-ink-2">
                    Starts {shortDate(v.effectiveFrom)}
                    {v.supersedes ? ` · replaces ${v.supersedes}` : ""}
                    {v.status === "DRAFT" ? ` · ${have} of ${required} approvals` : ""}
                  </p>
                  {v.changedSections.length ? (
                    <p className="mt-1 text-sm text-ink-2 [overflow-wrap:anywhere]">
                      Changed: {v.changedSections.join(", ")}
                    </p>
                  ) : null}
                  {v.requiresTwoApprovals && v.status === "DRAFT" ? (
                    <p className="mt-1 text-sm text-ink-2">
                      A persona change needs two different approvers: the registrar and the dean.
                    </p>
                  ) : null}
                </div>
                {v.status === "DRAFT" && canApprove && !mine ? <ApproveButton version={v.version} /> : null}
              </li>
            );
          })}
        </ul>
      </Card>

      {policy.provisional.length ? (
        <Card>
          <CardHeader
            title="Values awaiting confirmation"
            hint="The reference plan does not set these. Each stays shown here until the institution confirms it."
          />
          <ul className="grid gap-1 font-mono text-[0.85rem] text-ink-2 [overflow-wrap:anywhere] sm:grid-cols-2">
            {policy.provisional.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      {user.role === "registrar" ? (
        <Card>
          <CardHeader title="Draft a new version" />
          <PolicyEditor initial={JSON.stringify(policy, null, 2)} />
        </Card>
      ) : null}
    </div>
  );
}

export default function PolicyPage() {
  return (
    <>
      <PageHeader
        title="Policy"
        description="Every weight, band and deadline lives here. Changes are drafted, approved by the right people, then take effect on their start date."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Policy />
      </Suspense>
    </>
  );
}
