import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

export async function copyTextFile(from, to) {
  await ensureDir(path.dirname(to));
  const raw = await readFile(from, "utf8");
  await writeFile(to, raw, "utf8");
}

export function shanghaiDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function shanghaiDateTime(date = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

export function stableHash(value, length = 10) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, length);
}

export function slugFor(date, index, title) {
  return `${date}-${String(index + 1).padStart(2, "0")}-${stableHash(title, 8)}`;
}

export function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function truncate(value, maxLength = 240) {
  const text = normalizeWhitespace(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function stripHtml(html) {
  return normalizeWhitespace(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
  );
}

export function extractTitle(html, fallback = "") {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return truncate(stripHtml(match?.[1] || fallback), 90);
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function scoreText(text, keywords = []) {
  const normalized = String(text || "").toLowerCase();
  return keywords.reduce((score, keyword) => {
    const needle = String(keyword || "").toLowerCase();
    if (!needle) return score;
    const matches = normalized.match(new RegExp(escapeRegExp(needle), "g"));
    return score + (matches ? matches.length : 0);
  }, 0);
}

export async function readArticleFiles(contentDir) {
  let files = [];
  try {
    files = await readdir(contentDir);
  } catch {
    return [];
  }

  const articles = [];
  for (const file of files.filter((item) => item.endsWith(".json"))) {
    const article = await readJson(path.join(contentDir, file));
    articles.push(article);
  }

  return articles.sort((a, b) => {
    const byDate = String(b.date).localeCompare(String(a.date));
    if (byDate !== 0) return byDate;
    return String(a.title).localeCompare(String(b.title), "zh-CN");
  });
}

function inlineMarkdownToHtml(value) {
  let html = escapeHtml(value);
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return html;
}

export function markdownToHtml(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const output = [];
  let listType = null;

  function closeList() {
    if (listType) {
      output.push(`</${listType}>`);
      listType = null;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }

    if (line.startsWith("### ")) {
      closeList();
      output.push(`<h3>${inlineMarkdownToHtml(line.slice(4))}</h3>`);
      continue;
    }

    if (line.startsWith("## ")) {
      closeList();
      output.push(`<h2>${inlineMarkdownToHtml(line.slice(3))}</h2>`);
      continue;
    }

    if (line.startsWith("# ")) {
      closeList();
      output.push(`<h1>${inlineMarkdownToHtml(line.slice(2))}</h1>`);
      continue;
    }

    if (/^- /.test(line)) {
      if (listType !== "ul") {
        closeList();
        listType = "ul";
        output.push("<ul>");
      }
      output.push(`<li>${inlineMarkdownToHtml(line.slice(2))}</li>`);
      continue;
    }

    if (/^\d+\. /.test(line)) {
      if (listType !== "ol") {
        closeList();
        listType = "ol";
        output.push("<ol>");
      }
      output.push(`<li>${inlineMarkdownToHtml(line.replace(/^\d+\. /, ""))}</li>`);
      continue;
    }

    closeList();
    output.push(`<p>${inlineMarkdownToHtml(line)}</p>`);
  }

  closeList();
  return output.join("\n");
}

export function platformSlug(platformName) {
  const map = {
    "官网SEO版": "website-seo",
    "公众号版": "wechat",
    "小红书版": "xiaohongshu",
    "头条搜狐版": "toutiao-sohu",
    "知乎版": "zhihu",
    "微博版": "weibo"
  };
  return map[platformName] || stableHash(platformName, 8);
}

export function articleToMarkdown(article, platformName = null) {
  const variant = platformName ? article.platformVariants?.[platformName] : null;
  const title = variant?.title || article.title;
  const body = variant?.markdown || article.bodyMarkdown;

  if (/^\s*#\s+/.test(body)) {
    return `${markdownToPublishingText(body)}\n`;
  }

  return `${markdownToPublishingText([title, "", body].join("\n"))}\n`;
}

function markdownToPublishingText(markdown) {
  return String(markdown || "")
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^>\s?/, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 $2")
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
