import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { AGENT_STATUSES, AUTONOMIES, BRANCHES, DEPARTMENTS, TIERS } from "@/db/schema";
import { knownModels } from "./cost";

/**
 * Loads every agents/**\/*.yaml, validates it, and caches the result.
 *
 * Adding an agent is adding a file. Adding a department is adding a directory.
 * Nothing in this file enumerates either, on purpose — see README → "Adding a
 * third branch".
 */

export const AGENTS_DIR = path.join(process.cwd(), "agents");

const kpiSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  /** Targets may be an unfilled "[[ N ]]" placeholder — that is a valid state. */
  target: z.union([z.string(), z.number()]),
  window: z.enum(["daily", "weekly", "monthly"]).default("weekly"),
});

export const agentConfigSchema = z.object({
  id: z.string().regex(/^[a-z_]+\.[a-z_]+\.[a-z_]+$/, "id must be branch.department.name"),
  display_name: z.string().min(1),
  branch: z.enum(BRANCHES),
  department: z.enum(DEPARTMENTS),
  tier: z.enum(TIERS),
  reports_to: z.string().nullable(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  avatar: z.string().nullable().optional(),
  status: z.enum(AGENT_STATUSES).default("idle"),
  model: z.string().min(1),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
  mission: z.string().min(1),
  system_prompt_file: z.string().min(1),
  tools: z.array(z.string()).default([]),
  memory_scopes: z.array(z.string()).min(1),
  schedule: z.string().nullable(),
  autonomy: z.enum(AUTONOMIES),
  approval_required_for: z.array(z.string()).default([]),
  escalate_to_human_when: z.array(z.string()).default([]),
  kpis: z.array(kpiSchema).default([]),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) out.push(full);
  }
  return out;
}

function load(): AgentConfig[] {
  const files = walk(AGENTS_DIR);
  const configs: AgentConfig[] = [];
  const problems: string[] = [];

  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    let raw: unknown;
    try {
      raw = parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      problems.push(`${rel}: not valid YAML — ${(err as Error).message}`);
      continue;
    }
    const parsed = agentConfigSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        problems.push(`${rel}: ${issue.path.join(".") || "(root)"} — ${issue.message}`);
      }
      continue;
    }
    configs.push(parsed.data);
  }

  // Structural checks the per-file schema cannot see.
  const byId = new Map<string, AgentConfig>();
  for (const c of configs) {
    if (byId.has(c.id)) problems.push(`duplicate agent id: ${c.id}`);
    byId.set(c.id, c);
  }
  for (const c of configs) {
    if (c.reports_to && !byId.has(c.reports_to)) {
      problems.push(`${c.id}: reports_to "${c.reports_to}" does not exist`);
    }
    if (!fs.existsSync(path.join(process.cwd(), c.system_prompt_file))) {
      problems.push(`${c.id}: missing prompt file ${c.system_prompt_file}`);
    }
  }
  const roots = configs.filter((c) => c.reports_to === null);
  if (roots.length !== 1) {
    problems.push(`expected exactly one root agent (reports_to: null), found ${roots.length}`);
  }
  // An agent whose model has no price cannot have its spend ceiling enforced,
  // so a typo here is a safety hole, not a cosmetic one. Fail at load, where
  // the offending file is named, rather than mid-run.
  const priced = new Set(knownModels());
  for (const c of configs) {
    if (!priced.has(c.model)) {
      problems.push(
        `${c.id}: model "${c.model}" has no price in cost.ts (known: ${[...priced].join(", ")})`,
      );
    }
  }

  if (problems.length) {
    throw new Error(`Invalid crew configuration:\n  - ${problems.join("\n  - ")}`);
  }

  return configs.sort((a, b) => a.id.localeCompare(b.id));
}

let cache: AgentConfig[] | null = null;

export function allAgents(): AgentConfig[] {
  cache ??= load();
  return cache;
}

export function getAgent(id: string): AgentConfig | undefined {
  return allAgents().find((a) => a.id === id);
}

export function requireAgent(id: string): AgentConfig {
  const agent = getAgent(id);
  if (!agent) {
    throw new Error(`No agent "${id}". Known ids:\n  ${allAgents().map((a) => a.id).join("\n  ")}`);
  }
  return agent;
}


export function readSystemPrompt(agent: AgentConfig): string {
  return fs.readFileSync(path.join(process.cwd(), agent.system_prompt_file), "utf8");
}

