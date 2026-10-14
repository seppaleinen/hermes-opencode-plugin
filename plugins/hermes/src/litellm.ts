import { Config, ModelRef } from "./types.js";

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

export async function callLitellm(prompt: string, model: ModelRef): Promise<string> {
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
      return data.choices[0].message.content;
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
