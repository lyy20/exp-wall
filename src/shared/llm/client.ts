import { LlmError } from './errors';
import { fetchWithTimeout, joinUrl, readSseData } from './http';
import { getCred, loadPreferred } from './keys';
import { clampInput, clampMaxTokens, estimateTokens, limiter } from './limiter';
import { chatViaProxy, embedViaProxy, proxyConfigured, proxyHas, rerankViaProxy } from './proxy';
import { DEFAULT_EMBED_PROVIDER_ID, getProvider, providersWith, type Provider } from './providers';

export { LlmError, describeError } from './errors';
export type { LlmErrorCode } from './errors';

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

function readSse(
  res: Response,
  onEvent: (data: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  return readSseData(res, onEvent, signal).catch((err: unknown) => {
    const e = err as Error;
    if (e.name === 'AbortError') throw new LlmError('aborted', '请求已取消');
    throw new LlmError('bad-response', e.message);
  });
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

/** 有 key 走 BYOK；没 key 但站内代理可用则返回 null（交给代理）；两者都没有才抛 no-key。 */
function resolveChatTargetOrNull(opts: { providerId?: string; model?: string }): ResolvedTarget | null {
  try {
    return resolveChatTarget(opts);
  } catch (err) {
    if (err instanceof LlmError && err.code === 'no-key' && proxyConfigured() && proxyHas('chat')) return null;
    throw err;
  }
}

/** 有 key 用自己的 key；没 key 但站内代理提供 embedding 就用代理。 */
function resolveEmbedTargetOrNull(opts: { providerId?: string; model?: string }): ResolvedTarget | null {
  try {
    return resolveEmbedTarget(opts);
  } catch (err) {
    if (err instanceof LlmError && err.code === 'no-key' && proxyConfigured() && proxyHas('embed')) return null;
    throw err;
  }
}

/**
 * 流式对话（SSE）。真实请求，受 limiter 限流约束。
 * 选路：自填 key 直连 > 站内代理 > 抛 no-key（调用方据此回落到回放）。
 */
export async function chatStream(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  const prepared = messages.map((m) => ({ role: m.role, content: clampInput(m.content) }));
  const maxTokens = clampMaxTokens(opts.maxTokens);
  const target = resolveChatTargetOrNull(opts);
  if (!target) {
    return limiter.run(async () => {
      const out = await chatViaProxy(prepared, {
        model: opts.model,
        temperature: opts.temperature,
        maxTokens,
        signal: opts.signal,
        onToken: opts.onToken,
      });
      limiter.recordUsage(out.usage.promptTokens, out.usage.completionTokens);
      return out;
    });
  }
  const { provider, apiKey, model } = target;
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
  const inputs = texts.map((t) => clampInput(t));
  const target = resolveEmbedTargetOrNull(opts);
  if (!target) {
    // 代理分支不进本地 limiter：一次提问要发 embedding + rerank + chat 三个请求，
    // 本地 limiter 若按调用计数，三问就会先撞本机限流、永远到不了服务端的 429。
    // 站内额度由服务端按通道把关（chat 一份、embedding/rerank 另一份）。
    return embedViaProxy(inputs, { model: opts.model, signal: opts.signal });
  }
  const { provider, apiKey, model } = target;
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
  if (!cred) {
    // 没填 key：站内代理配了 rerank 就走代理，否则如实返回 null（调用方会明说「不跑 rerank」）
    if (proxyConfigured() && proxyHas('rerank')) {
      // 同 embedTexts：代理分支不进本地 limiter，额度由服务端 aux 通道把关
      return rerankViaProxy(query, docs.map((d) => clampInput(d)), {
        model: opts.model || provider.rerankModel,
        topN: opts.topN ?? docs.length,
        signal: opts.signal,
      });
    }
    return null;
  }
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
