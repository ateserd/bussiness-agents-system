/**
 * What this system knows about a model: what it costs, and how it thinks.
 *
 * One table rather than two, because both facts are per-model and both are
 * load-bearing — `registry.ts` validates every agent's `model:` against
 * `knownModels()`, so a model missing here is caught at load with the file
 * named, not mid-run.
 *
 * Rates are per million tokens, from the Claude API pricing table. Keeping them
 * here — rather than inside the runtime — means a price change is one edit and
 * the LEDGER's agent-cost column stays honest.
 */

type Thinking = "adaptive" | "extended";

type Model = {
  input: number;
  output: number;
  /**
   * Which thinking mode the API accepts.
   *
   * "adaptive" models take `thinking: {type: "adaptive"}` and steer depth with
   * `output_config.effort`. "extended" models reject adaptive with a 400 and
   * do not support effort at all — see `reasoningParams()` in run.ts. For the
   * five models below these two capabilities line up exactly, so one field
   * carries both; if that ever stops being true this becomes two fields.
   */
  thinking: Thinking;
};

const MODELS: Record<string, Model> = {
  "claude-opus-5": { input: 5, output: 25, thinking: "adaptive" },
  "claude-opus-4-8": { input: 5, output: 25, thinking: "adaptive" },
  "claude-sonnet-5": { input: 3, output: 15, thinking: "adaptive" },
  "claude-sonnet-4-6": { input: 3, output: 15, thinking: "adaptive" },
  "claude-haiku-4-5": { input: 1, output: 5, thinking: "extended" },
};

type Rate = { input: number; output: number };

/** Null for a model this table cannot price. Callers must not treat that as free. */
export function rateFor(model: string): Rate | null {
  const def = MODELS[model];
  return def ? { input: def.input, output: def.output } : null;
}

/**
 * Which thinking mode this model accepts. Defaults to "extended" for an unknown
 * model: that is the conservative direction, since sending adaptive to a model
 * that rejects it fails the whole run, while omitting it never does.
 */
export function thinkingModeFor(model: string): Thinking {
  return MODELS[model]?.thinking ?? "extended";
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
      `costOf: no price for model "${model}". Add it to MODELS in src/lib/agents/cost.ts. ` +
        `Known: ${knownModels().join(", ")}`,
    );
  }
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

export function knownModels(): string[] {
  return Object.keys(MODELS);
}
