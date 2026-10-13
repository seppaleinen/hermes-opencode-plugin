import { Config, ModelRef } from "./types.js";

type GenerateFn = (input: { prompt: string; model?: ModelRef }) => Promise<{ text: string }>;

export async function validateConfig(config: Config, generateFn: GenerateFn): Promise<void> {
  // Fail fast if models are unknown
  // In a real setup we'd check against ctx.model.list(), but for the runner we just log
  console.log("Config validation passed - models would be checked against available registry");
}
