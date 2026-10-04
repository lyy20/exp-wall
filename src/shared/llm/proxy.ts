/**
 * 站内代理通道（P5-lite）。
 *
 * 形态：浏览器 → Cloudflare Worker（`proxy/`，部署在 *.workers.dev）→ DeepSeek / SiliconFlow。
 * 密钥只存在 Worker 的 secret 里；浏览器始终看不到 key。
 * 优先级：**自填 key 直连 > 站内代理 > 回放**（client.ts 负责选路）。
 *
 * 地址来源（按顺序）：构建期 VITE_PROXY_BASE_URL → URL 上的 ?proxy=… → localStorage。
 * 没配任何一处时 proxyConfigured() === false，页面行为与没有代理时完全一致（回放）。
 */

import { LlmError } from './errors';
import { fetchWithTimeout, joinUrl, readSseData } from './http';
import type { ChatMessage, ChatResult, ChatUsage, EmbedResult, RerankResult } from './client';

export interface ProxyLimits {
  perMinute: number;
  perDay: number;
  globalPerDay: number;
  maxOutputTokens: number;
  maxInputChars: number;
  maxMessages: number;
  maxTotalChars: number;
}

export interface ProxyStatus {
  ok: true;
  caps: string[];
  models: string[];
  defaultModel: string;
  embedModels: string[];
  rerankModels: string[];
  limits: ProxyLimits;
  counters: { minute: number; day: number; global: number };
  remaining: { minute: number; day: number; global: number };
  usage: { calls: number; promptTokens: number; completionTokens: number };
  serverTime: string;
  note?: string;
}

const STORE_KEY = 'expwall.llm.proxy.v1';
const FAIL_TTL_MS = 30000;
const OK_TTL_MS = 15000;

function strip(u: string): string {
  return u.replace(/\/+$/, '');
}

function envBase(): string {
  const raw = import.meta.env.VITE_PROXY_BASE_URL;
  return typeof raw === 'string' ? strip(raw.trim()) : '';
}

function urlBase(): string {
  try {
    const q = new URL(window.location.href).searchParams.get('proxy');
    if (q && /^https?:\/\//.test(q)) return strip(q.trim());
  } catch {
    /* 非浏览器环境 */
  }
  return '';
}

function storedBase(): string {
  try {
    const s = window.localStorage.getItem(STORE_KEY);
    if (s && /^https?:\/\//.test(s)) return strip(s.trim());
  } catch {
    /* localStorage 不可用 */
  }
  return '';
}

export function proxyBase(): string {
  return envBase() || urlBase() || storedBase();
}

export function proxyConfigured(): boolean {
  return proxyBase().length > 0;
}

/** 把地址存到本机（测试/自建代理时用；站点默认只用构建期变量）。 */
export function rememberProxyBase(url: string): void {
  try {
    window.localStorage.setItem(STORE_KEY, strip(url.trim()));
  } catch {
    /* ignore */
  }
}

let cache: ProxyStatus | null = null;
let cacheAt = 0;
let failure: { at: number; detail: string } | null = null;
let inflight: Promise<ProxyStatus | null> | null = null;

export function proxyStatus(): ProxyStatus | null {
  return cache;
}

export function proxyFailureDetail(): string | null {
  return failure ? failure.detail : null;
}

export function proxyHas(cap: 'chat' | 'embed' | 'rerank'): boolean {
  return Boolean(cache && cache.caps.indexOf(cap) >= 0);
}

/** 有代理、探活成功、且今天/本分钟的站内额度还没用完。 */
export function proxyReady(): boolean {
  if (!cache) return false;
  const r = cache.remaining;
  return r.minute > 0 && r.day > 0 && r.global > 0;
}

/** GET /api/llm/status：8 秒超时，失败按 30 秒缓存，避免离线时反复打空请求。 */
export async function probeProxy(force = false): Promise<ProxyStatus | null> {
  const base = proxyBase();
  if (!base) return null;
  const now = Date.now();
  if (!force) {
    if (cache && now - cacheAt < OK_TTL_MS) return cache;
    if (failure && now - failure.at < FAIL_TTL_MS) return null;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetchWithTimeout(joinUrl(base, '/api/llm/status'), { method: 'GET' }, undefined, 8000);
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error('HTTP ' + res.status + (detail ? ' · ' + detail.slice(0, 160) : ''));
      }
      const json = (await res.json()) as ProxyStatus;
      if (!json || json.ok !== true || !json.remaining) throw new Error('返回格式不符合预期');
      cache = json;
      cacheAt = Date.now();
      failure = null;
      return json;
    } catch (err) {
      failure = { at: Date.now(), detail: (err as Error).message };
      cache = null;
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function headerNumber(res: Response, name: string): number | null {
  const raw = res.headers.get(name);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** 用响应头里的剩余额度更新缓存，省掉一次 /status 往返。 */
function applyRemaining(res: Response): void {
  if (!cache) return;
  const m = headerNumber(res, 'X-Proxy-Remaining-Minute');
  const d = headerNumber(res, 'X-Proxy-Remaining-Day');
  const g = headerNumber(res, 'X-Proxy-Remaining-Global');
  if (m === null && d === null && g === null) return;
  // 刻意 **原地改** 而不是 cache = { ...cache }：这份 cache 会被 useLlm 存进 React state、
  // 也可能被别处持有；重新赋值等于换对象，所有旧引用会永久停在第一次探活时的额度快照上
  // （现象：提问后详情栏的「站内额度」不再自己掉，额度耗尽的警示永远不出现）。
  cache.remaining = {
    minute: m === null ? cache.remaining.minute : m,
    day: d === null ? cache.remaining.day : d,
    global: g === null ? cache.remaining.global : g,
  };
  cacheAt = Date.now();
}

async function toError(res: Response): Promise<LlmError> {
  let code = 'http-' + res.status;
  let message = 'HTTP ' + res.status;
  let hint: string | undefined;
  try {
    const j = (await res.json()) as { error?: { code?: string; message?: string; retryAfterMs?: number } };
    if (j && j.error) {
      if (j.error.code) code = j.error.code;
      if (j.error.message) message = j.error.message;
      if (typeof j.error.retryAfterMs === 'number' && j.error.retryAfterMs > 0) {
        hint = '约 ' + Math.ceil(j.error.retryAfterMs / 1000) + ' 秒后可以再试';
      }
    }
  } catch {
    /* 非 JSON 错误体 */
  }
  if (code === 'per-minute' || code === 'per-day' || code === 'global-day') {
    return new LlmError(
      'proxy-quota',
      '站内额度用完：' + message,
      (hint ? hint + '；' : '') + '想继续问就填自己的 key —— 只存本机 localStorage，直连服务商。',
    );
  }
  if (code === 'config-missing-kv' || code === 'config-missing-key') {
    return new LlmError('proxy-unavailable', '站内代理还没配置好：' + message);
  }
  if (code.indexOf('upstream') === 0) {
    return new LlmError('proxy-error', '站内代理转发失败：' + message);
  }
  return new LlmError('proxy-error', '站内代理返回 ' + message + '（' + code + '）');
}

export interface ProxyChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onToken?: (chunk: string) => void;
}

/** 与 client.chatStream 同语义，只是请求发给站内代理；限流闸门由 client 统一加。 */
export async function chatViaProxy(messages: ChatMessage[], opts: ProxyChatOptions = {}): Promise<ChatResult> {
  const base = proxyBase();
  if (!base) throw new LlmError('proxy-unavailable', '没有配置站内代理地址');
  const model = (opts.model || cache?.defaultModel || 'deepseek-chat').trim();
  const started = performance.now();
  let res: Response;
  try {
    res = await fetchWithTimeout(
      joinUrl(base, '/api/llm/chat'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.maxTokens ?? cache?.limits.maxOutputTokens ?? 512,
        }),
      },
      opts.signal,
    );
  } catch (err) {
    if (opts.signal?.aborted) throw new LlmError('aborted', '请求已取消');
    throw new LlmError(
      'proxy-unavailable',
      '站内代理连不上（' + base + '）：' + (err as Error).message,
      '可能是网络不通或代理没部署好；填自己的 key 可以直连服务商。',
    );
  }
  if (!res.ok) throw await toError(res);
  applyRemaining(res);

  let text = '';
  let usage: ChatUsage | null = null;
  let firstTokenMs = -1;
  await readSseData(
    res,
    (raw) => {
      const data = raw as {
        choices?: { delta?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const delta = data.choices?.[0]?.delta?.content;
      if (delta) {
        if (firstTokenMs < 0) firstTokenMs = performance.now() - started;
        text += delta;
        opts.onToken?.(delta);
      }
      if (data.usage) {
        usage = {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
        };
      }
    },
    opts.signal,
  );

  const latencyMs = performance.now() - started;
  return {
    text,
    model,
    providerId: 'proxy',
    latencyMs,
    firstTokenMs: firstTokenMs < 0 ? latencyMs : firstTokenMs,
    usage: usage ?? { promptTokens: 0, completionTokens: 0 },
    live: true,
  };
}

export async function embedViaProxy(
  texts: string[],
  opts: { model?: string; signal?: AbortSignal } = {},
): Promise<EmbedResult> {
  const base = proxyBase();
  if (!base) throw new LlmError('proxy-unavailable', '没有配置站内代理地址');
  const model = (opts.model || cache?.embedModels[0] || '').trim();
  const started = performance.now();
  let res: Response;
  try {
    res = await fetchWithTimeout(
      joinUrl(base, '/api/llm/embeddings'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: texts }),
      },
      opts.signal,
      90000,
    );
  } catch (err) {
    if (opts.signal?.aborted) throw new LlmError('aborted', '请求已取消');
    throw new LlmError('proxy-unavailable', '站内代理连不上（' + base + '）：' + (err as Error).message);
  }
  if (!res.ok) throw await toError(res);
  const json = (await res.json()) as { data?: { index?: number; embedding?: number[] }[]; model?: string };
  const rows = json.data || [];
  if (!rows.length) throw new LlmError('bad-response', '向量返回为空');
  const sorted = rows.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const vectors = sorted.map((r) => Float32Array.from(r.embedding || []));
  return {
    vectors,
    dim: vectors[0].length,
    // 用服务端回报的真实模型名：Worker 在 SiliconFlow 401/403 时会自动降级到 Workers AI，
    // 那时的模型是 @cf/baai/bge-m3 而不是请求里写的 BAAI/bge-m3 —— 照写请求值会变成假标签，
    // 页面上「查询向量」那一格就会冒充成 SiliconFlow 的模型名（诚实性优先级高于好看）。
    model: json.model || model,
    providerId: 'proxy',
    latencyMs: performance.now() - started,
    live: true,
  };
}

export async function rerankViaProxy(
  query: string,
  docs: string[],
  opts: { model?: string; topN?: number; signal?: AbortSignal } = {},
): Promise<RerankResult> {
  const base = proxyBase();
  if (!base) throw new LlmError('proxy-unavailable', '没有配置站内代理地址');
  const model = (opts.model || cache?.rerankModels[0] || '').trim();
  const started = performance.now();
  let res: Response;
  try {
    res = await fetchWithTimeout(
      joinUrl(base, '/api/llm/rerank'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, query, documents: docs, top_n: opts.topN ?? docs.length }),
      },
      opts.signal,
    );
  } catch (err) {
    if (opts.signal?.aborted) throw new LlmError('aborted', '请求已取消');
    throw new LlmError('proxy-unavailable', '站内代理连不上（' + base + '）：' + (err as Error).message);
  }
  if (!res.ok) throw await toError(res);
  const json = (await res.json()) as { results?: { index: number; relevance_score: number }[]; model?: string };
  const results = json.results || [];
  return {
    order: results.map((r) => r.index),
    scores: results.map((r) => r.relevance_score),
    // 同上：精排也可能被 Worker 降级到 @cf/baai/bge-reranker-base，标签以服务端回报为准。
    model: json.model || model,
    providerId: 'proxy',
    latencyMs: performance.now() - started,
    live: true,
  };
}
