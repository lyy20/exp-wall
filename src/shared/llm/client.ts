import { getCred, loadPreferred } from './keys';
import { clampInput, clampMaxTokens, estimateTokens, limiter } from './limiter';
import { DEFAULT_EMBED_PROVIDER_ID, getProvider, providersWith, type Provider } from './providers';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatResult {
  text: string;
  model: string;
  providerId: string;
  latencyMs: number;
  firstTokenMs: number;
  usage: ChatUsage;
  live: true;
}

export interface ChatOptions {
  providerId?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onToken?: (chunk: string) => void;
}

export interface EmbedResult {
  vectors: Float32Array[];
  dim: number;
  model: string;
  providerId: string;
  latencyMs: number;
  live: true;
}

export interface RerankResult {
  order: number[];
  scores: number[];
  model: string;
  providerId: string;
  latencyMs: number;
  live: true;
}

export type LlmErrorCode =
  | 'no-key'
  | 'unknown-provider'
  | 'no-capability'
  | 'http'
  | 'network'
  | 'aborted'
  | 'per-minute'
  | 'per-session'
  | 'bad-response';

export class LlmError extends Error {
  code: LlmErrorCode;
  hint?: string;
  constructor(code: LlmErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.hint = hint;
  }
}

export function describeError(err: unknown): { title: string; detail: string } {
  if (err instanceof LlmError) {
    const title =
      err.code === 'no-key'
        ? '未配置 API key'
        : err.code === 'per-minute' || err.code === 'per-session'
          ? '触发限流'
          : err.code === 'aborted'
            ? '已取消'
            : err.code === 'network'
              ? '网络不可达'
              : err.code.startsWith('http')
                ? '接口报错'
                : '调用失败';
    return { title, detail: err.message };
  }
  const e = err as Error;
  return { title: '调用失败', detail: e?.message || String(err) };
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path;
}

async function fetchWithTimeout(url: string, init: RequestInit, signal?: AbortSignal, timeoutMs = 60000): Promise<Response> {
  if (signal) return fetch(url, { ...init, signal });
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function readSse(
  res: Response,
  onEvent: (data: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const body = res.body;
  if (!body) throw new LlmError('bad-response', '响应没有可读取的流');
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  for (;;) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => undefined);
      throw new LlmError('aborted', '请求已取消');
    }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    for (const raw of parts) {
      const line = raw.trim();
      if (!line || !line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        onEvent(JSON.parse(payload));
      } catch {
        /* 忽略无法解析的心跳行 */
      }
    }
  }
}

export interface ResolvedTarget {
  provider: Provider;
  apiKey: string;
  model: string;
}

export function resolveChatTarget(opts: { providerId?: string; model?: string } = {}): ResolvedTarget {
  const providerId = opts.providerId || loadPreferred();
  const provider = getProvider(providerId);
  if (!provider) throw new LlmError('unknown-provider', '未知的服务商：' + providerId);
  if (!provider.caps.includes('chat')) throw new LlmError('no-capability', provider.label + ' 不支持对话接口');
  const cred = getCred(providerId);
  if (!cred) {
    throw new LlmError(
      'no-key',
      '还没有配置 ' + provider.label + ' 的 API key。填入你自己的 key 即可实时调用（只存在本机 localStorage，不上传）。',
      provider.label + ' key 申请地址见服务商控制台',
    );
  }
  const model = (opts.model || cred.model || provider.chatModel).trim() || provider.chatModel;
  return { provider, apiKey: cred.apiKey, model };
}

export function resolveEmbedTarget(opts: { providerId?: string; model?: string } = {}): ResolvedTarget {
  let provider: Provider | undefined;
  if (opts.providerId) provider = getProvider(opts.providerId);
  if (!provider) {
    provider = providersWith('embed').find((p) => getCred(p.id)) || getProvider(DEFAULT_EMBED_PROVIDER_ID);
  }
  if (!provider) throw new LlmError('no-capability', '没有可用的向量服务商');
  if (!provider.caps.includes('embed')) {
    throw new LlmError('no-capability', provider.label + ' 不提供 embedding 接口，请改用 SiliconFlow / 百炼 / 智谱');
  }
  const cred = getCred(provider.id);
  if (!cred) {
    throw new LlmError('no-key', '还没有配置 ' + provider.label + ' 的 API key，无法实时计算向量。');
  }
  const model = (opts.model || cred.model || provider.embedModel || '').trim() || provider.embedModel || '';
  return { provider, apiKey: cred.apiKey, model };
}

/** 流式对话（SSE）。真实请求，受 limiter 限流约束。 */
export async function chatStream(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  const target = resolveChatTarget(opts);
  const { provider, apiKey, model } = target;
  const prepared = messages.map((m) => ({ role: m.role, content: clampInput(m.content) }));
  const maxTokens = clampMaxTokens(opts.maxTokens);
  const started = performance.now();

  return limiter.run(async () => {
    let res: Response;
    try {
      res = await fetchWithTimeout(
        joinUrl(provider.base, '/chat/completions'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + apiKey,
          },
          body: JSON.stringify({
            model,
            messages: prepared,
            temperature: opts.temperature ?? 0.2,
            max_tokens: maxTokens,
            stream: true,
            stream_options: { include_usage: true },
          }),
        },
        opts.signal,
      );
    } catch (err) {
      if (opts.signal?.aborted) throw new LlmError('aborted', '请求已取消');
      throw new LlmError(
        'network',
        '无法连接 ' + new URL(joinUrl(provider.base, '/chat/completions')).host + '：' + (err as Error).message,
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new LlmError(
        'http',
        provider.label + ' 返回 HTTP ' + res.status + ' ' + res.statusText + (detail ? ' · ' + detail.slice(0, 300) : ''),
      );
    }

    let text = '';
    let usage: ChatUsage | null = null;
    let firstTokenMs = -1;

    await readSse(
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
    const finalUsage: ChatUsage = usage ?? {
      promptTokens: estimateTokens(prepared.map((m) => m.content).join('\n')),
      completionTokens: estimateTokens(text),
    };
    limiter.recordUsage(finalUsage.promptTokens, finalUsage.completionTokens);

    return {
      text,
      model,
      providerId: provider.id,
      latencyMs,
      firstTokenMs: firstTokenMs < 0 ? latencyMs : firstTokenMs,
      usage: finalUsage,
      live: true,
    };
  });
}

/** OpenAI 兼容 /embeddings。返回未归一化向量（原样）。 */
export async function embedTexts(
  texts: string[],
  opts: { providerId?: string; model?: string; signal?: AbortSignal } = {},
): Promise<EmbedResult> {
  if (!texts.length) throw new LlmError('bad-response', '没有要向量化的文本');
  const target = resolveEmbedTarget(opts);
  const { provider, apiKey, model } = target;
  const inputs = texts.map((t) => clampInput(t));
  const started = performance.now();

  return limiter.run(async () => {
    let res: Response;
    try {
      res = await fetchWithTimeout(
        joinUrl(provider.base, '/embeddings'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
          body: JSON.stringify({ model, input: inputs }),
        },
        opts.signal,
        90000,
      );
    } catch (err) {
      throw new LlmError('network', '向量接口不可达：' + (err as Error).message);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new LlmError('http', provider.label + ' embedding 返回 HTTP ' + res.status + (detail ? ' · ' + detail.slice(0, 200) : ''));
    }
    const json = (await res.json()) as { data?: { index?: number; embedding?: number[] }[] };
    const rows = json.data || [];
    if (!rows.length) throw new LlmError('bad-response', '向量返回为空');
    const sorted = rows.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const vectors = sorted.map((r) => Float32Array.from(r.embedding || []));
    const dim = vectors[0].length;
    limiter.recordUsage(estimateTokens(inputs.join('')), 0);
    return { vectors, dim, model, providerId: provider.id, latencyMs: performance.now() - started, live: true };
  });
}

/** SiliconFlow 等提供的 /rerank 接口；服务商不支持时返回 null。 */
export async function rerankDocs(
  query: string,
  docs: string[],
  opts: { providerId?: string; model?: string; topN?: number; signal?: AbortSignal } = {},
): Promise<RerankResult | null> {
  const providerId = opts.providerId || 'siliconflow';
  const provider = getProvider(providerId);
  if (!provider || !provider.caps.includes('rerank')) return null;
  const cred = getCred(provider.id);
  if (!cred) return null;
  const model = (opts.model || provider.rerankModel || '').trim();
  const started = performance.now();
  return limiter.run(async () => {
    const res = await fetchWithTimeout(
      joinUrl(provider.base, '/rerank'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cred.apiKey },
        body: JSON.stringify({ model, query, documents: docs.map((d) => clampInput(d)), top_n: opts.topN ?? docs.length }),
      },
      opts.signal,
      60000,
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new LlmError('http', provider.label + ' 精排返回 HTTP ' + res.status + (detail ? ' · ' + detail.slice(0, 200) : ''));
    }
    const json = (await res.json()) as { results?: { index: number; relevance_score: number }[] };
    const results = json.results || [];
    return {
      order: results.map((r) => r.index),
      scores: results.map((r) => r.relevance_score),
      model,
      providerId: provider.id,
      latencyMs: performance.now() - started,
      live: true,
    };
  });
}

/** 用 1 个 token 的真实请求验证 key 是否可用（同样计入限流）。 */
export async function verifyKey(providerId: string): Promise<{ ok: true; model: string; latencyMs: number } | { ok: false; detail: string }> {
  const provider = getProvider(providerId);
  if (!provider) return { ok: false, detail: '未知服务商' };
  try {
    const started = performance.now();
    await limiter.run(async () => {
      const cred = getCred(providerId);
      if (!cred) throw new LlmError('no-key', '未填写 key');
      const res = await fetchWithTimeout(
        joinUrl(provider.base, '/chat/completions'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cred.apiKey },
          body: JSON.stringify({
            model: cred.model || provider.chatModel,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
            stream: false,
          }),
        },
        undefined,
        30000,
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new LlmError('http', 'HTTP ' + res.status + (detail ? ' · ' + detail.slice(0, 200) : ''));
      }
      return true;
    });
    return { ok: true, model: getCred(providerId)?.model || provider.chatModel, latencyMs: 0 };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

export function normalize(vec: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vec.length; i += 1) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i += 1) out[i] = vec[i] / norm;
  return out;
}

export function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i += 1) s += a[i] * b[i];
  return s;
}
