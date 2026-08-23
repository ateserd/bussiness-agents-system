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

/**
 * Narrow an agent's scopes to one branch, for the duration of one task.
 *
 * Agents are branch-agnostic now — four of them cover work that used to be
 * split across two mirrored hierarchies — so isolation can no longer come from
 * an agent's fixed YAML scopes. It comes from the task instead: work tagged
 * `web` runs with the automation scopes stripped out, so a web task cannot
 * recall an automation client's context even though the agent is allowed both
 * at other times. Untagged work (a cross-branch question from the owner) keeps
 * everything, which is the honest answer for a question that spans both.
 */
export function narrowScopes(scopes: readonly string[], branch?: string | null): string[] {
  if (!branch || branch === "shared") return [...scopes];
  const other = `branch.`;
  return scopes.filter((s) => {
    if (s === GLOBAL_SCOPE) return true;
    if (s.startsWith(other)) return s === `branch.${branch}`;
    if (s.startsWith("dept.")) return s.startsWith(`dept.${branch}.`);
    return true; // client.* and anything else stays — it is already specific
  });
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

/**
 * The write-side half of the same rule: what a memory's scope list may say.
 *
 * Two mistakes are easy to make and impossible to see afterwards, because both
 * produce a memory that looks correctly scoped and reads as global:
 *
 *   ["global", "branch.web"]  — `scopeMatches` returns true on the first
 *                               `global` it sees, so the branch scope beside it
 *                               is decoration and every automation agent reads
 *                               a web fact.
 *   ["dept.outreach"]         — both branches have an outreach department, so
 *                               an unqualified department scope crosses the
 *                               branch line. Must be `dept.web.outreach`.
 *
 * Called from `writeMemory`, the single write path, so no caller can route
 * around it — the same reasoning that puts approval gates inside `run()`.
 */
export function assertWritableScopes(scopes: readonly string[]): void {
  if (scopes.length === 0) {
    throw new Error("kapsam gerekli: en az bir kapsam yazılmalı");
  }

  if (scopes.includes(GLOBAL_SCOPE) && scopes.length > 1) {
    throw new Error(
      `bir anı ya "${GLOBAL_SCOPE}" ya da kapsamlıdır, ikisi birden değil — ` +
        `["${scopes.join('", "')}"] yazıldığında global her şeyi herkese açar`,
    );
  }

  for (const scope of scopes) {
    if (scope === GLOBAL_SCOPE) continue;
    const parts = scope.split(".");
    if (parts[0] === "branch" && parts.length === 2) continue;
    if (parts[0] === "client" && parts.length === 2) continue;
    if (parts[0] === "dept") {
      if (parts.length === 3) continue;
      throw new Error(
        `"${scope}" şube nitelikli değil — iki şubede de aynı departman var, ` +
          `"dept.<şube>.<departman>" yaz (örn. dept.web.outreach)`,
      );
    }
    throw new Error(
      `"${scope}" tanınmayan kapsam — global, branch.<şube>, dept.<şube>.<departman> ` +
        `veya client.<id> olmalı`,
    );
  }
}

