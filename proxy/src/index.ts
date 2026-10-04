// exp-wall 站内 LLM 代理（Cloudflare Worker）
// 目的：访客不填自己的 key 也能真跑「生成」这一步；密钥只存在服务端 secret 里，永不进前端。
// 路由：GET /api/llm/status · POST /api/llm/chat · POST /api/llm/embeddings · POST /api/llm/rerank
// 原则：fail closed —— 没绑 KV、没配 key、模型不在白名单、超长、超频、超预算，一律明确拒绝并说清原因。

import {
  addUsage,
  auxLimits,
  consume,
  limitsFrom,
  peek,
  readUsage,
  type KVLike,
  type Limits,
} from './limits.ts';
import {
  corsHeaders,
  fail,
  jsonResponse,
  originAllowed,
  parseOrigins,
  validateChat,
  validateEmbeddings,
  validateRerank,
} from './guards.ts';

/** Workers AI 绑定（wrangler.toml 里的 [ai] binding = "AI"）；没绑就是 undefined，走 SiliconFlow 或明确拒绝。 */
export interface AiBinding {
  run(model: string, inputs: unknown): Promise<unknown>;
}

export interface Env {
  RATE_KV?: KVLike;
  DEEPSEEK_API_KEY?: string;
  SILICONFLOW_API_KEY?: string;
  AI?: AiBinding;
  UPSTREAM_BASE?: string;
  SILICONFLOW_BASE?: string;
  ALLOWED_ORIGINS?: string;
  LIMITS_JSON?: string;
}

export interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}

const CHAT_MODELS = ['deepseek-chat', 'deepseek-reasoner'];
// embedding / rerank 有两条后端：SiliconFlow（需要有效 key）与 Workers AI（同一个 Worker 里的免费兜底）。
// 两边的 bge-m3 是同一套权重的不同调用方式，向量都是 1024 维；精排兜底用 Workers AI 的 bge-reranker-base
// （比 bge-reranker-v2-m3 小一号，所以响应体里会回真实模型名，前端照实显示）。
const SF_EMBED_MODEL = 'BAAI/bge-m3';
const SF_RERANK_MODEL = 'BAAI/bge-reranker-v2-m3';
const AI_EMBED_MODEL = '@cf/baai/bge-m3';
const AI_RERANK_MODEL = '@cf/baai/bge-reranker-base';
const EMBED_MODELS = [SF_EMBED_MODEL, AI_EMBED_MODEL];
const RERANK_MODELS = [SF_RERANK_MODEL, AI_RERANK_MODEL];
const DEFAULT_UPSTREAM = 'https://api.deepseek.com';
const DEFAULT_SILICONFLOW = 'https://api.siliconflow.cn/v1';

/** 当前真的能用的 embedding 模型清单：SiliconFlow 有 key 才列它，AI 绑定在就列兜底。 */
function embedModelsOf(env: Env): string[] {
  const out: string[] = [];
  if (env.SILICONFLOW_API_KEY) out.push(SF_EMBED_MODEL);
  if (env.AI) out.push(AI_EMBED_MODEL);
  return out;
}

function rerankModelsOf(env: Env): string[] {
  const out: string[] = [];
  if (env.SILICONFLOW_API_KEY) out.push(SF_RERANK_MODEL);
  if (env.AI) out.push(AI_RERANK_MODEL);
  return out;
}

function capsOf(env: Env): string[] {
  const caps = ['chat'];
  if (embedModelsOf(env).length) caps.push('embed');
  if (rerankModelsOf(env).length) caps.push('rerank');
  return caps;
}

function backendsOf(env: Env) {
  return {
    chat: ['deepseek'],
    embed: [env.SILICONFLOW_API_KEY ? 'siliconflow' : null, env.AI ? 'workers-ai' : null].filter(Boolean),
    rerank: [env.SILICONFLOW_API_KEY ? 'siliconflow' : null, env.AI ? 'workers-ai' : null].filter(Boolean),
  };
}

function clientIp(req: Request): string {
  const direct = req.headers.get('CF-Connecting-IP');
  if (direct) return direct;
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return 'unknown';
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path;
}

interface Usage {
  promptTokens: number;
  completionTokens: number;
}

/** 边透传边从 SSE 里抠 usage；流结束时记账。透传不做缓冲，逐字流式不会被吞掉。 */
function accountUsage(
  body: ReadableStream<Uint8Array>,
  env: Env,
  ctx: Ctx,
  now: number,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const usage: Usage = { promptTokens: 0, completionTokens: 0 };
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.trim();
        if (line.slice(0, 5) !== 'data:') continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload) as { usage?: { prompt_tokens?: number; completion_tokens?: number } };
          if (parsed.usage) {
            usage.promptTokens = parsed.usage.prompt_tokens || usage.promptTokens;
            usage.completionTokens = parsed.usage.completion_tokens || usage.completionTokens;
          }
        } catch {
          /* 心跳或半行，忽略 */
        }
      }
    },
    flush() {
      if (env.RATE_KV && (usage.promptTokens || usage.completionTokens)) {
        ctx.waitUntil(addUsage(env.RATE_KV, usage, now));
      }
    },
  });
  return body.pipeThrough(transform);
}

function sseHeaders(origin: string, remaining: { minute: number; day: number; global: number }): Record<string, string> {
  return Object.assign(
    {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'X-Proxy-Remaining-Minute': String(Math.max(0, remaining.minute)),
      'X-Proxy-Remaining-Day': String(Math.max(0, remaining.day)),
      'X-Proxy-Remaining-Global': String(Math.max(0, remaining.global)),
    },
    corsHeaders(origin),
  );
}

function remainingOf(limits: Limits, counters: { minute: number; day: number; global: number }) {
  return {
    minute: Math.max(0, limits.perMinute - counters.minute),
    day: Math.max(0, limits.perDay - counters.day),
    global: Math.max(0, limits.globalPerDay - counters.global),
  };
}

/**
 * embedding / rerank 走的是 aux 额度（不与用户提问抢额度），但响应头依然报 **chat 那份** 剩余额度：
 * 前端只认这一份额度，否则一次提问里的三个请求会互相把界面上的数字改乱。
 */
async function chatRemainingHeaders(env: Env, limits: Limits, ip: string, now: number): Promise<Record<string, string>> {
  if (!env.RATE_KV) return {};
  const counters = await peek(env.RATE_KV, ip, now, 'c');
  const r = remainingOf(limits, counters);
  return {
    'X-Proxy-Remaining-Minute': String(r.minute),
    'X-Proxy-Remaining-Day': String(r.day),
    'X-Proxy-Remaining-Global': String(r.global),
  };
}

async function handleStatus(env: Env, origin: string, limits: Limits, ip: string, now: number): Promise<Response> {
  const kv = env.RATE_KV;
  const caps = capsOf(env);
  if (!kv) {
    return fail(503, 'config-missing-kv', '服务端没有绑定 RATE_KV（限流/预算计数用的 KV 命名空间），按 fail-closed 拒绝服务。', origin);
  }
  if (!env.DEEPSEEK_API_KEY) {
    return fail(503, 'config-missing-key', '服务端没有配置 DEEPSEEK_API_KEY。', origin);
  }
  // /status 报的是 chat 那份「用户可见」的额度（aux 通道另算一份，见 limits.ts 的说明）
  const counters = await peek(kv, ip, now, 'c');
  const usage = await readUsage(kv, now);
  return jsonResponse(
    {
      ok: true,
      caps,
      models: CHAT_MODELS,
      defaultModel: CHAT_MODELS[0],
      embedModels: embedModelsOf(env),
      rerankModels: rerankModelsOf(env),
      backends: backendsOf(env),
      limits,
      counters,
      remaining: remainingOf(limits, counters),
      usage,
      serverTime: new Date(now).toISOString(),
      note: '服务端 key + 每 IP 限流 + 每日预算闸门；超限会明确返回 429，前端会回落到回放或提示填自己的 key。',
    },
    200,
    origin,
  );
}

async function handleChat(req: Request, env: Env, ctx: Ctx, origin: string, limits: Limits, ip: string, now: number): Promise<Response> {
  const body = await req.json().catch(() => null);
  const checked = validateChat(body, limits, CHAT_MODELS);
  if (!checked.ok) return fail(400, 'bad-request', checked.message, origin);
  if (!env.RATE_KV) return fail(503, 'config-missing-kv', '服务端没有绑定 RATE_KV。', origin);
  if (!env.DEEPSEEK_API_KEY) return fail(503, 'config-missing-key', '服务端没有配置 DEEPSEEK_API_KEY。', origin);

  const decision = await consume(env.RATE_KV, ip, limits, now, 'c');
  if (!decision.ok) {
    return fail(429, decision.code || 'rate-limited', decision.message, origin, {
      retryAfterMs: decision.retryAfterMs,
      counters: decision.counters,
    });
  }

  const payload = {
    model: checked.payload.model,
    messages: checked.payload.messages,
    temperature: checked.payload.temperature,
    max_tokens: checked.payload.maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };

  let upstream: Response;
  try {
    upstream = await fetch(joinUrl(env.UPSTREAM_BASE || DEFAULT_UPSTREAM, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + env.DEEPSEEK_API_KEY,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return fail(502, 'upstream-unreachable', '连接上游失败：' + String(err), origin);
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    return fail(
      502,
      'upstream-' + upstream.status,
      '上游返回 HTTP ' + upstream.status + ' · ' + detail.slice(0, 400),
      origin,
    );
  }

  return new Response(accountUsage(upstream.body, env, ctx, now), {
    status: 200,
    headers: sseHeaders(origin, remainingOf(limits, decision.counters)),
  });
}

/**
 * Workers AI 兜底（SiliconFlow key 缺失或无效时的第二条路，不需要额外 secret）。
 * 把 bge-m3 的返回归一成 OpenAI /embeddings 的形状：前端只认 { data: [{ index, embedding }] }。
 * 响应体里写真实 model 名，前端照实显示成「站内代理 · @cf/baai/bge-m3」，不冒充 SiliconFlow。
 */
async function embedViaWorkersAi(env: Env, input: string[]): Promise<string> {
  const out = (await env.AI!.run(AI_EMBED_MODEL, { text: input })) as { data?: number[][] } | null;
  const rows = out && Array.isArray(out.data) ? out.data : [];
  if (!rows.length) throw new Error('Workers AI 没有返回向量');
  return JSON.stringify({
    object: 'list',
    provider: 'workers-ai',
    model: AI_EMBED_MODEL,
    data: rows.map((embedding, index) => ({ object: 'embedding', index, embedding })),
  });
}

/** 同上：把 bge-reranker 归一成 { results: [{ index, relevance_score }] }（按分降序，前端按顺序取 index）。 */
async function rerankViaWorkersAi(env: Env, query: string, documents: string[], topN: number): Promise<string> {
  const contexts = documents.map((text) => ({ text }));
  const out = (await env.AI!.run(AI_RERANK_MODEL, { query, contexts })) as { response?: { id?: number; score?: number }[] } | null;
  const rows = out && Array.isArray(out.response) ? out.response : [];
  if (!rows.length) throw new Error('Workers AI 没有返回排序结果');
  const n = Math.max(1, Math.min(topN || rows.length, rows.length));
  const results = rows
    .map((r, i) => ({ index: typeof r.id === 'number' ? r.id : i, relevance_score: typeof r.score === 'number' ? r.score : 0 }))
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, n);
  return JSON.stringify({ provider: 'workers-ai', model: AI_RERANK_MODEL, results });
}

async function handleEmbeddings(req: Request, env: Env, origin: string, limits: Limits, ip: string, now: number): Promise<Response> {
  const body = await req.json().catch(() => null);
  const checked = validateEmbeddings(body, limits, EMBED_MODELS);
  if (!checked.ok) return fail(400, 'bad-request', checked.message, origin);
  if (!env.RATE_KV) return fail(503, 'config-missing-kv', '服务端没有绑定 RATE_KV。', origin);
  const model = checked.payload.model;
  const wantAi = model.slice(0, 4) === '@cf/';
  if (wantAi && !env.AI) {
    return fail(503, 'config-missing-ai', '服务端没有绑定 Workers AI（[ai] binding = "AI"），用不了 ' + model + '。', origin);
  }
  if (!wantAi && !env.SILICONFLOW_API_KEY) {
    return fail(503, 'config-missing-key', '服务端没有配置 SILICONFLOW_API_KEY；可以改用 @cf/ 开头的 Workers AI 模型。', origin);
  }
  // aux 额度：一次提问要发 embedding + rerank + chat 三个请求，若共用一份计数，用户问一句就吃光整分钟额度
  const decision = await consume(env.RATE_KV, ip, auxLimits(limits), now, 'a');
  if (!decision.ok) {
    return fail(429, decision.code || 'rate-limited', decision.message, origin, { retryAfterMs: decision.retryAfterMs, counters: decision.counters });
  }
  const chatHeaders = await chatRemainingHeaders(env, limits, ip, now);
  const okHeaders = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, chatHeaders, corsHeaders(origin));

  if (wantAi) {
    try {
      return new Response(await embedViaWorkersAi(env, checked.payload.input), { status: 200, headers: okHeaders });
    } catch (err) {
      return fail(502, 'workers-ai-failed', 'Workers AI embedding 调用失败：' + String(err), origin);
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(joinUrl(env.SILICONFLOW_BASE || DEFAULT_SILICONFLOW, '/embeddings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.SILICONFLOW_API_KEY },
      body: JSON.stringify({ model, input: checked.payload.input }),
    });
  } catch (err) {
    return fail(502, 'upstream-unreachable', '连接上游失败：' + String(err), origin);
  }
  const text = await upstream.text();
  if (!upstream.ok) {
    // key 无效（401/403）时自动降级到 Workers AI：宁可用小一号的兜底模型，也别让访客的提问卡在第一步。
    if (env.AI && (upstream.status === 401 || upstream.status === 403)) {
      try {
        return new Response(await embedViaWorkersAi(env, checked.payload.input), { status: 200, headers: okHeaders });
      } catch (err) {
        return fail(502, 'workers-ai-failed', 'SiliconFlow 返回 ' + upstream.status + '（key 无效），Workers AI 兜底也失败：' + String(err), origin);
      }
    }
    return fail(502, 'upstream-' + upstream.status, '上游返回 HTTP ' + upstream.status + ' · ' + text.slice(0, 400), origin);
  }
  return new Response(text, { status: 200, headers: okHeaders });
}

async function handleRerank(req: Request, env: Env, origin: string, limits: Limits, ip: string, now: number): Promise<Response> {
  const body = await req.json().catch(() => null);
  const checked = validateRerank(body, limits, RERANK_MODELS);
  if (!checked.ok) return fail(400, 'bad-request', checked.message, origin);
  if (!env.RATE_KV) return fail(503, 'config-missing-kv', '服务端没有绑定 RATE_KV。', origin);
  const model = checked.payload.model;
  const wantAi = model.slice(0, 4) === '@cf/';
  if (wantAi && !env.AI) {
    return fail(503, 'config-missing-ai', '服务端没有绑定 Workers AI（[ai] binding = "AI"），用不了 ' + model + '。', origin);
  }
  if (!wantAi && !env.SILICONFLOW_API_KEY) {
    return fail(503, 'config-missing-key', '服务端没有配置 SILICONFLOW_API_KEY；可以改用 @cf/ 开头的 Workers AI 模型。', origin);
  }
  const decision = await consume(env.RATE_KV, ip, auxLimits(limits), now, 'a');
  if (!decision.ok) {
    return fail(429, decision.code || 'rate-limited', decision.message, origin, { retryAfterMs: decision.retryAfterMs, counters: decision.counters });
  }
  const chatHeaders = await chatRemainingHeaders(env, limits, ip, now);
  const okHeaders = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, chatHeaders, corsHeaders(origin));

  if (wantAi) {
    try {
      return new Response(await rerankViaWorkersAi(env, checked.payload.query, checked.payload.documents, checked.payload.topN), { status: 200, headers: okHeaders });
    } catch (err) {
      return fail(502, 'workers-ai-failed', 'Workers AI 精排调用失败：' + String(err), origin);
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(joinUrl(env.SILICONFLOW_BASE || DEFAULT_SILICONFLOW, '/rerank'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.SILICONFLOW_API_KEY },
      body: JSON.stringify({ model, query: checked.payload.query, documents: checked.payload.documents, top_n: checked.payload.topN }),
    });
  } catch (err) {
    return fail(502, 'upstream-unreachable', '连接上游失败：' + String(err), origin);
  }
  const text = await upstream.text();
  if (!upstream.ok) {
    if (env.AI && (upstream.status === 401 || upstream.status === 403)) {
      try {
        return new Response(await rerankViaWorkersAi(env, checked.payload.query, checked.payload.documents, checked.payload.topN), { status: 200, headers: okHeaders });
      } catch (err) {
        return fail(502, 'workers-ai-failed', 'SiliconFlow 返回 ' + upstream.status + '（key 无效），Workers AI 兜底也失败：' + String(err), origin);
      }
    }
    return fail(502, 'upstream-' + upstream.status, '上游返回 HTTP ' + upstream.status + ' · ' + text.slice(0, 400), origin);
  }
  return new Response(text, { status: 200, headers: okHeaders });
}

async function route(req: Request, env: Env, ctx: Ctx): Promise<Response> {
  const now = Date.now();
    const url = new URL(req.url);
    const origin = req.headers.get('origin');
    const allowed = parseOrigins(env.ALLOWED_ORIGINS);
    const limits = limitsFrom(env.LIMITS_JSON);
    const ip = clientIp(req);

    if (!originAllowed(origin, allowed)) {
      return jsonResponse({ error: { code: 'origin-not-allowed', message: '只允许白名单来源调用：' + allowed.join(', ') } }, 403, null);
    }
    const site = origin as string;

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(site) });
    }
    if (url.pathname === '/api/llm/status' && req.method === 'GET') {
      return handleStatus(env, site, limits, ip, now);
    }
    if (url.pathname === '/api/llm/chat' && req.method === 'POST') {
      return handleChat(req, env, ctx, site, limits, ip, now);
    }
    if (url.pathname === '/api/llm/embeddings' && req.method === 'POST') {
      return handleEmbeddings(req, env, site, limits, ip, now);
    }
    if (url.pathname === '/api/llm/rerank' && req.method === 'POST') {
      return handleRerank(req, env, site, limits, ip, now);
    }
    return fail(404, 'not-found', '没有这个路由。可用：GET /api/llm/status · POST /api/llm/chat · POST /api/llm/embeddings · POST /api/llm/rerank', site);
}

export default {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    try {
      return await route(req, env, ctx);
    } catch (err) {
      // 兜底：KV 写配额耗尽、账本解析、上游 fetch 抛错这类意外，之前会变成裸 500（访问者只看到「Internal Server Error」）。
      // 现在统一包成 503 proxy-degraded 的人话，前端会照实显示并提示「填自己的 key 也能用」。
      const origin = req.headers.get('origin');
      const allowed = parseOrigins(env.ALLOWED_ORIGINS);
      const site = origin && originAllowed(origin, allowed) ? origin : null;
      return fail(503, 'proxy-degraded', '站内代理临时不可用（限流计数或上游异常）。稍后再试通常就好；也可以填入自己的 API key 绕过站内代理。原始错误：' + String(err).slice(0, 200), site);
    }
  },
};
