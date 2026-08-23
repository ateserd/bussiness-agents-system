import { closeDb } from "../src/db/client";
import { allAgents } from "../src/lib/agents/registry";
import { runAgent } from "../src/lib/agents/run";

/**
 *   npm run agent:list
 *   npm run agent:run -- shared.outreach.scout
 *   npm run agent:run -- shared.outreach.scout --task "Antalya'da sitesi olmayan kafeleri çıkar"
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--list") || args.length === 0) {
    const byBranch = new Map<string, string[]>();
    for (const a of allAgents()) {
      const list = byBranch.get(a.branch) ?? [];
      list.push(`  ${a.id.padEnd(42)} ${a.display_name.padEnd(20)} ${a.model}`);
      byBranch.set(a.branch, list);
    }
    for (const [branch, lines] of byBranch) {
      console.log(`\n${branch.toUpperCase()}`);
      console.log(lines.sort().join("\n"));
    }
    console.log(`\n${allAgents().length} agents. Run one:  npm run agent:run -- <id>\n`);
    await closeDb();
    return;
  }

  const id = args[0];
  const taskIndex = args.indexOf("--task");
  const task = taskIndex >= 0 ? args[taskIndex + 1] : undefined;

  console.log(`· running ${id}${process.env.ANTHROPIC_API_KEY ? "" : "  (simulate mode — no API key)"}`);
  const result = await runAgent(id, { trigger: "manual", task });

  console.log(`
  outcome     ${result.outcome}
  simulated   ${result.simulated}
  duration    ${result.durationMs}ms
  cost        $${result.costUsd.toFixed(6)}
  memories    ${result.memoriesWritten} written
  gated       ${result.gated.length ? result.gated.map((g) => g.gate).join(", ") : "none"}
  activity    ${result.activityId}

${result.summary}
`);
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
});
