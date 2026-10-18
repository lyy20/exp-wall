# 罗毅扬 · AI Agent 开发工程师 ｜ 个人作品集

在线预览 👉 **https://lyy20.github.io/exp-wall/**

一个深色主题的单页作品集（全屏 Hero、横向滚动图带、逐字渐显的自我介绍、Framer Motion 粘性堆叠项目卡，底衬 Three.js 粒子星空 + 布料式鼠标斥力 + 点击彩色墨水），
并在这一个域名、一个仓库里额外交付了 **2 个可交互的项目 Demo 页**：把真实项目里「不需要后端也能真跑」的部分搬进浏览器。

| 入口 | 地址 | 这页能做什么 |
| --- | --- | --- |
| 作品集首页 | https://lyy20.github.io/exp-wall/ | 主视觉 + 4 张项目卡 + 2 块迷你面板（滚到就自动真跑，不用点按钮） |
| YYHelp 交互演示（商城 + AI 助手） | https://lyy20.github.io/exp-wall/yyhelp/ | 登录单独一屏（演示账号一键登录）→ 左侧商城：加购、填收货信息下单、申请退款 / 修改地址；右侧 AI 助手读同一份订单，给出「订单 2001 到哪了？」这类模板问题，打开「显示流程」可看每步工具调用（关闭只看结论）。助手记住上下文，可直接说「催一催」「把地址改成…」（写操作先确认、可撤销），刷新后会话保留，支持新会话 / 编辑重发；窄屏收成底部抽屉。另有**运营后台**（登录页切「管理员登录」，`admin / admin123`）：查看全部订单、审核用户退款（通过 / 驳回）、发货、签收、改地址——操作后用户端与助手立刻读到新状态。`/shop/` 会跳到这里 |
| 科研文献 RAG 问答 | https://lyy20.github.io/exp-wall/rag/ | 问一句 → 真检索 → 真模型作答，答案带可展开的原文引用；20 题 Recall@5 / MRR 在浏览器里重算并与 Python 侧对照 |

| AI 学习工作台 | https://lyy20.github.io/exp-wall/learn/ | 把前两个项目的代码逐页拆成讲义：182 页 / 73.5 万字、43 张自绘交互式架构图、241 张 Mermaid、8 页面试题。**AI 助教只在本地版可用**（它依赖本机 node 服务），静态发布版里会自己标成「静态发布版」并禁用输入 |

两页都把「真跑什么」写在能验证的位置（数字、引用、工具返回），不把演示说成产品。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | React 18.3.1 + TypeScript 5.6 + Vite 5.4（多入口：`index.html` / `rag/` / `yyhelp/` / `shop/`） |
| 样式 | TailwindCSS 3.4.1 + PostCSS/Autoprefixer + 一套共享设计令牌（`src/shared/styles/tokens.css`） |
| 动效 | Framer Motion 12.38.0（whileInView / useScroll / useTransform）、GSAP 3.12（ticker） |
| 3D | Three.js 0.128（6000 点粒子星云） |
| 图标 | lucide-react 0.344.0 |
| LLM 与检索 | 浏览器直连 7 家兼容 OpenAI 协议的厂商（DeepSeek / SiliconFlow / DashScope / 智谱 / Moonshot / 火山方舟 / MiniMax），SSE 流式；RAG 的检索与评测算子全部在浏览器内实现 |

## 目录结构

```
src/
  App.tsx                 首页装配：StarField / 各 Section / DemoPanels / ClothEffect / ClickInk
  index.css               字体、全局重置、.hero-heading 渐变字
  components/
    HeroSection.tsx       全屏主视觉 + 导航 + 身份行
    MarqueeSection.tsx    两行横向滚动图带（滚动驱动 translateX）
    AboutSection.tsx      自我介绍（逐字滚动透明度）
    ProjectsSection.tsx   3 张粘性堆叠项目卡（01-02 有「进入交互 Demo」，03 指向公开仓库）
    DemoPanels.tsx        首页两块迷你面板：滚进视口自动跑（客服一轮 / 检索链路），无按钮
    StarField.tsx / ClothEffect.tsx / ClickInk.tsx / FadeIn.tsx / AnimatedText.tsx / ContactButton.tsx
  shared/
    asset.ts              BASE_URL 资源解析 + 三个子页路径
    styles/tokens.css     共享设计令牌（颜色、面板、按钮、输入框、滚动条…）
    llm/providers.ts      7 家厂商的能力表（chat / embed / rerank）与默认模型
    llm/keys.ts           key 只写进本机 localStorage，不上传任何中间服务器
    llm/limiter.ts        限流：滑动 60s 窗口 + 会话总额 + 并发 1 + 单次输出上限
    llm/client.ts         chatStream（SSE）/ embedTexts / rerankDocs / verifyKey
    llm/useLlm.ts         key 与 provider 的 React 状态封装
    replay.ts             零配置回放：把真实日志里的回答按 token 节奏重放，并明确标注「回放」
    compute/stats.ts      浏览器内确定性统计：mean/std/sem/median/p95/OLS/Welch t/bootstrap CI
    ui/core.tsx, ui/llm-ui.tsx  面板、徽标、Sparkline、限流条、Key 条等共享组件
  rag/                    RAG 页：assets.ts / retrieve.ts（分词、BM25、dense、RRF、评测口径）/ AskPanel / EvalPanel
  yyhelp/                 YYHelp 交互页：App.tsx（登录门 → 商城 + 右侧助手）/ ShopPanel.tsx（商品、购物车、结算、订单）/ AssistantSidebar.tsx（对话 + 流程开关）/ shopCatalog.ts / engine.ts（规则路由、5 工具、幂等）/ assets.ts
    storeOrders.ts        商城订单（localStorage）与 fixture 合并：助手和商城读同一份数据
public/shop/index.html   旧链接兼容：/shop/ 自动跳到 /yyhelp/
public/tech/              AI / Agent 题材的程序化配图（scripts/make_ai_art.py 生成，本地渲染，无外部图床依赖）
scripts/make_ai_art.py    配图生成器：智能体星座 / 神经格栅 / 蜂群 / token 流 / 推理树 / 嵌入点云 / 电路 / 波形 / 同心环
public/data/{rag,yyhelp}/  两个子页的离线资产（真语料子集、量化向量、工具信封与对话回放）；yyhelp 政策库含运费/时效/拆封/换新/举证/次数六类条款
.github/workflows/deploy.yml  GitHub Pages 自动部署（BASE_PATH=/exp-wall/）
site/                    自有域名 agent-lyy.top 的发布配置：wrangler.toml（静态资源 Worker）+ deploy.mjs（一键构建并部署）
proxy/                   站内代理 Worker（llm.agent-lyy.top）：CORS 白名单、限流、额度记账、SSE 透传
```

## 本地开发

```bash
npm install
npm run dev      # http://localhost:5173（子页：/rag/ /yyhelp/）
npm run build    # 输出到 dist/
npm run preview  # 本地预览构建产物
```

### 学习工作台（`/learn/`）

`/learn/` **不是本仓库的 Vite/React 代码**，而是另一个项目（`D:\AI-Learning` 的 VitePress 站点）构建出来的静态快照，镜像进 `public/learn/`（678 个文件 / 约 66 MB）。它的主题、路由、暗色切换全是 VitePress 自己的，刻意没有跟着这个站的深色风格改 —— 那是一个独立工具，不是这个站的一个 section。

刷新方式：

```bash
cd D:\AI-Learning
npm run embed:learn          # 以 base=/learn/ 构建 → 改写裸 iframe → 镜像进 public/learn
cd D:\DSH_Plot\hero-program
npm run build                # 本仓库构建，把 public/learn 一起带进 dist
```

为什么是「把构建产物入库」而不是构建期引用那个目录：CI 跑在 GitHub 的 runner 上，那里既没有 `D:\AI-Learning`，也没装那套依赖，所以这份产物只能跟着仓库走。**代价是它会过期** —— 学习站内容一改就要重跑上面两条命令，否则 `/learn/` 里看到的还是上一次的版本。它是本站唯一一个「生成物入库」的例外，`dist/` 仍然不入库。

三个必须知道的构建细节（都写在 `D:\AI-Learning\scripts\embed-learn.mjs` 的注释里）：

1. **base 必须换**。VitePress 的 assets 前缀是构建期写死的；拿 `base: '/'` 的产物放进 `/learn/`，`/assets/*.js` 会指到站点根 → 白屏，而 HTML 本身照样返回 200。
2. **cleanUrls 关掉**。生成带 `.html` 的链接，不依赖 GitHub Pages / Cloudflare 静态资源对无后缀路径的重写（两者行为并不一致）。
3. **裸 iframe 要改写**。架构图用 `<iframe src="/fig/x.html">` 引，这是 Markdown 里的原始 HTML，VitePress **不会**给它加 base → 必须是脚本把 `"/fig/` 改成 `"/learn/fig/"`。漏掉的症状是「正文都在、图全白」。

验收（先 `npm run preview`）：

```bash
node D:\AI-Learning\scripts\_test-learn-embed.mjs
```

它起一个 headless Edge 真跑一遍：正文与侧栏是否挂载、架构图是否真的画出来（脚本会主动滚到图的位置——iframe 是 `loading="lazy"`，不滚它根本不加载）、助教是否降级成只读，以及**所有 ≥400 的网络响应数**。最后一条是重点：子路径部署的 bug 基本都以 404 的形式出现，而页面本身返回的仍然是 200。

**访问统计**：`/learn/` 的每一页会向 `POST https://llm.agent-lyy.top/api/visit` 打一个点（一次会话内同一页只打一次），读统计用
`node D:\AI-Learning\scripts\visits.mjs --token <口令>`。为什么自己做、能统计到什么、怎么部署，见 `proxy/README.md` §7。

**登录门禁**：`/learn/` 前面有一道登录页（VitePress 主题风格，只有部署到子路径的那一份生效，本地根路径版不拦）。
凭据以 sha256 形式写在 `D:\AI-Learning\docs\.vitepress\theme\components\AuthGate.vue` 里，明文不进产物。
⚠️ 这是**产品级**门禁不是安全边界 —— 正文已经写进静态 HTML，看源码能绕过；要真门禁得把校验放到 Cloudflare Worker 那一层。

## 部署

推送到 `main` 即自动构建并发布到 GitHub Pages（`actions/configure-pages` → `actions/upload-pages-artifact` → `actions/deploy-pages`），无需手动上传产物，也不需要提交 `dist/`。

构建时的资源前缀由环境变量 `BASE_PATH` 决定：`vite.config.ts` 里 `base: process.env.BASE_PATH || '/'`，CI 的 workflow 注入 `BASE_PATH=/<仓库名>/`，
本地开发与预览用默认的 `/`。用的是**绝对 base**（不是相对 `'./'`）——相对 base 会让 `/rag/` 这类子目录里的 HTML 把 assets 解析到
`/rag/assets/...` 从而 404。因此子页（`/rag/` 等）的静态资源能正确解析；换仓库名或搬到自定义域名都不用改代码。

### 两套发布目标（同一份源码）

| 目标 | 地址 | 怎么发 | 资源前缀 |
| --- | --- | --- | --- |
| GitHub Pages（仓库页） | https://lyy20.github.io/exp-wall/ | 推 `main` → Actions 自动构建部署 | `/exp-wall/` |
| 自有域名（Cloudflare Worker 静态资源） | https://agent-lyy.top/ | `node site/deploy.mjs` | `/` |

`site/` 是一个挂在自有域名上的 Worker：静态资源走 `[assets] directory = "../dist"`（`not_found_handling = "none"`，多入口站点不要 SPA 兜底），
脚本部分（`site/src/index.js`）只接管 `/api/llm/*`（`run_worker_first`），用 service binding 把请求**同源**转给 `expwall-llm`。
两条 `[[routes]]` 用 `custom_domain = true` 把 `agent-lyy.top` 与 `www.agent-lyy.top` 挂到 Cloudflare 账号上——DNS 记录与证书由 wrangler 自动创建，
和 `llm.agent-lyy.top` 同一个做法，因此不需要手动配 DNS，也不受影响于国内到 `*.github.io` 的可达性。

为什么模型接口要走同源：页面原本直接调第三个主机名 `llm.agent-lyy.top`，属于跨站请求，遇到隐私插件/网络拦截就只剩回放；
换成 `/api/llm/*` 后请求落在自己域名上，不依赖第二个域名的可达性，也不需要 CORS。转发时会把访客 IP 带过去（`CF-Connecting-IP` + `x-forwarded-for`），
否则所有访客会共用同一个限流桶；另外同源 GET 浏览器**不发** `Origin`，而代理是 fail-closed 的（没有 `Origin` 直接 403），
所以站点 Worker 只在 `Sec-Fetch-Site: same-origin / same-site` 时替浏览器补上 `Origin` —— 非浏览器客户端与第三方站点依旧 403。

`site/deploy.mjs` 一条命令完成发布：先在仓库根目录以 `BASE_PATH=""` + `VITE_PROXY_BASE_URL=same-origin` 构建，再在 `site/` 里 `npx wrangler deploy`。
`VITE_PROXY_BASE_URL=same-origin` 是给自有域名这份用的特例（见 `src/shared/llm/proxy.ts` 的 `envBase()`）：用页面自己的域名，apex 与 www 各自调自己的 `/api/llm/*`，不用把主机名写死进构建产物。
换域名或换代理地址只改 `site/wrangler.toml` 与 `deploy.mjs` 顶部的常量。CI 只管 GitHub Pages 那份（`BASE_PATH=/<仓库名>/`），`site/` 不参与 Actions。

> 注意代理站点的来源白名单是 fail-closed 的：新域名要在 `proxy/wrangler.toml` 的 `ALLOWED_ORIGINS` 里加一行再 `npx wrangler deploy`，否则页面能开、接口一律 403。

可选（当前没做，改的是仓库 secret，需要你自己决定）：让 CI 也顺手更新自有域名——加 `CLOUDFLARE_API_TOKEN`（Workers Scripts:Edit）与 `CLOUDFLARE_ACCOUNT_ID` 两个 secret，
再加一个 workflow 跑 `npm ci && BASE_PATH="" VITE_PROXY_BASE_URL=same-origin npm run build && npx wrangler deploy --config site/wrangler.toml`，
这样一次 `git push` 就同时更新 GitHub Pages 与 agent-lyy.top 两份产物。

## 说明

- 页面内所有配图均为本地程序化生成，不依赖外部图片服务。
- **API key 只存在于你自己浏览器的 localStorage**：填了 key 就是浏览器**直连厂商**（BYOK），页面不经过本站任何服务器，也不上传、不记录。
- 没填 key 时也不是回放：本站另部署了一个 Cloudflare Worker 作为**站内代理**（自有域名 `llm.agent-lyy.top`，密钥只在服务端，
  浏览器里没有 key），在额度内直接真答并逐字流式；额度只有一个口径：**每天最多花 ¥5**（按 token 用量折算成人民币记账，不限问答次数、不限每分钟次数、不分 IP）；用完会明确返回 429（`budget-day`）并提示你填自己的 key，第二天 08:00 北京时间恢复。
  选路优先级 = **自填 key 直连 > 站内代理 > 录制回放**，徽标永远如实写明当前是哪一条（站内代理 / 自填 key / 回放）。
- 站内代理覆盖三条通道：chat（DeepSeek）、embedding（`@cf/baai/bge-m3`，1024 维）、精排（`@cf/baai/bge-reranker-base`，
  有有效 `SILICONFLOW_API_KEY` 时优先用 SiliconFlow 的 bge-m3 / bge-reranker-v2-m3，失效才降级到 Workers AI，页面上照实显示真实模型名）。
- 站内还有一层浏览器内的自限流（默认每分钟 6 次 / 每次会话 60 次 / 单次输出 ≤512 token），服务端另有独立闸门，避免误触或脚本刷量。
- 零配置也能用：检索、统计、契约门禁、评测都在本地真跑 —— 不填 key、连站内代理都不通时，只有「生成回答」这一步退化成录制回放。
- 三页数据都来自项目自己产出的真实文件（Milvus 导出的 bge-m3 向量、评测 CSV、报告台账 SQLite、真实工具信封），凡未做/改口径的地方都在页面上写明。
