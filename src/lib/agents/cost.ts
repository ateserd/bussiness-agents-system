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

/** Unknown models cost nothing rather than guessing — and say so upstream. */
export function rateFor(model: string): Rate | null {
  return RATES[model] ?? null;
}

export function costOf(model: string, inputTokens: number, outputTokens: number): number {
  const rate = rateFor(model);
  if (!rate) return 0;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

export function knownModels(): string[] {
  return Object.keys(RATES);
}
