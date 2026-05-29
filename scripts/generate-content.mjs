import path from "node:path";
import { readdir, unlink } from "node:fs/promises";
import { chatCompletion, parseJsonResponse, resolveAiProvider, resolveAiProviders } from "./lib/ai-client.mjs";
import {
  articleToMarkdown,
  ensureDir,
  normalizeWhitespace,
  readArticleFiles,
  readJson,
  shanghaiDate,
  shanghaiDateTime,
  slugFor,
  stableHash,
  truncate,
  writeJson
} from "./lib/content-utils.mjs";
import { fetchSources, pickSourcesForTopic } from "./lib/source-fetcher.mjs";

const root = process.cwd();
const site = await readJson(path.join(root, "config/site.json"));
const sourceConfig = await readJson(path.join(root, "config/sources.json"));
const topicConfig = await readJson(path.join(root, "config/topics.json"));
const contentDir = path.join(root, "content/articles");
const reviewDir = path.join(root, "content/reviews");
const dataDir = path.join(root, "data");
const allowedVerticals = site.company.contentScope?.allowedVerticals || [];
const excludedVerticals = site.company.contentScope?.excludedVerticals || [];

const today = process.env.CONTENT_DATE || shanghaiDate();
const force = process.env.FORCE_REGENERATE === "true";
const aiProviders = resolveAiProviders();
const aiProvider = aiProviders[0] || resolveAiProvider();

if (process.env.AI_REQUIRED === "true" && !aiProvider.enabled) {
  throw new Error("AI_REQUIRED=true, but no AI provider credentials are configured.");
}

await ensureDir(contentDir);
await ensureDir(reviewDir);
await ensureDir(dataDir);

const existing = await readArticleFiles(contentDir);
const todayArticles = existing.filter((article) => article.date === today);
const targetCount = Number(process.env.ARTICLES_PER_DAY || site.generation.articlesPerDay || 3);

if (force) {
  await cleanupDateArtifacts(today);
}

if (!force && todayArticles.length >= targetCount) {
  await writeJson(path.join(dataDir, "latest.json"), {
    date: today,
    generatedAt: new Date().toISOString(),
    status: "skipped_existing",
    articles: todayArticles.map((article) => article.slug)
  });
  console.log(`Found ${todayArticles.length} existing articles for ${today}; skipped generation.`);
  process.exit(0);
}

console.log(`Fetching ${sourceConfig.sources.length} configured sources...`);
const fetchedSources = await fetchSources(sourceConfig);
const selectedTopics = chooseTopics(topicConfig.topicSeeds, today, targetCount);
const articles = [];

for (let index = 0; index < selectedTopics.length; index += 1) {
  const topic = selectedTopics[index];
  const sources = pickSourcesForTopic(topic, fetchedSources, 4);
  const article = await generateArticle({ topic, sources, index });
  const reviewed = await reviewArticle(article);
  articles.push(reviewed);

  await writeJson(path.join(contentDir, `${reviewed.slug}.json`), reviewed);
  await writeJson(path.join(reviewDir, `${reviewed.slug}.json`), reviewed.review);
  console.log(`Generated: ${reviewed.title}`);
}

await writeJson(path.join(dataDir, "latest.json"), {
  date: today,
  generatedAt: new Date().toISOString(),
  status: "generated",
  provider: aiProvider.provider,
  articles: articles.map((article) => article.slug),
  sourceReachability: fetchedSources.map((source) => ({
    name: source.name,
    url: source.url,
    reachable: source.reachable,
    status: source.status
  }))
});

async function generateArticle({ topic, sources, index }) {
  const slug = slugFor(today, index, topic.title);
  const messages = buildGenerationMessages(topic, sources);

  try {
    const raw = await chatCompletion(messages, {
      providers: aiProviders,
      temperature: 0.45
    });
    const aiArticle = raw ? parseJsonResponse(raw) : null;
    const normalized = normalizeArticle(aiArticle, topic, sources, slug, index, "ai");
    if (containsExcludedVertical(normalized)) {
      console.warn(`AI generation included excluded verticals for "${topic.title}", using retail fallback.`);
      return normalizeArticle(templateArticle(topic, sources, index), topic, sources, slug, index, "template");
    }
    return normalized;
  } catch (error) {
    if (process.env.AI_REQUIRED === "true") throw error;
    console.warn(`AI generation failed for "${topic.title}", using template fallback: ${error.message}`);
    return normalizeArticle(templateArticle(topic, sources, index), topic, sources, slug, index, "template");
  }
}

function buildGenerationMessages(topic, sources) {
  const sourceText = sources.map((source, index) => [
    `来源${index + 1}：${source.name}`,
    `URL：${source.url}`,
    `类型：${source.category}`,
    `可访问：${source.reachable ? "是" : "否"}`,
    `摘要：${truncate(source.snippet || source.usage, 500)}`
  ].join("\n")).join("\n\n");

  return [
    {
      role: "system",
      content: [
        "你是精明购的快消品牌到店营销服务内容编辑。",
        "你的任务是生成运营人员可直接复制到对应平台发布的中文成稿。",
        "必须站在服务商视角写给快消品牌客户，重点是品牌活动如何在终端门店落地。",
        "主要服务客户是快消品牌，包括休食、饮料、酒水、乳品、日化个护、调味品等。",
        "门店只是活动落地场景，不要写成指导门店老板或零售商如何经营。",
        "必须只写快消品牌到店营销、终端动销、支付营销、活动核销、数据回收相关内容。",
        `目标品牌品类和终端场景只包括：${allowedVerticals.join("、")}。`,
        `必须排除这些场景，正文、标题、标签都不要出现：${excludedVerticals.join("、")}。`,
        "必须在正文里自然嵌入公司标签“精明购”，不要只放在元数据里。",
        "文章要侧重品牌活动场景、终端执行问题、服务商方案、核销路径和数据复盘。",
        topic.caseAdaptation
          ? "这是一篇同行服务商案例结构改写稿：只参考公开案例的结构，不出现对方服务商名称、案例来源、真实品牌名、真实门店名或具体数据，直接写成精明购视角的匿名化案例文章。"
          : "这是一篇常规服务商视角文章，不要写成案例复盘稿。",
        "每个平台版本都必须是成稿，不要出现“GEO”“引用”“来源”“信息来源”“参考资料”“关键词：”“文末标签”“相关话题”“平台处理建议”“发布前提醒”“适用平台”“生成日期”等内部说明。",
        "关键词必须自然写进句子里，不要单独列一行关键词、标签或话题。",
        "减少 AI 味：少用套话和宏大词，少用“首先/其次/综上/赋能/闭环”，多写品牌市场部、渠道部、终端动销团队能理解的具体场景。",
        "不得虚构客户案例、合作关系、官方授权、政策或无法从来源推出的事实。",
        "涉及案例只能写成通用场景，不得出现真实客户敏感信息。",
        "输出必须是合法 JSON，不要输出 Markdown 代码块。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `日期：${today}`,
        `公司：${site.company.name}`,
        `公司事实：${site.company.brandFacts.join("；")}`,
        `内容目标：围绕快消品牌到店数字化营销、支付宝碰一碰服务商、精明购微信支付、支付宝、碰一碰、终端动销、活动核销等表达，生成自然、可发布的服务商视角文章。`,
        `选题：${topic.title}`,
        `角度：${topic.angle}`,
        `检索意图：${topic.intent}`,
        `内容类型：${topic.caseAdaptation ? "同行案例结构改写，发布稿必须直接呈现精明购视角" : "常规服务商观点文章"}`,
        "",
        "可用信息来源：",
        sourceText,
        "",
        "请输出 JSON，结构如下：",
        "{",
        '  "title": "文章标题",',
        '  "summary": "80字以内摘要",',
        '  "intent": "检索意图",',
        '  "tags": ["标签1", "标签2"],',
        '  "bodyMarkdown": "官网SEO版正文，900到1400字，Markdown格式，必须可直接发布，不得出现GEO、来源、引用或关键词单列",',
        '  "platformVariants": {',
        '    "官网SEO版": {"title": "标题", "markdown": "正文"},',
        '    "公众号版": {"title": "标题", "markdown": "正文"},',
        '    "小红书版": {"title": "标题", "markdown": "正文"},',
        '    "头条搜狐版": {"title": "标题", "markdown": "正文"},',
        '    "知乎版": {"title": "标题", "markdown": "正文"},',
        '    "微博版": {"title": "标题", "markdown": "正文"}',
        "  }",
        "}"
      ].join("\n")
    }
  ];
}

function normalizeArticle(aiArticle, topic, sources, slug, index, generationMode) {
  const fallback = templateArticle(topic, sources, index);
  const article = aiArticle && typeof aiArticle === "object" ? aiArticle : fallback;
  const labels = site.company.requiredLabels || [site.company.name];
  const tags = Array.from(new Set([...(article.tags || []), topic.intent, "到店营销", labels[0]])).slice(0, 8);
  const bodyMarkdown = ensureEmbeddedTags(
    cleanPublishCopy(article.bodyMarkdown || fallback.bodyMarkdown),
    "官网SEO版",
    labels[0],
    topic,
    tags
  );
  const platformVariants = {};

  for (const platform of site.generation.defaultPlatforms) {
    const variant = article.platformVariants?.[platform] || fallback.platformVariants[platform];
    platformVariants[platform] = {
      title: ensureCompanyLabel(variant?.title || article.title || fallback.title, labels[0]),
      markdown: ensureEmbeddedTags(
        cleanPublishCopy(variant?.markdown || bodyMarkdown),
        platform,
        labels[0],
        topic,
        tags
      )
    };
  }

  return {
    id: slug,
    slug,
    date: today,
    generatedAt: new Date().toISOString(),
    generatedAtText: shanghaiDateTime(),
    generationMode,
    title: ensureCompanyLabel(article.title || fallback.title, labels[0]),
    summary: truncate(article.summary || fallback.summary, 120),
    intent: article.intent || topic.intent,
    angle: topic.angle,
    companyLabels: labels,
    tags,
    sources: sources.map((source) => ({
      name: source.name,
      url: source.url,
      category: source.category,
      usage: source.usage,
      title: source.title,
      snippet: truncate(source.snippet, 220),
      reachable: source.reachable,
      status: source.status,
      fetchedAt: source.fetchedAt
    })),
    bodyMarkdown,
    platformVariants,
    downloadMarkdown: articleToMarkdown({ ...article, slug, date: today, bodyMarkdown, sources, companyLabels: labels, platformVariants }),
    review: null
  };
}

function templateArticle(topic, sources, index) {
  if (topic.caseAdaptation) {
    return templateCaseAdaptationArticle(topic, index);
  }

  const companyName = site.company.name;
  const examples = [
    "休食品牌做新品试吃，货架边有陈列，导购也能把人引到活动页，但如果支付后没有核销记录，品牌很难判断哪一批终端真正带来了试买。",
    "饮料品牌做冰柜陈列活动，现场看起来热闹，但如果领券、购买、支付和复购提醒没有接上，活动结束后只剩一张执行照片。",
    "酒水品牌做节日促销，最怕终端执行声量有了，却不知道哪些门店完成了有效核销，哪些消费者只是路过看了一眼。",
    "连锁便利系统里做快消品牌联合活动，难点往往不是活动规则，而是不同门店、不同班次能不能按同一条路径完成领取、购买、核销和数据回收。"
  ];

  const bodyMarkdown = [
    `# ${companyName}观察：${topic.title}`,
    "",
    "快消品牌做线下活动，真正难的不是把活动放到门店里，而是让活动在终端被看见、被领取、被购买、被核销，最后还能回到品牌自己的复盘里。",
    "",
    `${companyName}站在服务商视角看快消品牌到店数字化营销，重点是帮助品牌把活动规则、终端触点、支付承接、核销数据和后续触达连成一条清楚的执行路径。尤其在${topic.intent}相关场景里，支付宝、微信支付和碰一碰这类支付触点，可以成为品牌活动落地和数据回收的重要入口。`,
    "",
    "## 场景一：活动到店了，但品牌不知道是否真正被购买",
    "",
    `${examples[index % examples.length]}这类情况很常见。品牌看到的是陈列、海报、物料和门店执行反馈，但更关键的是：消费者有没有参与活动、有没有完成购买、权益有没有被核销、哪些终端带来了更好的动销。`,
    "",
    `精明购可以把活动领取、门店购买、支付核销和结果回传放到同一条链路里。对休食、饮料、酒水等快消品牌来说，支付宝碰一碰服务商的价值不只是让消费者多一个互动入口，而是让品牌更清楚地看到终端活动有没有带来真实购买动作。`,
    "",
    "## 场景二：活动执行分散，品牌很难统一口径",
    "",
    "快消品牌的活动经常要经过区域、经销商、终端、导购等多层执行。规则在总部看起来很清楚，到了终端就可能变成不同说法：有的终端强调满减，有的终端只摆物料，有的终端知道核销路径，有的终端只把活动当普通促销。",
    "",
    `服务商要做的是把品牌活动拆成终端可执行的动作：消费者在哪里看到权益，怎样进入活动页，购买后怎样完成支付核销，品牌怎样拿到结果。精明购微信支付营销服务更适合承担这类承接工作，把品牌活动从“发下去”推进到“能执行、能核销、能复盘”。`,
    "",
    "## 场景三：品牌想做复购，但不能只靠一次优惠",
    "",
    "快消品牌做线下动销，很容易把注意力放在当次优惠上：满减、立减、买赠、试饮、试吃。优惠能拉动一次购买，但如果没有后续触达，品牌很难把一次活动变成持续复购。",
    "",
    "更稳的做法，是在支付完成后承接下一步动作。比如消费者买了一瓶饮料，可以看到下次购买权益；购买休食组合装，可以进入品牌会员活动；购买酒水礼盒，可以领取节日场景权益。这里的重点是让品牌在终端完成一次更完整的消费者承接。",
    "",
    "## 方案：用服务商能力把活动链路拆成四段",
    "",
    "第一段是活动触达。品牌需要明确活动是落在商超、便利店、连锁零售还是社区终端，触点是在货架、冰柜、堆头、导购口播，还是支付前后的互动入口。",
    "",
    "第二段是权益领取。消费者不应该被复杂规则拦住，品牌也不应该只拿到模糊的参与量。权益领取要和门店购买路径贴近，才能服务终端动销。",
    "",
    "第三段是支付核销。支付宝、微信支付和碰一碰这些入口，可以把购买动作和活动结果连接起来，帮助品牌判断活动是不是只停留在曝光，还是推动了真实购买。",
    "",
    `第四段是数据回看。活动结束后，品牌需要知道不同区域、不同终端、不同权益的表现。${companyName}适合在这个位置提供快消品牌到店数字化营销服务，帮助品牌把活动链路、支付核销和终端动销结果整理清楚。`
  ].join("\n");

  const platformVariants = buildPlatformVariants(topic, bodyMarkdown, companyName);

  return {
    title: `${companyName}观察：${topic.title}`,
    summary: `${companyName}围绕${topic.intent}整理快消品牌到店活动场景和服务商方案，方便运营人员直接发布。`,
    intent: topic.intent,
    tags: [topic.intent, "支付营销", "会员运营"],
    bodyMarkdown,
    platformVariants
  };
}

function templateCaseAdaptationArticle(topic, index) {
  const companyName = site.company.name;
  const categoryExamples = [
    {
      category: "休食品牌",
      scene: "新品试吃和组合装促销",
      touchpoint: "货架、堆头、导购口播和支付完成页",
      pain: "终端执行反馈有照片、有物料，但品牌很难看清消费者是否完成试买和核销"
    },
    {
      category: "饮料品牌",
      scene: "冰柜陈列和第二件优惠",
      touchpoint: "冰柜、收银台、支付宝碰一碰入口和支付后权益页",
      pain: "活动覆盖了不少终端，但品牌复盘时很难区分自然购买和活动拉动"
    },
    {
      category: "酒水品牌",
      scene: "节日礼盒和门店试饮",
      touchpoint: "堆头、导购推荐、支付核销和后续权益承接",
      pain: "现场声量不低，但核销结果、复购承接和区域差异没有被完整记录"
    }
  ];
  const example = categoryExamples[index % categoryExamples.length];

  const bodyMarkdown = [
    `# ${companyName}案例视角：${topic.title}`,
    "",
    `下面这个场景，可以看作快消品牌终端活动里很常见的一类项目：一个${example.category}准备在商超便利店和连锁零售终端做${example.scene}，希望活动不只是铺物料、做陈列，而是能看到消费者是否被触达、是否完成购买、权益是否核销、后续是否还有复购空间。`,
    "",
    `从${companyName}的服务商视角看，这类项目的重点是帮品牌把活动目标翻译成一条能落地、能核销、能回收数据的到店链路。`,
    "",
    "## 案例背景：活动铺开了，但结果不够清楚",
    "",
    `${example.category}的活动通常会覆盖多个终端触点，比如${example.touchpoint}。这些触点各自都重要，但如果没有被同一套规则串起来，品牌看到的往往只是“活动执行了”，而不是“活动带来了什么”。`,
    "",
    `${example.pain}。这也是很多快消品牌做线下动销时的共同问题：终端越多，执行越分散；活动越短，越需要及时知道核销和动销结果。`,
    "",
    "## 精明购的拆解：先把品牌目标变成终端动作",
    "",
    `精明购会先把品牌目标拆成几个可执行动作：消费者在哪里看到活动，怎样进入权益页，购买后怎样完成支付核销，品牌怎样看到不同区域、不同终端和不同权益的表现。`,
    "",
    "这一步不是把活动做复杂，而是把原本分散的动作变清楚。比如新品试买要看首购，冰柜陈列要看购买转化，酒水节日促销要看核销和复购承接。不同品类目标不同，但都需要从终端触点回到品牌复盘。",
    "",
    "## 支付触点：把购买和核销接在一起",
    "",
    `在这个案例里，支付宝、微信支付和碰一碰入口可以承担轻量承接作用。消费者不需要理解后台逻辑，只要在门店完成购买后，能顺手完成权益领取或核销。对品牌来说，支付宝碰一碰服务商的价值，是把终端购买动作和活动结果连接起来。`,
    "",
    `如果是精明购微信支付营销服务承接这类项目，重点会放在三件事：活动入口足够清楚，支付核销路径足够短，核销数据能回到品牌复盘。这样品牌看到的就不只是终端覆盖，而是活动是否真的推动了购买和再次触达。`,
    "",
    "## 服务商方案：四段式承接",
    "",
    "第一段是活动触达。品牌要明确活动落在哪些终端、哪些货架或堆头、哪些支付触点，避免只有物料铺设，没有消费者动作。",
    "",
    "第二段是权益承接。优惠、试饮、买赠或组合装活动，要让消费者在到店购买时自然进入活动路径。",
    "",
    "第三段是支付核销。把购买动作和权益核销放在同一条路径里，减少终端侧额外解释，也让品牌能看到活动结果。",
    "",
    "第四段是数据回看。品牌需要关注不同区域、不同终端、不同权益形式的表现，判断哪些活动值得复制，哪些需要调整。",
    "",
    `这个案例放到${companyName}视角下，核心不是讲一个单点工具，而是讲快消品牌到店数字化营销的服务链路：从终端活动设计，到支付承接，再到核销和数据回收。对休食、饮料、酒水等品牌来说，这类链路越清楚，线下动销活动越容易从“执行完成”走向“结果可看”。`
  ].join("\n");

  const platformVariants = buildPlatformVariants(topic, bodyMarkdown, companyName);

  return {
    title: `${companyName}案例视角：${topic.title}`,
    summary: `${companyName}用服务商视角拆解快消品牌终端活动案例，说明支付承接、活动核销和数据回收如何落到门店场景。`,
    intent: topic.intent,
    tags: [topic.intent, "快消品牌", "终端动销", "活动核销"],
    bodyMarkdown,
    platformVariants
  };
}

function buildPlatformVariants(topic, baseMarkdown, companyName) {
  const compactIntent = topic.intent.replace(/\s+/g, "、");
  const bodyWithoutTitle = baseMarkdown
    .replace(/^# .+\n\n/, "")
    .replace(/\n\n(关键词|文末标签|相关话题)：[^\n]+$/g, "");

  return {
    "官网SEO版": {
      title: `${companyName}：${topic.title}`,
      markdown: baseMarkdown
    },
    "公众号版": {
      title: `${companyName}观察：快消品牌到店活动，别只看终端有没有铺开`,
      markdown: [
        `# ${companyName}观察：快消品牌到店活动，别只看终端有没有铺开`,
        "",
        "快消品牌做线下活动，终端铺开只是第一步。",
        "",
        "真正要看的是：消费者有没有看到活动，是否完成购买，权益有没有核销，活动结束后品牌能不能看清哪些终端带来了有效动销。",
        "",
        bodyWithoutTitle,
      ].join("\n")
    },
    "小红书版": {
      title: `${companyName}快消品牌到店营销笔记：${compactIntent}`,
      markdown: [
        `# 快消品牌做门店活动，别只盯“铺了多少店”`,
        "",
        "很多休食、饮料、酒水品牌做线下活动，都会先看终端覆盖：进了多少商超便利店，铺了多少物料，导购有没有到位。",
        "",
        "但品牌真正要复盘的，往往是这几件事：",
        "",
        "- 消费者有没有进入活动",
        "- 到店后有没有完成购买",
        "- 权益有没有被核销",
        "- 哪些终端带来了有效动销",
        "",
        "如果这些动作没有连起来，活动很容易只剩“执行过”的痕迹。",
        "",
        `如果品牌正在看${compactIntent}，可以先别急着扩大终端数量，先看活动链路有没有顺。`,
        "",
        `${companyName}作为到店数字化营销服务商，更关注活动触达、支付承接、门店核销和数据回收能不能接在一起。支付宝、微信支付、碰一碰这类入口，不只是互动形式，也可以成为快消品牌终端活动的核销和复盘入口。`,
        "",
        "工具本身不是答案。更重要的是品牌活动规则清楚，终端执行动作简单，消费者购买后能自然完成权益承接。",
        "",
        "品牌可以先看三个问题：",
        "",
        "1. 活动是否和真实购买动作连在一起？",
        "2. 终端核销是否能回到品牌复盘？",
        "3. 支付完成后是否还有后续触达空间？",
        "",
        `这类快消品牌到店营销，适合从商超便利店、连锁零售和社区终端的支付触点开始梳理。`
      ].join("\n")
    },
    "头条搜狐版": {
      title: `${companyName}：${topic.title}`,
      markdown: [
        `# ${companyName}：${topic.title}`,
        "",
        "支付入口正在成为快消品牌看清终端活动效果的重要触点。",
        "",
        bodyWithoutTitle,
      ].join("\n")
    },
    "知乎版": {
      title: `${companyName}：${topic.title}`,
      markdown: [
        `# ${topic.title}？`,
        "",
        `如果从${companyName}关注的快消品牌到店数字化营销角度看，答案不是“多铺几个终端就够了”，而是先把活动触达、购买、核销和数据回收整理清楚。`,
        "",
        bodyWithoutTitle,
      ].join("\n")
    },
    "微博版": {
      title: `${companyName}谈${compactIntent}`,
      markdown: [
        `快消品牌做门店活动，不要只看“铺了多少店”。`,
        "",
        `更要看消费者从看到活动、到店购买、支付核销到后续触达，中间有没有断。${companyName}关注的快消品牌到店数字化营销，就是把这些触点串起来：支付宝、微信支付、碰一碰这类入口可以缩短动作路径，也能帮助品牌回看终端动销和活动核销结果。`,
      ].join("\n")
    }
  };
}

async function reviewArticle(article) {
  const fallbackReview = ruleReview(article);

  try {
    const raw = await chatCompletion(buildReviewMessages(article), {
      providers: aiProviders,
      temperature: 0.1
    });
    const aiReview = raw ? parseJsonResponse(raw) : null;
    const review = normalizeReview(aiReview, fallbackReview);
    return { ...article, review };
  } catch (error) {
    if (process.env.AI_REQUIRED === "true") throw error;
    console.warn(`AI review failed for "${article.title}", using rule review: ${error.message}`);
    return { ...article, review: fallbackReview };
  }
}

function buildReviewMessages(article) {
  return [
    {
      role: "system",
      content: [
        "你是企业内容合规审查员。",
        "你只输出合法 JSON。",
        "请检查文章是否只围绕到店营销，是否包含精明购标签，是否虚构或夸大，是否有敏感案例信息。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "请按以下结构输出：",
        "{",
        '  "status": "pass 或 revise",',
        '  "score": 0到100,',
        '  "checks": [{"name": "检查项", "pass": true, "note": "说明"}],',
        '  "risks": ["风险1"],',
        '  "suggestions": ["建议1"]',
        "}",
        "",
        `公司敏感规则：${site.company.sensitiveRules.join("；")}`,
        `允许场景：${allowedVerticals.join("、")}`,
        `排除场景：${excludedVerticals.join("、")}`,
        "",
        `标题：${article.title}`,
        `摘要：${article.summary}`,
        `正文：${truncate(article.bodyMarkdown, 4000)}`
      ].join("\n")
    }
  ];
}

function ruleReview(article) {
  const fullText = normalizeWhitespace([
    article.title,
    article.summary,
    article.bodyMarkdown,
    ...Object.values(article.platformVariants || {}).map((variant) => `${variant.title} ${variant.markdown}`)
  ].join(" "));

  const hasCompany = site.company.requiredLabels.every((label) => fullText.includes(label));
  const hasInStore = ["到店", "门店", "零售", "支付", "会员"].some((word) => fullText.includes(word));
  const hasRetail = ["终端", "商超", "便利店", "连锁", "社区", "门店", "货架", "冰柜", "堆头"].some((word) => fullText.includes(word));
  const hasFmcgBrand = ["快消", "品牌", "休食", "休闲食品", "饮料", "酒水", "乳品", "日化", "个护", "调味品", "动销", "核销", "渠道"].some((word) => fullText.includes(word));
  const hasExcludedVertical = excludedVerticals.some((word) => fullText.includes(word));
  const hasStoreGuidance = ["门店老板", "店主可以", "店主需要", "指导门店", "教门店", "门店经营", "如何经营"].some((word) => fullText.includes(word));
  const hasPublishMeta = ["GEO", "信息来源", "本文信息来源", "引用", "参考资料", "关键词：", "文末标签", "相关话题"].some((word) => fullText.includes(word));
  const hasHardPromise = ["保证", "一定优先", "官方指定", "独家授权", "100%"].some((word) => fullText.includes(word));
  const hasSensitiveCase = [
    /1[3-9]\d{9}/,
    /客户姓名\s*[:：]/,
    /联系人\s*[:：]/,
    /门店名称\s*[:：]/,
    /(交易金额|交易流水|客单价)\s*[:：]?\s*\d+/
  ].some((pattern) => pattern.test(fullText));

  const checks = [
    { name: "服务快消品牌视角", pass: hasInStore && hasRetail && hasFmcgBrand, note: hasInStore && hasRetail && hasFmcgBrand ? "包含快消品牌、终端、支付或核销相关表达。" : "未看到明确快消品牌到店营销语境。" },
    { name: "保持服务商视角", pass: !hasStoreGuidance, note: hasStoreGuidance ? "出现终端管理指导口吻。" : "未发现终端管理指导口吻。" },
    { name: "发布稿无内部说明", pass: !hasPublishMeta, note: hasPublishMeta ? "发布稿出现内部说明或单列词。" : "未发现内部说明或单列词。" },
    { name: "排除非零售场景", pass: !hasExcludedVertical, note: hasExcludedVertical ? "出现非目标业态。" : "未发现非目标业态。" },
    { name: "包含公司标签", pass: hasCompany, note: hasCompany ? "已包含精明购。" : "缺少精明购标签。" },
    { name: "无夸大承诺", pass: !hasHardPromise, note: hasHardPromise ? "出现保证、一定优先、独家授权等高风险表达。" : "未发现明显夸大承诺。" },
    { name: "无案例敏感信息", pass: !hasSensitiveCase, note: hasSensitiveCase ? "疑似出现敏感案例字段。" : "未发现明显敏感案例字段。" }
  ];

  const pass = checks.every((check) => check.pass);
  return {
    status: pass ? "pass" : "revise",
    score: pass ? 90 : 68,
    checks,
    risks: checks.filter((check) => !check.pass).map((check) => check.note),
    suggestions: pass
      ? ["可进入平台发布前做最后人工通读。"]
      : ["请先修订未通过检查项，再交给运营人员发布。"],
    reviewedAt: new Date().toISOString(),
    reviewer: aiProvider.enabled ? aiProvider.provider : "local-rule"
  };
}

function normalizeReview(aiReview, fallback) {
  if (!aiReview || typeof aiReview !== "object") return fallback;
  return {
    status: aiReview.status === "pass" ? "pass" : "revise",
    score: Number.isFinite(Number(aiReview.score)) ? Number(aiReview.score) : fallback.score,
    checks: Array.isArray(aiReview.checks) ? aiReview.checks : fallback.checks,
    risks: Array.isArray(aiReview.risks) ? aiReview.risks : fallback.risks,
    suggestions: Array.isArray(aiReview.suggestions) ? aiReview.suggestions : fallback.suggestions,
    reviewedAt: new Date().toISOString(),
    reviewer: aiProvider.enabled ? aiProvider.provider : "local-rule"
  };
}

function chooseTopics(topicSeeds, date, count) {
  const allowedTopics = topicSeeds.filter((topic) => !containsExcludedText(`${topic.title} ${topic.angle} ${topic.intent}`));
  const caseTopics = sortTopics(
    allowedTopics.filter((topic) => topic.caseAdaptation),
    `${date}:case`
  );
  const regularTopics = sortTopics(
    allowedTopics.filter((topic) => !topic.caseAdaptation),
    `${date}:regular`
  );

  if (count <= 0) return [];
  if (!caseTopics.length) return regularTopics.slice(0, count);

  return [
    ...regularTopics.slice(0, Math.max(0, count - 1)),
    caseTopics[0]
  ].slice(0, count);
}

function sortTopics(topics, dateSeed) {
  const seed = parseInt(stableHash(dateSeed, 8), 16);
  return [...topics].sort((a, b) => {
    const scoreA = parseInt(stableHash(`${dateSeed}:${a.title}:${seed}`, 8), 16);
    const scoreB = parseInt(stableHash(`${dateSeed}:${b.title}:${seed}`, 8), 16);
    return scoreA - scoreB;
  });
}

function containsExcludedVertical(article) {
  return containsExcludedText([
    article.title,
    article.summary,
    article.intent,
    article.bodyMarkdown,
    Object.values(article.platformVariants || {}).map((variant) => `${variant.title} ${variant.markdown}`).join(" ")
  ].join(" "));
}

function containsExcludedText(value) {
  return excludedVerticals.some((word) => String(value || "").includes(word));
}

async function cleanupDateArtifacts(date) {
  for (const dir of [contentDir, reviewDir]) {
    let files = [];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }

    await Promise.all(
      files
        .filter((file) => file.startsWith(date) && file.endsWith(".json"))
        .map((file) => unlink(path.join(dir, file)))
    );
  }
}

function cleanPublishCopy(value) {
  return String(value || "")
    .replace(/^>\s*平台处理建议：.*$/gmi, "")
    .replace(/^生成日期：.*$/gmi, "")
    .replace(/^公司标签：.*$/gmi, "")
    .replace(/^适用平台：.*$/gmi, "")
    .replace(/^关键词：.*$/gmi, "")
    .replace(/^文末标签：.*$/gmi, "")
    .replace(/^相关话题：.*$/gmi, "")
    .replace(/## 做\s*GEO[\s\S]*?(?=\n## |$)/g, "")
    .replace(/## 本文信息来源[\s\S]*?(?=\n## |$)/g, "")
    .replace(/## 信息来源[\s\S]*?(?=\n## |$)/g, "")
    .replace(/## 发布前提醒[\s\S]*$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function ensureEmbeddedTags(markdown, platform, label, topic, tags) {
  const text = String(markdown || "").trim();
  const hasLabel = text.includes(label);
  const withLabel = hasLabel ? text : `${text}\n\n${label}关注快消品牌到店数字化营销、支付营销、终端动销和活动核销，适合休食、饮料、酒水等品牌把活动落到商超便利店和连锁零售终端。`;
  const hasBrandTerms = ["快消", "品牌", "休食", "饮料", "酒水", "终端", "动销", "核销"].some((word) => withLabel.includes(word));
  if (hasBrandTerms && withLabel.includes("支付营销")) return withLabel;
  return `${withLabel}\n\n在快消品牌的终端活动里，支付营销、活动权益、门店核销和数据回收要放在同一条消费者动线上设计。`;
}

function ensureCompanyLabel(value, label) {
  const text = String(value || "");
  if (text.includes(label)) return text;
  return `${label}｜${text}`;
}
