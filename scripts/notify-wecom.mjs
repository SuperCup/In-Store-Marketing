import path from "node:path";
import { readArticleFiles, readJson, shanghaiDate, truncate } from "./lib/content-utils.mjs";

const root = process.cwd();
const site = await readJson(path.join(root, "config/site.json"));
const latest = await readJson(path.join(root, "data/latest.json"));
const articles = await loadLatestArticles();
const siteUrl = resolveSiteUrl();
const content = limitUtf8(buildMessage(), 3800);
const dryRun = process.argv.includes("--dry-run") || process.env.QYWX_NOTIFY_DRY_RUN === "true";
const required = process.env.QYWX_NOTIFY_REQUIRED === "true";
const webhookUrl = process.env.QYWX_WEBHOOK_URL || process.env.WECOM_WEBHOOK_URL || "";

if (dryRun) {
  console.log(content);
  process.exit(0);
}

if (!webhookUrl) {
  const message = "QYWX_WEBHOOK_URL is not configured; skipped WeCom notification.";
  if (required) throw new Error(message);
  console.log(message);
  process.exit(0);
}

const response = await fetch(webhookUrl, {
  method: "POST",
  headers: {
    "content-type": "application/json"
  },
  body: JSON.stringify({
    msgtype: "markdown",
    markdown: {
      content
    }
  })
});

const rawResult = await response.text();
let result = null;
try {
  result = JSON.parse(rawResult);
} catch {
  result = { errcode: response.ok ? 0 : -1, errmsg: rawResult };
}

if (!response.ok || result.errcode !== 0) {
  throw new Error(`WeCom notification failed: ${result.errmsg || response.statusText}`);
}

console.log(`Sent WeCom daily article summary for ${latest.date || shanghaiDate()}.`);

async function loadLatestArticles() {
  const allArticles = await readArticleFiles(path.join(root, "content/articles"));
  const bySlug = new Map(allArticles.map((article) => [article.slug, article]));
  const latestSlugs = Array.isArray(latest.articles) ? latest.articles : [];
  const selected = latestSlugs.map((slug) => bySlug.get(slug)).filter(Boolean);
  if (selected.length) return selected;

  const date = latest.date || process.env.CONTENT_DATE || shanghaiDate();
  return allArticles.filter((article) => article.date === date);
}

function buildMessage() {
  const date = latest.date || process.env.CONTENT_DATE || shanghaiDate();
  const passedCount = articles.filter((article) => article.review?.status === "pass").length;
  const reviewCount = articles.length - passedCount;
  const sourceReachability = Array.isArray(latest.sourceReachability)
    ? latest.sourceReachability
    : [];
  const reachableCount = sourceReachability.filter((source) => source.reachable).length;
  const siteLine = siteUrl
    ? `> Web 页面：[打开 GitHub Pages](${siteUrl})`
    : "> Web 页面：未配置";
  const sourceLine = sourceReachability.length
    ? `> 来源抓取：${reachableCount}/${sourceReachability.length} 个可访问`
    : null;
  const providerLine = latest.provider ? `> AI 提供方：${latest.provider}` : null;

  const lines = [
    `# ${site.company?.name || site.siteName}每日文章概览`,
    `> 日期：${date}`,
    `> 状态：${statusLabel(latest.status)}`,
    `> 今日文章：${articles.length} 篇；审查通过：${passedCount} 篇；需复核：${reviewCount} 篇`,
    providerLine,
    sourceLine,
    siteLine,
    "",
    ...articles.flatMap((article, index) => articleLines(article, index))
  ].filter((line) => line !== null && line !== undefined);

  if (!articles.length) {
    lines.push("今日还没有可汇总的文章。");
  }

  return `${lines.join("\n")}\n`;
}

function articleLines(article, index) {
  const reviewLabel = article.review?.status === "pass" ? "审查通过" : "需复核";
  const url = articleUrl(article);
  const title = url ? `[${article.title}](${url})` : article.title;
  return [
    `${index + 1}. ${title}`,
    `   ${truncate(article.summary, 80)}`,
    `   ${article.intent || "内容资产"} · ${reviewLabel}`
  ];
}

function resolveSiteUrl() {
  return trimTrailingSlash(process.env.SITE_PUBLIC_URL || process.env.GITHUB_PAGES_URL || site.siteUrl || "");
}

function articleUrl(article) {
  if (!siteUrl || !article.slug) return "";
  return `${siteUrl}/articles/${article.slug}/`;
}

function statusLabel(status) {
  const labels = {
    generated: "已生成新文章",
    skipped_existing: "当天文章已存在，复用已有内容"
  };
  return labels[status] || "已完成";
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/$/, "");
}

function limitUtf8(value, maxBytes) {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const suffix = siteUrl ? `\n\n内容较多，完整列表请查看：${siteUrl}\n` : "\n\n内容较多，请查看站点完整列表。\n";
  const limit = maxBytes - Buffer.byteLength(suffix, "utf8");
  let output = "";
  for (const char of value) {
    const next = `${output}${char}`;
    if (Buffer.byteLength(next, "utf8") > limit) break;
    output = next;
  }
  return `${output.trimEnd()}${suffix}`;
}
