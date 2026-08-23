import { closeDb } from "../src/db/client";
import { buildBrief, composeBrief, renderBrief } from "../src/lib/brief";

/**
 *   npm run brief          # what lands on his phone, framing included
 *   npm run brief -- --raw # figures only, no model call
 */
async function main() {
  const raw = process.argv.slice(2).includes("--raw");
  const brief = await buildBrief();
  console.log("\n" + (raw ? renderBrief(brief) : await composeBrief(brief, "morning")) + "\n");
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
});
