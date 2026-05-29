import { extractTitle, normalizeWhitespace, scoreText, stripHtml, truncate } from "./content-utils.mjs";

export async function fetchSources(sourceConfig, options = {}) {
  const timeoutMs = options.timeoutMs || 12000;
  const keywords = sourceConfig.keywords || [];
  const sources = sourceConfig.sources || [];

  const results = await Promise.all(
    sources.map((source) => fetchOneSource(source, keywords, timeoutMs))
  );

  return results.sort((a, b) => {
    const byReachable = Number(b.reachable) - Number(a.reachable);
    if (byReachable !== 0) return byReachable;
    const byScore = b.score - a.score;
    if (byScore !== 0) return byScore;
    return (b.priority || 0) - (a.priority || 0);
  });
}

async function fetchOneSource(source, keywords, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fetchedAt = new Date().toISOString();

  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": "SmartGo-GEO-Content-Bot/0.1 (+https://www.ismartgo.cn/)"
      }
    });

    const raw = await response.text();
    const text = truncate(stripHtml(raw), 900);
    const title = extractTitle(raw, source.name);
    const score = scoreText(`${title} ${text} ${source.usage}`, keywords) + (source.priority || 0);

    return {
      ...source,
      title: title || source.name,
      snippet: text || source.usage,
      fetchedAt,
      reachable: response.ok,
      status: response.status,
      score
    };
  } catch (error) {
    return {
      ...source,
      title: source.name,
      snippet: source.usage,
      fetchedAt,
      reachable: false,
      status: "fetch_failed",
      error: normalizeWhitespace(error.message),
      score: source.priority || 0
    };
  } finally {
    clearTimeout(timer);
  }
}

export function pickSourcesForTopic(topic, allSources, maxSources = 4) {
  const text = `${topic.title} ${topic.angle} ${topic.intent}`;
  const topicTerms = Array.from(new Set(text.split(/[、，,。\s]+/).filter(Boolean)));

  const scored = allSources.map((source) => ({
    ...source,
    topicScore: source.score + scoreText(`${source.name} ${source.title} ${source.snippet} ${source.usage}`, topicTerms)
  }));

  const company = scored.find((source) => source.category === "company");
  const remaining = scored
    .filter((source) => source !== company)
    .sort((a, b) => b.topicScore - a.topicScore)
    .slice(0, maxSources - (company ? 1 : 0));

  return [company, ...remaining].filter(Boolean).slice(0, maxSources);
}
