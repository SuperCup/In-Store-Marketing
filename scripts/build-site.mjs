import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  articleToMarkdown,
  copyTextFile,
  ensureDir,
  escapeHtml,
  markdownToHtml,
  platformSlug,
  readArticleFiles,
  readJson,
  shanghaiDate,
  writeJson
} from "./lib/content-utils.mjs";

const root = process.cwd();
const site = await readJson(path.join(root, "config/site.json"));
const sourceConfig = await readJson(path.join(root, "config/sources.json"));
const contentDir = path.join(root, "content/articles");
const distDir = path.join(root, "dist");
const today = process.env.CONTENT_DATE || shanghaiDate();

await rm(distDir, { recursive: true, force: true });
await ensureDir(distDir);
await ensureDir(path.join(distDir, "assets"));
await ensureDir(path.join(distDir, "articles"));
await ensureDir(path.join(distDir, "downloads"));
await ensureDir(path.join(distDir, "data"));

await copyTextFile(path.join(root, "src/styles.css"), path.join(distDir, "assets/styles.css"));
await copyTextFile(path.join(root, "src/app.js"), path.join(distDir, "assets/app.js"));

const articles = await readArticleFiles(contentDir);
const latestDate = articles[0]?.date || today;
const latestArticles = articles.filter((article) => article.date === latestDate);

for (const article of articles) {
  await buildArticlePage(article);
}

await writeFile(path.join(distDir, "index.html"), renderHome(articles, latestArticles), "utf8");
await writeJson(path.join(distDir, "data/articles.json"), articles.map(toPublicArticle));
await writeFile(path.join(distDir, "llms.txt"), renderLlms(articles), "utf8");
await writeFile(path.join(distDir, "robots.txt"), renderRobots(), "utf8");
await writeFile(path.join(distDir, "sitemap.xml"), renderSitemap(articles), "utf8");
await writeFile(path.join(distDir, "feed.xml"), renderFeed(articles.slice(0, 30)), "utf8");

console.log(`Built ${articles.length} articles into dist/.`);

async function buildArticlePage(article) {
  const articleDir = path.join(distDir, "articles", article.slug);
  await ensureDir(articleDir);

  for (const platform of Object.keys(article.platformVariants || {})) {
    const fileName = `${article.slug}-${platformSlug(platform)}.txt`;
    await writeFile(path.join(distDir, "downloads", fileName), articleToMarkdown(article, platform), "utf8");
  }

  await writeFile(path.join(articleDir, "index.html"), renderArticle(article), "utf8");
}

function renderHome(allArticles, currentArticles) {
  const metrics = [
    { value: currentArticles.length, label: "今日文章" },
    { value: allArticles.length, label: "文章总量" },
    { value: sourceConfig.sources.length, label: "信息源" },
    { value: site.generation.defaultPlatforms.length, label: "下载版本" }
  ];

  const cards = allArticles.map((article) => renderArticleCard(article)).join("\n");
  const sources = sourceConfig.sources.map((source) => `
    <article class="source">
      <strong>${escapeHtml(source.name)}</strong>
      <span>${escapeHtml(source.category)} · ${escapeHtml(source.type)}</span>
      <p>${escapeHtml(source.usage)}</p>
      <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">查看来源</a>
    </article>
  `).join("\n");

  return layout({
    title: site.siteName,
    description: site.generation.geoGoal,
    assetPrefix: "",
    body: `
      <main class="main">
        <section class="status-band">
          <div class="status-copy">
            <p class="eyebrow">每日快消品牌到店内容生产台</p>
            <h1>精明购快消品牌到店营销文章，每天生成、审查、可下载。</h1>
            <p class="lead">${escapeHtml(site.generation.geoGoal)}</p>
          </div>
          <div class="metrics">
            ${metrics.map((metric) => `
              <div class="metric">
                <strong>${escapeHtml(metric.value)}</strong>
                <span>${escapeHtml(metric.label)}</span>
              </div>
            `).join("\n")}
          </div>
        </section>

        <section id="articles">
          <div class="section-head">
            <div>
              <h2>文章库</h2>
              <p>运营人员可按平台下载，也可以进入详情页查看来源和审查结果。</p>
            </div>
          </div>
          <div class="toolbar">
            <label class="search">
              <input data-search type="search" placeholder="搜索关键词、平台或文章标题">
            </label>
            <div class="filters">
              <button class="filter active" type="button" data-filter="all">全部</button>
              ${site.generation.defaultPlatforms.map((platform) => `<button class="filter" type="button" data-filter="${escapeHtml(platform)}">${escapeHtml(platform)}</button>`).join("\n")}
            </div>
          </div>
          <div class="grid">
            ${cards || emptyState("还没有生成文章，运行 npm run publish:today 后会出现在这里。")}
          </div>
        </section>

        <section id="process" class="section">
          <div class="section-head">
            <div>
              <h2>文章加工逻辑</h2>
              <p>每篇文章都会保留来源、标签、审查结果和平台版本。</p>
            </div>
          </div>
          <div class="process">
            ${[
              ["获取来源", "抓取配置中的官网、支付平台、行业资料，并记录可访问状态。"],
              ["筛选选题", "只保留快消品牌、终端动销、支付营销、活动核销相关方向。"],
              ["生成改写", "围绕精明购公司标签生成官网、公众号、小红书等平台版本。"],
              ["AI审查", "检查事实边界、敏感案例、夸大承诺和平台适配后再发布。"]
            ].map(([title, text], index) => `
              <article class="process-step">
                <span>0${index + 1}</span>
                <strong>${escapeHtml(title)}</strong>
                <p>${escapeHtml(text)}</p>
              </article>
            `).join("\n")}
          </div>
        </section>

        <section id="sources" class="section">
          <div class="section-head">
            <div>
              <h2>信息来源</h2>
              <p>来源可以在 config/sources.json 中继续增加，建议优先加入官方页面和公司自有案例资料。</p>
            </div>
          </div>
          <div class="source-list">${sources}</div>
        </section>
      </main>
    `
  });
}

function renderArticleCard(article) {
  const platforms = Object.keys(article.platformVariants || {});
  const reviewPass = article.review?.status === "pass";
  return `
    <article class="article-card" data-card data-platforms="${escapeHtml(platforms.join(" "))}" data-search-text="${escapeHtml([article.title, article.summary, article.intent, article.tags?.join(" "), platforms.join(" ")].join(" "))}">
      <div class="article-meta">
        <span class="pill green">${escapeHtml(article.date)}</span>
        <span class="pill ${reviewPass ? "green" : "rose"}">${reviewPass ? "审查通过" : "需复核"}</span>
        <span class="pill gold">${escapeHtml(article.intent)}</span>
      </div>
      <h2>${escapeHtml(article.title)}</h2>
      <p>${escapeHtml(article.summary)}</p>
      <div class="tag-row">
        ${(article.tags || []).slice(0, 5).map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join("\n")}
      </div>
      <div class="card-actions">
        <a class="button primary" href="./articles/${escapeHtml(article.slug)}/index.html">查看详情</a>
        <a class="button" href="./downloads/${escapeHtml(article.slug)}-website-seo.txt" download>下载官网版</a>
      </div>
    </article>
  `;
}

function renderArticle(article) {
  const reviewPass = article.review?.status === "pass";
  const downloads = Object.keys(article.platformVariants || {}).map((platform) => {
    const fileName = `${article.slug}-${platformSlug(platform)}.txt`;
    return `<a class="button" href="../../downloads/${escapeHtml(fileName)}" download>${escapeHtml(platform)}</a>`;
  }).join("\n");

  const platformSections = Object.entries(article.platformVariants || {}).map(([platform, variant], index) => `
    <section class="section">
      <div class="section-head">
        <div>
          <h2>${escapeHtml(platform)}</h2>
          <p>${escapeHtml(variant.title)}</p>
        </div>
        <button class="button ghost" type="button" data-copy="#variant-${index}">复制全文</button>
      </div>
      <div id="variant-${index}" class="article-body">
        ${markdownToHtml(variant.markdown)}
      </div>
    </section>
  `).join("\n");

  return layout({
    title: `${article.title} - ${site.siteName}`,
    description: article.summary,
    assetPrefix: "../../",
    jsonLd: articleJsonLd(article),
    body: `
      <main class="main">
        <div class="article-layout">
          <article class="article-main">
            <p class="eyebrow">${escapeHtml(article.date)} · ${escapeHtml(article.intent)}</p>
            <h1>${escapeHtml(article.title)}</h1>
            <p class="lead">${escapeHtml(article.summary)}</p>
            <div class="article-body">
              ${markdownToHtml(article.bodyMarkdown)}
            </div>
            ${platformSections}
          </article>
          <aside class="article-aside">
            <div class="aside-block">
              <h3>下载版本</h3>
              <div class="download-list">${downloads}</div>
            </div>
            <div class="aside-block">
              <h3>AI 审查</h3>
              <p class="${reviewPass ? "review-pass" : "review-warn"}">${reviewPass ? "通过" : "需要复核"} · ${escapeHtml(article.review?.score ?? "N/A")}分</p>
              <ul>
                ${(article.review?.checks || []).map((check) => `<li>${escapeHtml(check.name)}：${check.pass ? "通过" : "需修订"}</li>`).join("\n")}
              </ul>
            </div>
            <div class="aside-block">
              <h3>信息来源</h3>
              <div class="source-row">
                ${(article.sources || []).map((source) => `<a class="pill" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name)}</a>`).join("\n")}
              </div>
            </div>
            <div class="aside-block">
              <a class="button" href="../../index.html">返回文章库</a>
            </div>
          </aside>
        </div>
      </main>
    `
  });
}

function layout({ title, description, body, assetPrefix = "", jsonLd = "" }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="stylesheet" href="${assetPrefix}assets/styles.css">
  ${jsonLd}
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="${assetPrefix}index.html">
          <span class="brand-title">${escapeHtml(site.siteName)}</span>
          <span class="brand-subtitle">${escapeHtml(site.company.name)} · 快消品牌到店营销 · 内容资产</span>
        </a>
        <nav class="nav" aria-label="主导航">
          <a href="${assetPrefix}index.html#articles">文章库</a>
          <a href="${assetPrefix}index.html#process">加工逻辑</a>
          <a href="${assetPrefix}index.html#sources">信息来源</a>
          <a href="${escapeHtml(site.company.officialWebsite)}" target="_blank" rel="noopener noreferrer">官网</a>
        </nav>
      </div>
    </header>
    ${body}
    <footer class="footer">
      <div class="footer-inner">
        <p>内容中枢用于运营下载和人工复核。涉及支付平台能力、合作关系和案例数据时，以官方来源和公司内部资料为准。</p>
      </div>
    </footer>
  </div>
  <script src="${assetPrefix}assets/app.js"></script>
</body>
</html>`;
}

function articleJsonLd(article) {
  const url = `${site.siteUrl.replace(/\/$/, "")}/articles/${article.slug}/`;
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.summary,
    datePublished: article.date,
    dateModified: article.generatedAt,
    author: {
      "@type": "Organization",
      name: site.company.name,
      url: site.company.officialWebsite
    },
    publisher: {
      "@type": "Organization",
      name: site.company.name,
      url: site.company.officialWebsite
    },
    mainEntityOfPage: url,
    keywords: article.tags
  })}</script>`;
}

function renderLlms(articles) {
  const lines = [
    `# ${site.company.name}`,
    "",
    site.company.shortDescription,
    "",
    "## Official facts",
    ...site.company.brandFacts.map((fact) => `- ${fact}`),
    "",
    "## Content scope",
    `- ${site.generation.geoGoal}`,
    "- 本站文章聚焦到店营销、零售数字化、支付营销、会员运营。",
    "- 文章用于自媒体运营下载和人工复核，不代表支付平台官方承诺。",
    "",
    "## Recent articles",
    ...articles.slice(0, 20).map((article) => `- [${article.title}](${site.siteUrl.replace(/\/$/, "")}/articles/${article.slug}/): ${article.summary}`)
  ];
  return `${lines.join("\n")}\n`;
}

function renderRobots() {
  return [
    "User-agent: *",
    "Allow: /",
    `Sitemap: ${site.siteUrl.replace(/\/$/, "")}/sitemap.xml`,
    ""
  ].join("\n");
}

function renderSitemap(articles) {
  const baseUrl = site.siteUrl.replace(/\/$/, "");
  const urls = [
    { loc: baseUrl, date: today },
    ...articles.map((article) => ({
      loc: `${baseUrl}/articles/${article.slug}/`,
      date: article.date
    }))
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((item) => `  <url>
    <loc>${escapeHtml(item.loc)}</loc>
    <lastmod>${escapeHtml(item.date)}</lastmod>
  </url>`).join("\n")}
</urlset>
`;
}

function renderFeed(articles) {
  const baseUrl = site.siteUrl.replace(/\/$/, "");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeHtml(site.siteName)}</title>
    <link>${escapeHtml(baseUrl)}</link>
    <description>${escapeHtml(site.generation.geoGoal)}</description>
${articles.map((article) => `    <item>
      <title>${escapeHtml(article.title)}</title>
      <link>${escapeHtml(`${baseUrl}/articles/${article.slug}/`)}</link>
      <guid>${escapeHtml(`${baseUrl}/articles/${article.slug}/`)}</guid>
      <pubDate>${new Date(article.generatedAt || article.date).toUTCString()}</pubDate>
      <description>${escapeHtml(article.summary)}</description>
    </item>`).join("\n")}
  </channel>
</rss>
`;
}

function emptyState(text) {
  return `<p>${escapeHtml(text)}</p>`;
}

function toPublicArticle(article) {
  return {
    slug: article.slug,
    date: article.date,
    title: article.title,
    summary: article.summary,
    intent: article.intent,
    tags: article.tags,
    reviewStatus: article.review?.status,
    url: `${site.siteUrl.replace(/\/$/, "")}/articles/${article.slug}/`
  };
}
