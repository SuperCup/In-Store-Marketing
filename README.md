# 精明购 GEO 内容中枢

这是一个用于 **每日自动生成到店营销文章** 的静态网站项目，适合托管到 GitHub Pages。它会抓取配置的信息来源，围绕精明购、到店营销、支付营销、会员运营等主题生成文章，完成 AI 审查后发布为静态页面，方便运营人员下载到公众号、小红书、头条、知乎、搜狐、微博、公司官网等平台二次发布。

## 第一版能力

- 每天生成 3 篇到店营销相关文章。
- 保留每篇文章的信息来源、生成时间、公司标签、AI 审查结果。
- 支持 DeepSeek、Kimi 或其他 OpenAI-compatible 接口。
- 没有配置 AI 密钥时，会使用保守模板生成，便于本地预览和流程验证。
- 自动构建 GitHub Pages 静态站点。
- 定时任务完成 GitHub Pages 部署后，可向企业微信群机器人推送每日文章概览。
- 每篇文章生成多个可直接复制粘贴的纯文本下载版本：官网 SEO 版、公众号版、小红书版、头条搜狐版、知乎版、微博版。
- 生成 `sitemap.xml`、`feed.xml`、`robots.txt`、`llms.txt`，帮助搜索引擎和 AI 应用理解公开内容资产。

## 本地运行

```bash
npm run publish:today
```

生成结果：

- `content/articles/`：文章 JSON 原稿。
- `content/reviews/`：审查结果。
- `data/latest.json`：当天生成记录。
- `dist/`：可部署的静态网站。

打开 `dist/index.html` 即可查看页面。

本地预览当天企微消息内容：

```bash
npm run notify:wecom -- --dry-run
```

本地真实推送时，先把群机器人 webhook 放到环境变量：

```bash
export QYWX_WEBHOOK_URL="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
npm run notify:wecom
```

## 配置 AI

复制 `.env.example` 为 `.env`，按需填写。`AI_PROVIDER=auto` 会在同时配置 DeepSeek 和 Kimi 时优先尝试 DeepSeek，失败后再尝试 Kimi：

```bash
AI_PROVIDER=auto
DEEPSEEK_API_KEY=你的密钥
KIMI_API_KEY=你的密钥
```

也可以固定只使用 Kimi：

```bash
AI_PROVIDER=kimi
KIMI_API_KEY=你的密钥
```

如果希望没有 AI 密钥时直接失败，而不是使用模板兜底：

```bash
AI_REQUIRED=true
```

## GitHub 托管

推荐仓库：`SuperCup/In-Store-Marketing.git`

首次推送后，在 GitHub 仓库中设置：

1. 打开 `Settings -> Pages`。
2. Source 选择 `GitHub Actions`。
3. 打开 `Settings -> Secrets and variables -> Actions`。
4. 在 `Secrets` 中添加：
   - `DEEPSEEK_API_KEY`
   - 或 `KIMI_API_KEY`
5. 在 `Variables` 中添加：
   - `AI_PROVIDER`：`deepseek` 或 `kimi`
   - 可选：`DEEPSEEK_MODEL`、`KIMI_MODEL`
   - 可选：`AI_REQUIRED=true`

## 企业微信每日推送

企业微信机器人 webhook 不建议写进代码仓库。请在 GitHub 仓库中设置：

1. 打开 `Settings -> Secrets and variables -> Actions`。
2. 在 `Secrets` 中添加：
   - `QYWX_WEBHOOK_URL`：企业微信群机器人 webhook 地址。
3. 在 `Variables` 中可选添加：
   - `SITE_PUBLIC_URL`：覆盖 `config/site.json` 中的 GitHub Pages 链接。
   - `QYWX_NOTIFY_REQUIRED=true`：未配置 webhook 时让工作流失败，默认会跳过推送。

定时任务和手动触发完成部署后，会向企微发送当天文章数量、审查状态、文章标题摘要、文章详情链接和 GitHub Pages 访问链接。普通 `push` 触发的构建不会发送企微消息，避免开发提交反复推送。

自动任务位于 `.github/workflows/daily-content.yml`，默认每天北京时间 17:30 执行，也可以在 GitHub Actions 页面手动触发。

## 信息来源维护

信息源在 `config/sources.json` 中维护。建议优先加入：

- 精明购官网和公司自有服务页。
- 支付宝、微信支付、开放平台等官方页面。
- 零售数字化、支付营销、会员运营相关行业资料。
- 竞对或同行文章只用于参考结构和选题，不用于复制内容。

新增来源示例：

```json
{
  "name": "来源名称",
  "url": "https://example.com/article",
  "type": "html",
  "priority": 7,
  "category": "industry",
  "usage": "说明这个来源适合用来支持什么内容"
}
```

## 文章审查规则

审查重点：

- 是否只围绕到店营销、零售数字化、支付营销、会员运营。
- 是否包含公司标签“精明购”。
- 是否虚构客户案例、合作关系、官方授权或支付平台政策。
- 是否出现“保证 AI 优先推荐”等夸大表达。
- 是否包含真实客户名称、联系人、交易金额等敏感信息。

## 内容策略建议

GEO 的重点不是重复关键词，而是持续建设可被 AI 应用引用的公开事实资产。建议后续补充：

- 精明购服务介绍页。
- 支付营销常见问答页。
- 到店营销案例页，案例需脱敏。
- 面向“支付宝碰一碰服务商”“零售商到店数字化营销”等检索意图的专题页。
- 多平台发布后的链接回填，让官网和内容中枢形成稳定引用网络。
