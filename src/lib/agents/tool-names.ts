/**
 * Every tool name an agent's `tools:` list may contain.
 *
 * This exists to close a trap that cost real capability once: `toolsFor()`
 * looks each declared name up in `BUILDERS` and **silently drops** anything it
 * does not find. In v1 `agent.dispatch` was written into eleven YAML files and
 * implemented in none, so the Chief of Staff appeared to be able to delegate
 * and never could — a string in a config file, believed by everyone reading it.
 *
 * Living in its own module rather than in `tools.ts` is what makes the check
 * possible at all: `registry.ts` validates YAML against this list, and
 * `tools.ts` declares `BUILDERS` as `satisfies Record<ToolName, …>`. Neither
 * imports the other, so there is no cycle, and the two cannot drift — a builder
 * without a name here fails to compile, and a name here without a builder does
 * too.
 *
 * Channel-mounted tools are deliberately absent. `settings.write` and
 * `outreach.plan` are granted by *where the run came from*, never by YAML, so
 * listing them would be an invitation to declare them.
 */
export const TOOL_NAMES = [
  "brain.read",
  "brain.write",
  "browser",
  "lighthouse",
  "crm.read",
  "crm.write",
  "outreach.send",
  "outreach.call_script",
  "outreach.decide",
  "outreach.batch",
  "places.search",
  "agent.delegate",
  "owner.ask",
  "owner.answer",
  "settings.read",
  "calendar.read",
  "meeting.schedule",
  "meeting.update",
  "meeting.cancel",
  "money",
  "web.search",
  "web.fetch",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}
