import type { AgentConfig } from "@/lib/agents/registry";

/**
 * §3 rule 5 — branch isolation.
 *
 * Every memory read funnels through `allowedScopes` and `filterByScope`. This
 * is the only place the rule is expressed, so it cannot drift: an agent sees
 * exactly the scopes its YAML grants it, plus `global`, and nothing else.
 *
 * The Chief of Staff and the shared-services agents are the deliberate
 * exceptions — their YAML lists both branch scopes because their job spans both
 * branches. The exception is visible in config, never hidden in code here.
 *
 * Client memories carry their branch scope alongside the client scope
 * (`["branch.web", "client.acme"]`). That is what keeps a web agent from
 * reading an automation client's context: there is no implicit widening rule
 * here for `client.*`, so a memory is reachable only if a scope the agent
 * actually holds appears on it.
 */

export const GLOBAL_SCOPE = "global";

export function allowedScopes(agent: Pick<AgentConfig, "memory_scopes">): string[] {
  return agent.memory_scopes;
}

export function scopeMatches(granted: readonly string[], memoryScopes: readonly string[]): boolean {
  for (const scope of memoryScopes) {
    if (scope === GLOBAL_SCOPE) return true;
    if (granted.includes(scope)) return true;
  }
  return false;
}

export function filterByScope<T extends { scopes: string[] }>(
  granted: readonly string[],
  rows: readonly T[],
): T[] {
  return rows.filter((row) => scopeMatches(granted, row.scopes));
}

/**
 * SQL-side prefilter: Postgres `&&` is array overlap. This matches
 * `scopeMatches` exactly rather than being loosely permissive — a prefilter
 * that returns more than the JS filter would is how isolation bugs get in.
 * Scopes come from validated config, and are pattern-checked here regardless.
 */
export function scopeOverlapSql(granted: readonly string[]): string {
  const quoted = [...new Set([GLOBAL_SCOPE, ...granted])]
    .filter((s) => /^[a-z0-9_.-]+$/i.test(s))
    .map((s) => `'${s}'`)
    .join(",");
  if (!quoted) return "false";
  return `scopes && ARRAY[${quoted}]::text[]`;
}

/** True when this agent may see across both branches at once. */
export function isCrossBranch(agent: Pick<AgentConfig, "memory_scopes">): boolean {
  return (
    agent.memory_scopes.includes("branch.web") && agent.memory_scopes.includes("branch.automation")
  );
}
