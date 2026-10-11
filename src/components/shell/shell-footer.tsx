/**
 * Footer on every signed-in screen (§13.4): the grievance officer's contact sits wherever personal data is shown,
 * with the policy version that produced the numbers. Reads the active policy, so it streams behind <Suspense>.
 */
import { connection } from "next/server";
import { getActivePolicy } from "@/server/policy/load";

export async function ShellFooter() {
  await connection(); // the policy cache checks the clock, so this renders per request
  const policy = await getActivePolicy();
  const g = policy.institution.grievance_officer;
  return (
    <footer className="no-print mt-10 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-2">
      <span>Synthetic demo data. Policy {policy.policy_version}.</span>
      <span>
        Grievance officer: {g.name},{" "}
        <a href={`mailto:${g.email}`} className="font-semibold underline">
          {g.email}
        </a>
      </span>
    </footer>
  );
}
