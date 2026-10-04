# exp-wall 站内 LLM 代理（P5-lite）

访客**不填自己的 key** 也能真跑「生成」这一步：浏览器 → 这个 Cloudflare Worker → DeepSeek，
密钥只存在 Worker 的 secret 里，永不进前端产物。

```
浏览器（GitHub Pages 静态站）
  ├─ ① 有自填 key ──────────────► 直连服务商（BYOK，key 只在本机 localStorage）
  ├─ ② 没有 key、有站内代理 ────► Cloudflare Worker（本站的 key + 限流 + 预算）──► DeepSeek
  └─ ③ 都没有 ─────────────────► 回放项目真实日志（明确标注「回放」）
```

为什么必须是**独立 Worker**：站点托管在 GitHub Pages 上，上传的是纯静态产物，
挂不了 Pages Functions / 任何服务端代码。Workers 免费额度足够这个站点的量。

**当前处于哪种模式，页面上永远显式写出**（徽标三态：`实时` / `站内代理` / `回放`），
额度用完时也不会偷偷退回回放 —— 徽标照旧写着「站内代理」，下一次提问真的发出去、
拿服务端 429，再把「站内额度用完，请填自己的 key」写在面板上。

---

## 1. 接口契约

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/llm/status` | 能力（caps）、模型白名单、额度上下限、当前计数与剩余、usage 记账、服务器时间 |
| POST | `/api/llm/chat` | 转发 `/chat/completions`，**SSE 逐字透传，绝不缓冲** |
| POST | `/api/llm/embeddings` | `BAAI/bge-m3`（SiliconFlow）或 `@cf/baai/bge-m3`（Workers AI 兜底） |
| POST | `/api/llm/rerank` | `BAAI/bge-reranker-v2-m3`（SiliconFlow）或 `@cf/baai/bge-reranker-base`（Workers AI 兜底） |
| OPTIONS | 以上任意 | CORS 预检，`Access-Control-Max-Age: 3600` |

- 服务端**强制**注入 `stream: true` 与 `stream_options.include_usage: true`，
  并把 `max_tokens` 夹到上限（默认 512）；客户端传什么都改不了这两条。
- 每次成功响应带额度响应头：`X-Proxy-Remaining-Minute` / `-Day` / `-Global`
  （已写进 `Access-Control-Expose-Headers`，否则浏览器里读不到 —— 见 §4 的坑）。
- 失败一律是结构化 JSON：`{ "error": { "code": "...", "message": "..." } }`，
  `code` 用于前端把 429 映射成「站内额度用完」而不是「网络错误」。

前端选路在 `src/shared/llm/client.ts`（`resolveChatTargetOrNull` / `resolveEmbedTargetOrNull`），
代理实现在 `src/shared/llm/proxy.ts`（与 BYOK 同签名的 `chatViaProxy` / `embedViaProxy` / `rerankViaProxy`）。
代理地址来源按顺序：构建期 `VITE_PROXY_BASE_URL` → URL 上的 `?proxy=…` → `localStorage`；
三处都没有时 `proxyConfigured() === false`，站点行为与没有代理时**完全一致**。

## 2. 闸门（默认值，可用 `LIMITS_JSON` 覆盖）

| 项 | 默认 | 说明 |
| --- | --- | --- |
| per-IP 每分钟 | 3 | 按**分钟桶**计数（`Math.floor(now/60000)`），桶一换就重置 |
| per-IP 每天 | 30 | UTC 日 |
| 全站每天 | 200 | 兜底预算：超了全站拒绝（KV 计数非原子，并发下靠这道闸门兜底） |
| 单次输出 | ≤512 token | 服务端夹取 |
| 单次输入 | ≤6000 字符/条、≤12 条消息、总计 ≤12000 字符 | 超长直接 400 |
| 模型 | `deepseek-chat` / `deepseek-reasoner`（embed / rerank 各自白名单） | 不在白名单直接 400 |

**额度按通道分作用域**：`scope 'c'`（chat）是用户可见的那一份，`/status` 与响应头报的都是它；
`scope 'a'`（embedding / rerank）额度是 chat 的 6 倍（`AUX_FACTOR`，见 `proxy/src/limits.ts`），
只防脚本刷接口，不抢用户提问的额度 —— 否则一次 RAG 提问 = 1 次 chat + 1 次 embedding + 1 次 rerank，
用户问一句就把整分钟额度吃光。

超出限额返回 `429` + `Retry-After`，并带 `error.code`：
`per-minute` / `per-ip-day` / `global-day`（判据在 `proxy/src/limits.ts` 的 `verdict()`）。

## 3. fail-closed 清单（宁可不服务，也不静默降级）

- 没有 `Origin` 或不在白名单 → **403**（`origin-not-allowed`）；白名单只放行 `ALLOWED_ORIGINS` 里列出的站点 + 本机 `http://localhost:*` 与 `http://127.0.0.1:*`。
  当前线上是三个来源：`https://lyy20.github.io`（GitHub Pages 那份）、`https://agent-lyy.top` 与 `https://www.agent-lyy.top`（自有域名根路径那份，站点由 `site/` 里的静态资源 Worker 提供）。加新域名 = 改 `proxy/wrangler.toml` 的 `ALLOWED_ORIGINS` 再 `npx wrangler deploy`。
  自有域名那份页面调的是**同源**的 `https://agent-lyy.top/api/llm/*`，由 `site/src/index.js` 用 service binding 转到本 Worker（请求头里补上访客 IP 与 `Origin`，`Origin` 只在本站页面发起时补，见 `site/src/index.js` 的注释）。
- `RATE_KV` 没绑 → **503 `config-missing-kv`**（没有计数就不放行，避免被刷爆）。
- `DEEPSEEK_API_KEY` 没配 → **503 `config-missing-key`**。
- embedding / rerank 的后端按模型名路由：`@cf/` 开头只走 Workers AI（没绑 `[ai]` → **503 `config-missing-ai`**）；
  其它走 SiliconFlow，但**上游 401/403（key 失效）且绑了 Workers AI 时会自动降级**，响应体里写真实模型名
  （前端因此显示成「站内代理 · @cf/baai/bge-m3」，不冒充 SiliconFlow）。两边都不可用时才报
  **502 `upstream-<status>`**，且 `caps` 里不会出现 `embed` / `rerank`，前端自动只用 chat。
- 上游连不上 → **502 `upstream-unreachable`**；上游非 2xx → **502 `upstream-<status>`** 并回传上游原文前 400 字。
- 任何未预料的异常（KV 写配额耗尽、账本解析失败、上游 fetch 抛错）→ **503 `proxy-degraded`**（人话 + 原始错误前 200 字），
  而不是裸 500「Internal Server Error」—— 包装在 `src/index.ts` 的 `export default { fetch }` 里。

## 4. 本地验收（就这三条命令，缺一不可）

```bash
# ① Worker 单机测试：真 Worker 代码 + 假上游 + 假 Workers AI + 内存 KV，56 条断言，不用联网、不用 key
node proxy/test/harness.mjs test

# ② 浏览器点击级验收：起两个后台进程，然后用真 Chrome 点「提问」
node proxy/test/harness.mjs serve 8822      # mock 代理（测试默认用 8801 端口，互不打扰）
npm run dev -- --port 5177 --strictPort     # 真前端（多入口站点，/rag/ 是 RAG 页）
node proxy/test/ui-accept.mjs               # 38 条断言，exit 0 才算过

# ③ 反向验收：**没有代理**时必须老实退化成「回放」（现在的线上就是这个状态）
npm run build
npx vite preview --port 5188 --strictPort   # 服务 dist，与 CI 产物同一份
node proxy/test/replay-fallback.mjs         # 11 条断言，exit 0 才算过
```

① 测的是 Worker 本身（CORS、限流、预算、白名单、SSE 透传、usage 记账、额度响应头）；
② 测的是**用户真能看见的东西**：无 key 访客的徽标是「站内代理」、逐字流式（采样到递增的中间态 + 流式光标）、
额度从 3 掉到 2 且页面上自己更新、连问 4 次第 4 次拿到 429 且提示「想继续问就填自己的 key」、
另外两个 demo 页的徽标同样明写「站内代理」、页面无未捕获异常。

③ 测的是**反向**：没配 `VITE_PROXY_BASE_URL` 时（= 你还没配 Worker 地址时的线上状态）页面必须老实退化成
「回放」——徽标是「回放」且不出现「站内代理」徽标、不出现「站内额度：」、点「提问」按真实节奏逐字回放录制答案
（采样到递增的中间态 + 流式光标）、明写「零配置：按真实节奏回放录制的模型输出…」、页面无未捕获异常。
这条是 P5 改动的护栏：`ModeBadge` 的 `mode` 变必填、`AskPanel` 加了 streaming 分支之后，
「没有代理」的路径必须和改动前一模一样。

三条命令里的坑（踩过，别再踩）：

- **限流按分钟分桶**：整套点击若跨过整分钟边界，第 4 次会落进新桶而被正常放行 → 断言假失败
  （指纹：服务端 `minute=3` 而 `day=4`，即 3 次在旧桶 + 1 次在新桶）。
  `ui-accept.mjs` 开跑前会 `alignMinuteStart()` 对齐到分钟桶开头，结束时再显式断言「整轮没有跨桶」。
- **自定义响应头必须 expose**：少了 `Access-Control-Expose-Headers`，浏览器里读不到 `X-Proxy-Remaining-*`，
  页面上的额度永远停在进页面那一次 `/status` 的快照。Node 里的 harness 不受 CORS 限制、**测不出来**，
  这条是浏览器验收抓出来的（见 `proxy/src/guards.ts` 的 `EXPOSED_HEADERS`）。
- **SSE 不能缓冲**：任何缓冲都会把逐字流式变成「等半天一次吐出」，验收会断言「≥3 个长度递增的中间态」。
- **额度缓存别存快照**：`proxy/src/proxy.ts` 的 cache 是模块级可变对象，`applyRemaining` 必须**原地改**；
  一旦改成 `cache = { ...cache }` 换对象，React state 里存下的旧引用会永久停在初始额度（页面额度不再掉、
  额度耗尽警示永不出现）。同理 UI 侧要靠 `useTicker()` 重渲染（`src/shared/ui/llm-ui.tsx`）。
- **Node 19+ 的 `server.close()` 会掐掉 undici 复用的 keep-alive 连接** → harness 每组测试换端口 + `Connection: close`。

## 5. 部署 runbook（你只需要做这一节，约 15 分钟）

前置：一个 Cloudflare 账号（免费版即可）、一个充值过的 DeepSeek API key。

```bash
cd proxy
npm install                                # 只装 wrangler（devDependency）
npx wrangler login                         # 浏览器里点授权（**这一步只有你能做**）

npx wrangler kv namespace create RATE_KV   # 输出里有 id = "..."，填回 wrangler.toml 的 id 字段
npx wrangler secret put DEEPSEEK_API_KEY   # 粘贴你的 key（**只有你能做**；secret 不回显、不进 git）
# 可选：想开放 embedding / 精排，再多配一个
npx wrangler secret put SILICONFLOW_API_KEY

npx wrangler deploy                        # 输出形如 https://expwall-llm.<你的账号>.workers.dev
```

然后把地址交给前端（**不要把地址硬编码进代码**）：

1. GitHub 仓库 → Settings → Secrets and variables → Actions → **Variables** → 新建
   `VITE_PROXY_BASE_URL` = 你的 `https://expwall-llm.<你的账号>.workers.dev`（末尾不要带斜杠）。
2. 重新跑一次部署（推一次 commit，或在 Actions 里 re-run）：`.github/workflows/deploy.yml` 会把它作为
   构建期变量传进去，前端由此判定「有站内代理」。没配这个 variable 时取到空串 → 站点行为与纯静态站完全一致
   （回放），不会报错，只是没有站内代理。

> 线上状态（2026-10-04）：Worker 已挂在自有域名 **https://llm.agent-lyy.top**（`*.workers.dev` 在国内被按 SNI 阻断，
> 同一个 Cloudflare IP 换成自有域名就通），GitHub 变量 `VITE_PROXY_BASE_URL` 已配，线上三页徽标均为「站内代理」。
> 验收 = `LIVE=1 ACCEPT_URL=https://lyy20.github.io/exp-wall/rag/ STATUS_URL=https://llm.agent-lyy.top/api/llm/status ORIGIN=https://lyy20.github.io node proxy/test/ui-accept.mjs`
> → **34 通过 / 0 失败**（无 key 访客真跑：逐字流式、额度递减、连点 4 次第 4 次 429、三页徽标一致）。
>
> 通道实测（2026-10-04，站长重签有效 SiliconFlow key 之后）：`GET /api/llm/status` → caps `["chat","embed","rerank"]`、
> `backends.embed / rerank = ["siliconflow","workers-ai"]`；
> `POST /api/llm/embeddings` → **200**（SiliconFlow `BAAI/bge-m3`，1024 维）；
> `POST /api/llm/rerank` → **200**（SiliconFlow `BAAI/bge-reranker-v2-m3`，响应体带 `id` 与 `meta.billed_units`）；
> `POST /api/llm/chat` → **200**（SSE 逐字，`deepseek-flash`）。
> 线上 /rag/ 四格实证：查询向量「真调 API（站内代理）· BAAI/bge-m3」、精排「已启用 · 站内代理 · BAAI/bge-reranker-v2-m3」，
> 截图 `D:/DSH_Plot/output/hero-shots/live-rag-siliconflow.png`。
> key 若再次失效（上游 401/403），同一份代码会自动掉到 Workers AI（`@cf/baai/bge-m3` / `@cf/baai/bge-reranker-base`）并在响应体与页面上照实显示，
> 所以「SiliconFlow 报销了」不会让通道变 502 —— 这条降级路径由 harness 8c/8d 两组断言守着。
> 三个通道都不吃彼此的额度：embedding / rerank 记在 `scope 'a'` 那一份上。

部署后自查（三条，缺一不可）：

```bash
# 1) 白名单来源：期望 200，body 里有 caps / models / limits / remaining
curl -i "https://llm.agent-lyy.top/api/llm/status" -H "Origin: https://lyy20.github.io"
# 2) 不带 Origin：期望 403（fail-closed）
curl -i "https://expwall-llm.<你的账号>.workers.dev/api/llm/status"
# 3) 换一个不在白名单的 Origin：期望 403
curl -i "https://expwall-llm.<你的账号>.workers.dev/api/llm/status" -H "Origin: https://example.com"
```

浏览器里打开线上 `/rag/`：徽标应显示「站内代理」（accent 色），KeyBar 里写「站内额度：本分钟剩 3/3」；
点一次「提问」应逐字出字、额度掉到 2；连点 4 次，第 4 次应拿到 429 与「想继续问就填自己的 key」。
想临时换一个代理地址做对照，可以直接加参数：`/rag/?proxy=http://127.0.0.1:8822`（只影响当前浏览器）。

## 6. 成本与限制

- Worker + KV 都在免费额度内（每天 200 次 chat 的封顶远低于免费额度）。
- 真正花钱的只有 LLM 充值：按输出 ≤512 token、每天 ≤200 次封顶，**每天不到 ¥1**；充 ¥10–20 能撑很久。
- **`*.workers.dev` 在国内被按域名（SNI）阻断**：实测同一任播 IP `104.16.124.96`，SNI 用 `www.cloudflare.com` 返回 200、
  换成 `expwall-llm.<账号>.workers.dev` 直接被 RST（`curl: (35) Recv failure: Connection was reset`），手机流量同样不通。
  解法 = 自有域名挂 Custom Domain（本项目用 `llm.agent-lyy.top`，zone 在同一个 Cloudflare 账号里）。面试现场最稳的仍然是**自填 key 直连**。
- KV 的 `get` / `put` 没有原子自增，并发下计数是近似的 —— 所以真正的兜底是全局日预算闸门。
- **KV 免费档每天 1000 次写**：原来一次成功 chat 写 6 个键（minute/day/global + usage/p:/tokens）→ 真实日天花板约 **166 次**，
  比站点文案写的 200 还低。现已改成**日账本**（`L:<scope>:<utcDay>` 一个 JSON 值）：
  `consume()` = 1 get + 1 put（分钟桶 + 当日 per-IP + 全局计数都在账本里），`addUsage()` = 1 get + 1 put，
  合起来**一次 chat 只写 2 个键** → 1000 ÷ 2 > 200，天花板回到全局闸门本身。
  副作用两条：① 计数仍是读—改—写，KV 没有原子自增，并发下依旧是近似值（真正的兜底还是全局日预算）；
  ② 换键名的那一天，旧的 `d:` / `g:` / `u:` / `t:` 键作废 → 当日计数会从 0 重新开始一次。
  另外 `export default { fetch }` 现在有外层 try/catch，KV 故障时回 503 `proxy-degraded` 而不是裸 500。
- **embedding / 精排有两条后端**：SiliconFlow（`SILICONFLOW_API_KEY` 有效时优先：`BAAI/bge-m3` / `BAAI/bge-reranker-v2-m3`）
  与 Workers AI（`[ai]` 绑定，免费档 10000 neurons/天，不需要额外 secret：`@cf/baai/bge-m3` / `@cf/baai/bge-reranker-base`）。
  线上当前实际跑的是 **SiliconFlow**（2026-10-04 站长重签 key 后实测，见上一节的通道实测）：`BAAI/bge-m3` 出 1024 维查询向量、
  `BAAI/bge-reranker-v2-m3` 出精排分，页面四格照实显示真实模型名；SiliconFlow 若回 401/403 会自动降级到 Workers AI，
  所以「key 过期」只会让页面上的模型名换成 `@cf/...`，不会让通道报错。换 key：`npx wrangler secret put SILICONFLOW_API_KEY`（代码不用改）。
  前端仍保留两条降级（离线预计算向量 / 按 RRF 取前 5）作为「两边都不可用」时的最后一道保险。
