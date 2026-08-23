/**
 * What a run cost, in dollars.
 *
 * Rates are per million tokens, from the Claude API pricing table. Keeping them
 * here — rather than inside the runtime — means a price change is one edit and
 * the LEDGER's agent-cost column stays honest.
 */

type Rate = { input: number; output: number };

const RATES: Record<string, Rate> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Null for a model this table cannot price. Callers must not treat that as free. */
export function rateFor(model: string): Rate | null {
  return RATES[model] ?? null;
}

/**
 * Throws on an unknown model rather than returning 0.
 *
 * Returning 0 was a silent failure with real teeth: `run.ts` enforces the
 * spend ceiling with `costOf(...) > maxCost`, so a typo'd model id priced
 * every run at nothing and the ceiling never tripped — the one guard against
 * a runaway loop, disabled by a misspelling. `assertModelsPriced()` in the
 * registry makes this unreachable at runtime by rejecting the config at load;
 * this throw is the backstop for any path that skips the registry.
 */
export function costOf(model: string, inputTokens: number, outputTokens: number): number {
  const rate = rateFor(model);
  if (!rate) {
    throw new Error(
      `costOf: no price for model "${model}". Add it to RATES in src/lib/agents/cost.ts. ` +
        `Known: ${knownModels().join(", ")}`,
    );
  }
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

export function knownModels(): string[] {
  return Object.keys(RATES);
}
