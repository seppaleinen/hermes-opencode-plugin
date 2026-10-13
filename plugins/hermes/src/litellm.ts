import { Config, ModelRef } from "./types.js";

const BASE_URL = process.env.LITELLM_BASE_URL || "https://litellm.labb.site/v1";
const API_KEY = process.env.LITELLM_API_KEY || "";

export async function callLitellm(prompt: string, model: ModelRef): Promise<string> {
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
    throw new Error(`litellm error ${res.status}: ${text}`);
  }

  const data = await res.json() as any;
  return data.choices[0].message.content;
}
