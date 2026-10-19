import { ModelRef, GenerateResult, TokenUsage } from "./types.js";

const BASE_URL = process.env.LITELLM_BASE_URL || "https://litellm.labb.site/v1";
const API_KEY = process.env.LITELLM_API_KEY || "";

/**
 * Transient failure handling for the LiteLLM proxy.
 *
 * `fetch failed` is a NETWORK-level error (connection reset, proxy timeout,
 * DNS) — it is thrown before `res` exists, so the `!res.ok` branch below
 * never sees it. A single transient hiccup killed the T6 run at call 7 of 8
 * with no retry. Real benchmark runs span dozens of calls over minutes; the
 * harness must survive individual transient failures, not abort on them.
 *
 * Retries only on network errors and 5xx responses. 4xx is a definitive
 * model/config error — retrying it is pointless and could mask a real bug.
 */
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

/**
 * Token usage extracted from a LiteLLM API response.
 *
 * LiteLLM proxies OpenAI-compatible endpoints, so the response shape follows
 * the OpenAI chat completion schema: `data.usage = { prompt_tokens,
 * completion_tokens, total_tokens }`. When the proxy omits usage (some free
 * tiers do), callers fall back to estimating from prompt/response string
 * lengths. (issue #19)
 */
export function extractUsage(data: any): TokenUsage | undefined {
  const u = data?.usage;
  if (!u || typeof u !== "object") return undefined;

  const promptTokens = Number(u.prompt_tokens);
  const completionTokens = Number(u.completion_tokens);
  const totalTokens = Number(u.total_tokens);

  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) {
    return undefined;
  }

  return {
    input: Math.max(0, Math.floor(promptTokens)),
    output: Math.max(0, Math.floor(completionTokens)),
    total: Number.isFinite(totalTokens) && totalTokens >= 0
      ? Math.floor(totalTokens)
      : Math.max(0, Math.floor(promptTokens)) + Math.max(0, Math.floor(completionTokens)),
  };
}

/**
 * Rough token estimate: ~4 chars per token (a common approximation for
 * English text on GPT-style tokenizers). Used only when the API response
 * omits `usage`. Callers can distinguish estimates from API-provided counts
 * by checking whether the response included a `usage` object. (issue #19)
 */
export function estimateUsage(prompt: string, response: string): TokenUsage {
  const input = Math.max(0, Math.ceil((prompt?.length || 0) / 4));
  const output = Math.max(0, Math.ceil((response?.length || 0) / 4));
  return { input, output, total: input + output };
}

export async function callLitellm(prompt: string, model: ModelRef): Promise<GenerateResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model.id,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        // 5xx may be transient (proxy overload) — retry. 4xx is definitive.
        if (res.status >= 500 && attempt < MAX_RETRIES) {
          lastError = new Error(`litellm error ${res.status}: ${text}`);
          await sleep(BASE_DELAY_MS * attempt);
          continue;
        }
        throw new Error(`litellm error ${res.status}: ${text}`);
      }

      const data = await res.json() as any;
      const text = data.choices[0].message.content;
      const usage = extractUsage(data);

      // When the proxy omits usage, estimate from string lengths. This is a
      // rough approximation (1 token ≈ 4 chars) — callers should prefer the
      // API-provided counts if available. (issue #19)
      if (!usage) {
        return { text, usage: estimateUsage(prompt, text) };
      }

      return { text, usage };
    } catch (e) {
      // Network errors (fetch failed) and our own transient 5xx land here.
      lastError = e;
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * attempt);
        continue;
      }
    }
  }

  throw new Error(
    `litellm call failed after ${MAX_RETRIES} attempts ` +
    `(${model.providerID}/${model.id}): ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}