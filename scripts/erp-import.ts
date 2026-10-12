/**
 * Runs the ERP import by hand: parse, validate, apply, then queue re-evaluation
 * for the students whose baseline changed.
 *
 *   npm run erp:import -- path/to/export.csv      (default: ERP_EXPORT_FILE)
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { pg } from "../src/server/db";
import { env } from "../src/server/env";
import { enqueue, getQueue } from "../src/server/queue";
import { importErp } from "../src/server/services/erp-import";

const file = process.argv[2] ?? env.ERP_EXPORT_FILE;

async function main() {
  if (!file) throw new Error("Pass a CSV path or set ERP_EXPORT_FILE");
  const text = await readFile(file, "utf8").catch((e: NodeJS.ErrnoException) =>
    e.code === "ENOENT" ? null : Promise.reject(e),
  );
  const r = await importErp({ fileName: basename(file), text, source: "manual" });
  console.log(`${r.status}: ${r.rowsAccepted} accepted, ${r.rowsRejected} rejected of ${r.rowsTotal} rows`);
  for (const e of r.errors.slice(0, 20)) console.log(`  - ${e}`);
  if (r.errors.length > 20) console.log(`  …and ${r.errors.length - 20} more (see ingestion_runs)`);
  try {
    for (const id of r.changedStudentIds)
      await enqueue("evaluation", { studentId: id, requestedBy: "system", reason: "erp_import" });
    console.log(`Queued ${r.changedStudentIds.length} re-evaluations (run \`npm run worker\` to process them).`);
  } catch {
    console.log(
      "Redis is not reachable, so no re-evaluations were queued; the nightly refresh will pick the changes up.",
    );
  }
  await getQueue("evaluation").close();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pg.end();
    process.exit();
  });
