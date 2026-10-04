# 罗毅扬 · AI Agent 开发工程师 ｜ 个人作品集

在线预览 👉 **https://lyy20.github.io/exp-wall/**

一个深色主题的单页作品集（全屏 Hero、横向滚动图带、逐字渐显的自我介绍、Framer Motion 粘性堆叠项目卡，底衬 Three.js 粒子星空 + 布料式鼠标斥力 + 点击彩色墨水），
并在这一个域名、一个仓库里额外交付了 **3 个可交互的项目 Demo 页**：把三个真实项目里「不需要后端也能真跑」的部分搬进浏览器。

| 入口 | 地址 | 这页真跑什么 |
| --- | --- | --- |
| 作品集首页 | https://lyy20.github.io/exp-wall/ | 主视觉 + 4 张项目卡（每张卡都有「进入交互 Demo」跳转）+ 3 块迷你面板（点一下就能看到真算/真跑） |
| 科研实验分析助手 Agent | https://lyy20.github.io/exp-wall/eap/ | 8 工具四段式契约门禁、9 类错误语义、10 条真实 episode 序列 × 6 统计量与 Python numpy/scipy golden 逐项对比、Welch t 检验、报告台账与证据链 |
| YYHelp 电商智能客服 | https://lyy20.github.io/exp-wall/yyhelp/ | 13 条正则规则路由、5 个工具的校验/统一信封/只读登记/写操作确认与幂等重放、ReAct 终止条件、17 组真实对话回放 |
| 科研文献 RAG 问答 | https://lyy20.github.io/exp-wall/rag/ | 分词 → BM25 → int8 去量化内积 → RRF 融合的完整检索链路 + 20 题 Recall@5 / MRR 在浏览器内重算并与 Python 侧逐题对照 |

每页开头都写清了「**真跑什么 / 刻意没做什么**」，不把演示说成产品。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | React 18.3.1 + TypeScript 5.6 + Vite 5.4（多入口：`index.html` / `rag/` / `yyhelp/` / `eap/`） |
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
    ProjectsSection.tsx   4 张粘性堆叠项目卡（01-03 有「进入交互 Demo」，04 指向公开仓库）
    DemoPanels.tsx        首页三块迷你面板：真算统计 / 真跑客服一轮 / 真跑检索链路
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
  yyhelp/                 YYHelp 页：engine.ts（规则路由、5 工具、幂等、ReAct 终止）/ assets.ts / ChatPanel / IntentPanel / KbPanel
  eap/                    EAP 页：assets.ts / ToolsPanel（契约门禁）/ StatsPanel（与 golden 对比）/ WordingPanel（措辞检查器）/ AuditPanel（证据链）
public/tech/              程序化生成的科技配图（本地渲染，无外部图床依赖）
public/data/{rag,yyhelp,eap}/  三个子页的离线资产（真语料子集、量化向量、契约与台账导出）
.github/workflows/deploy.yml  GitHub Pages 自动部署
```

## 本地开发

```bash
npm install
npm run dev      # http://localhost:5173（子页：/rag/ /yyhelp/ /eap/）
npm run build    # 输出到 dist/
npm run preview  # 本地预览构建产物
```

## 部署

推送到 `main` 即自动构建并发布到 GitHub Pages（`actions/configure-pages` → `actions/upload-pages-artifact` → `actions/deploy-pages`），无需手动上传产物，也不需要提交 `dist/`。

NaN
因此子页（`/rag/` 等）的静态资源能正确解析；换仓库名或搬到自定义域名都不用改代码。

## 说明

- 页面内所有配图均为本地程序化生成，不依赖外部图片服务。
- **API key 只存在于你自己浏览器的 localStorage**，页面没有后端、不上传、不记录；所有模型调用都是浏览器直连厂商。
- 站内对真实调用做了限流（默认每分钟 6 次 / 每次会话 60 次 / 单次输出 ≤512 token），避免误触或脚本刷量。
- 零配置也能用：检索、统计、契约门禁、评测都在本地真跑，只有「生成回答」这一步需要 key。
- 没填 key 时也不是回放：本站另部署了一个 Cloudflare Worker 作为**站内代理**（自有域名 `llm.agent-lyy.top`，密钥只在服务端，
  浏览器里没有 key），在额度内直接真答并逐字流式；额度按 IP 3 次/分钟、30 次/天、全站 200 次/天，用完会明确返回 429 并提示你填自己的 key。
  没配代理或额度用尽时才回落到录制回放，徽标会如实写明当前通道（站内代理 / 自填 key / 回放）。
- 三页数据都来自项目自己产出的真实文件（Milvus 导出的 bge-m3 向量、评测 CSV、报告台账 SQLite、真实工具信封），凡未做/改口径的地方都在页面上写明。
