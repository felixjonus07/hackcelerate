/** Is the ERP baseline for a student out of date (§6.2: previous values are used and marked stale)? */
import type { Policy } from "../policy/schema";

export function isErpStale(
  student: { erpStale: boolean; erpImportedAt: Date | null },
  now: Date,
  policy: Pick<Policy, "ingestion">,
): boolean {
  if (student.erpStale) return true;
  if (!student.erpImportedAt) return false; // never imported: nothing to call stale
  return now.getTime() - student.erpImportedAt.getTime() > policy.ingestion.stale_after_hours * 3_600_000;
}
