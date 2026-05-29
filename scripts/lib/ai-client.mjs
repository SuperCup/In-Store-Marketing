import { truncate } from "./content-utils.mjs";

export function resolveAiProvider(env = process.env) {
  const requested = (env.AI_PROVIDER || "").trim().toLowerCase();

  if (requested === "none") {
    return { enabled: false, provider: "none" };
  }

  if (requested === "deepseek" || (!requested && env.DEEPSEEK_API_KEY)) {
    return {
      enabled: Boolean(env.DEEPSEEK_API_KEY || env.AI_API_KEY),
      provider: "deepseek",
      apiKey: env.DEEPSEEK_API_KEY || env.AI_API_KEY,
      baseUrl: env.DEEPSEEK_BASE_URL || env.AI_BASE_URL || "https://api.deepseek.com/v1",
      model: env.DEEPSEEK_MODEL || env.AI_MODEL || "deepseek-chat"
    };
  }

  if (requested === "kimi" || requested === "moonshot" || (!requested && env.KIMI_API_KEY)) {
    return {
      enabled: Boolean(env.KIMI_API_KEY || env.AI_API_KEY),
      provider: "kimi",
      apiKey: env.KIMI_API_KEY || env.AI_API_KEY,
      baseUrl: env.KIMI_BASE_URL || env.MOONSHOT_BASE_URL || env.AI_BASE_URL || "https://api.moonshot.cn/v1",
      model: env.KIMI_MODEL || env.MOONSHOT_MODEL || env.AI_MODEL || "moonshot-v1-8k"
    };
  }

  if (requested || env.AI_API_KEY) {
    return {
      enabled: Boolean(env.AI_API_KEY),
      provider: requested || "openai-compatible",
      apiKey: env.AI_API_KEY,
      baseUrl: env.AI_BASE_URL || "https://api.openai.com/v1",
      model: env.AI_MODEL || "gpt-4o-mini"
    };
  }

  return { enabled: false, provider: "template" };
}

export function resolveAiProviders(env = process.env) {
  const requested = (env.AI_PROVIDER || "").trim().toLowerCase();
  if (requested && requested !== "auto") {
    const provider = resolveAiProvider(env);
    return provider.enabled ? [provider] : [];
  }

  const providers = [
    resolveAiProvider({ ...env, AI_PROVIDER: "deepseek" }),
    resolveAiProvider({ ...env, AI_PROVIDER: "kimi" }),
    resolveAiProvider({ ...env, AI_PROVIDER: "openai-compatible" })
  ].filter((provider) => provider.enabled);

  const seen = new Set();
  return providers.filter((provider) => {
    const key = `${provider.provider}:${provider.baseUrl}:${provider.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function chatCompletion(messages, options = {}) {
  const providers = options.providers || (options.provider ? [options.provider] : resolveAiProviders());
  const enabledProviders = providers.filter((provider) => provider?.enabled);
  if (!enabledProviders.length) return null;

  let lastError = null;

  for (const provider of enabledProviders) {
    try {
      return await chatCompletionWithProvider(provider, messages, options);
    } catch (error) {
      lastError = error;
      if (enabledProviders.length === 1) throw error;
      console.warn(`${provider.provider} failed, trying next AI provider: ${error.message}`);
    }
  }

  throw lastError;
}

async function chatCompletionWithProvider(provider, messages, options = {}) {
  const endpoint = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${provider.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      temperature: options.temperature ?? 0.4,
      response_format: options.responseFormat || { type: "json_object" }
    })
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`${provider.provider} API ${response.status}: ${truncate(raw, 500)}`);
  }

  const data = JSON.parse(raw);
  return data.choices?.[0]?.message?.content || "";
}

export function parseJsonResponse(raw) {
  if (!raw) return null;
  const cleaned = String(raw)
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("AI response is not valid JSON.");
  }
}
