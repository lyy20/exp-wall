// 站内代理的限流与预算闸门：纯函数 + 可注入 KV（便于在 Node 里用真实代码做验收）。
// 设计口径（与前端 KeyBar 上写的一致）：
//   per-IP  3 次/分钟、30 次/天；全局 200 次/天；单次输出 <= 512 token；单次输入 <= 6000 字符/条。
// KV 的 get/put 没有原子自增：并发下计数是「近似」的，所以真正的兜底是全局日预算闸门（超出即全站拒绝）。
//
// 额度按「通道」分作用域计数（一次 RAG 提问 = 1 次 chat + 1 次 embedding + 1 次 rerank，如果三者共用一份计数，
// 用户问一句就把整分钟额度吃光）：
//   scope 'c'（chat）    —— 用户可见的那份额度：perMinute / perDay / globalPerDay 原样适用，/status 与响应头报的都是这一份。
//   scope 'a'（aux）     —— embedding / rerank：额度按 AUX_FACTOR 放宽，只防脚本刷接口，不抢用户提问的额度。

export interface Limits {
  perMinute: number;
  perDay: number;
  globalPerDay: number;
  maxOutputTokens: number;
  maxInputChars: number;
  maxMessages: number;
  maxTotalChars: number;
}

export const DEFAULT_LIMITS: Limits = {
  perMinute: 3,
  perDay: 30,
  globalPerDay: 200,
  maxOutputTokens: 512,
  maxInputChars: 6000,
  maxMessages: 12,
  maxTotalChars: 12000,
};

export type Scope = 'c' | 'a';

/** aux 通道（embedding / rerank）的额度放宽倍数：它们极便宜，只防脚本刷，不与用户提问抢额度。 */
export const AUX_FACTOR = 6;

export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export const MINUTE_MS = 60000;

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function minuteBucket(now: number): string {
  return String(Math.floor(now / MINUTE_MS));
}

export function minuteKey(ip: string, now: number, scope: Scope = 'c'): string {
  return 'm:' + scope + ':' + ip + ':' + minuteBucket(now);
}

export function dayKey(ip: string, now: number, scope: Scope = 'c'): string {
  return 'd:' + scope + ':' + ip + ':' + utcDay(now);
}

export function globalKey(now: number, scope: Scope = 'c'): string {
  return 'g:' + scope + ':' + utcDay(now);
}

/** aux 通道用的放宽版额度（数值仍然是同一份 Limits 派生的，改 LIMITS_JSON 会同时影响两个作用域）。 */
export function auxLimits(limits: Limits): Limits {
  return {
    ...limits,
    perMinute: limits.perMinute * AUX_FACTOR,
    perDay: limits.perDay * AUX_FACTOR,
    globalPerDay: limits.globalPerDay * AUX_FACTOR,
  };
}

export function usageKey(now: number): string {
  return 'u:' + utcDay(now);
}

export function tokensKey(now: number): string {
  return 't:' + utcDay(now);
}

export interface Counters {
  minute: number;
  day: number;
  global: number;
}

export type LimitCode = 'per-minute' | 'per-ip-day' | 'global-day';

export interface Decision {
  ok: boolean;
  code?: LimitCode;
  message: string;
  retryAfterMs: number;
  counters: Counters;
}

export function msUntilUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
}

async function readCount(kv: KVLike, key: string): Promise<number> {
  try {
    const raw = await kv.get(key);
    const n = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export async function peek(kv: KVLike, ip: string, now: number, scope: Scope = 'c'): Promise<Counters> {
  const tri = await Promise.all([
    readCount(kv, minuteKey(ip, now, scope)),
    readCount(kv, dayKey(ip, now, scope)),
    readCount(kv, globalKey(now, scope)),
  ]);
  return { minute: tri[0], day: tri[1], global: tri[2] };
}

/** 纯函数判据：给定计数器决定放行还是拒绝（单测直接打这里）。 */
export function verdict(c: Counters, limits: Limits, now: number): Decision {
  const counters: Counters = { minute: c.minute, day: c.day, global: c.global };
  if (c.global >= limits.globalPerDay) {
    return {
      ok: false,
      code: 'global-day',
      message: '站内代理今天的全局预算已用完（' + limits.globalPerDay + ' 次/天）。填入你自己的 API key 可以继续使用。',
      retryAfterMs: msUntilUtcMidnight(now),
      counters,
    };
  }
  if (c.day >= limits.perDay) {
    return {
      ok: false,
      code: 'per-ip-day',
      message: '你今天的站内额度已用完（每 IP ' + limits.perDay + ' 次/天）。填入你自己的 API key 可以继续使用。',
      retryAfterMs: msUntilUtcMidnight(now),
      counters,
    };
  }
  if (c.minute >= limits.perMinute) {
    const wait = MINUTE_MS - (now % MINUTE_MS);
    return {
      ok: false,
      code: 'per-minute',
      message: '请求过于频繁：站内代理每分钟 ' + limits.perMinute + ' 次，请约 ' + Math.ceil(wait / 1000) + ' 秒后再试，或填入自己的 key。',
      retryAfterMs: wait,
      counters,
    };
  }
  return { ok: true, message: 'ok', retryAfterMs: 0, counters };
}

/** 判定并占用一次额度（拒绝时不占用）。 */
export async function consume(kv: KVLike, ip: string, limits: Limits, now: number, scope: Scope = 'c'): Promise<Decision> {
  const counters = await peek(kv, ip, now, scope);
  const d = verdict(counters, limits, now);
  if (!d.ok) return d;
  const next: Counters = { minute: counters.minute + 1, day: counters.day + 1, global: counters.global + 1 };
  await Promise.all([
    kv.put(minuteKey(ip, now, scope), String(next.minute), { expirationTtl: 120 }),
    kv.put(dayKey(ip, now, scope), String(next.day), { expirationTtl: 172800 }),
    kv.put(globalKey(now, scope), String(next.global), { expirationTtl: 172800 }),
  ]);
  d.counters = next;
  return d;
}

export interface UsageTotals {
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

export async function readUsage(kv: KVLike, now: number): Promise<UsageTotals> {
  const [calls, prompt, completion] = await Promise.all([
    readCount(kv, usageKey(now)),
    readCount(kv, 'p:' + utcDay(now)),
    readCount(kv, tokensKey(now)),
  ]);
  return { calls, promptTokens: prompt, completionTokens: completion };
}

/** 记一次真实上游调用的 token 用量（记账，不影响放行判定）。 */
export async function addUsage(
  kv: KVLike,
  u: { promptTokens: number; completionTokens: number },
  now: number,
): Promise<void> {
  const calls = await readCount(kv, usageKey(now));
  const prompt = await readCount(kv, 'p:' + utcDay(now));
  const completion = await readCount(kv, tokensKey(now));
  const day = 172800;
  await Promise.all([
    kv.put(usageKey(now), String(calls + 1), { expirationTtl: day }),
    kv.put('p:' + utcDay(now), String(prompt + Math.max(0, u.promptTokens)), { expirationTtl: day }),
    kv.put(tokensKey(now), String(completion + Math.max(0, u.completionTokens)), { expirationTtl: day }),
  ]);
}

export function limitsFrom(raw: string | undefined): Limits {
  if (!raw) return DEFAULT_LIMITS;
  try {
    const j = JSON.parse(raw) as Partial<Limits>;
    const out: Limits = { ...DEFAULT_LIMITS };
    for (const k of Object.keys(DEFAULT_LIMITS) as (keyof Limits)[]) {
      const v = j[k];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = Math.floor(v);
    }
    return out;
  } catch {
    return DEFAULT_LIMITS;
  }
}
