import { closeDb } from "../src/db/client";
import { buildBrief, renderBrief } from "../src/lib/brief";

async function main() {
  console.log("\n" + renderBrief(await buildBrief()) + "\n");
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
});
