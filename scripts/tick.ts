import { closeDb } from "../src/db/client";
import { allCadences, dueRuns } from "../src/lib/scheduler/cadences";
import { tick } from "../src/lib/scheduler/tick";

/**
 *   npm run tick            # run whatever is due right now
 *   npm run tick -- --plan  # show the full cadence table without running
 *   npm run tick -- --at "2026-08-24T09:00:00+03:00"
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--plan")) {
    const rows = allCadences().sort((a, b) => a.cron.localeCompare(b.cron));
    console.log(`\n${rows.length} scheduled runs\n`);
    for (const r of rows) {
      console.log(`  ${r.cron.padEnd(14)} ${r.agentId.padEnd(42)} ${r.label}`);
    }
    console.log();
    await closeDb();
    return;
  }

  const atIndex = args.indexOf("--at");
  const now = atIndex >= 0 ? new Date(args[atIndex + 1]) : new Date();

  console.log(`· tick at ${now.toISOString()} (${dueRuns(now).length} due)`);
  const result = await tick(now);
  console.log(
    `· due=${result.due} ran=${result.ran} skipped=${result.skipped} parked=${result.parked} failed=${result.failed}`,
  );
  for (const d of result.details) {
    console.log(`  ${d.agentId.padEnd(42)} ${d.outcome}${d.note ? ` — ${d.note}` : ""}`);
  }
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
});
