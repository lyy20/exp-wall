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

// 分钟计数不再是独立的键：它作为 { b: 桶, n: 次数 } 存进日账本的 min 字段，见下面 Ledger。
/**
 * 日账本：把「当日 per-IP 计数 + 全局当日计数 + 当前分钟桶计数 + usage 账目」合并进**一个**键。
 * 为什么要合并：Cloudflare KV 免费档每天 1000 次写。旧实现一次成功 chat 要写 6 个键
 * （minute/day/global + u:/p:/t:）⇒ 真实天花板约 166 次/天，比站点宣传的 200 次全局闸门还低一截；
 * 一个 RAG 提问还要再叠 embedding + rerank 两次 aux 计数，写次数会更早撞墙。
 * 现在：一次成功 chat = 2 写（占用额度 1 写 + 记账 1 写），一次 aux 调用 = 1 写 ⇒ 天花板重新由闸门决定。
 * 代价：所有计数都变成「读—改—写」同一个键，并发下更接近「近似计数」（KV 本来就没有原子自增，见文件头说明）。
 */
export interface Ledger {
  /** 当日全局成功调用数（本 scope）。 */
  n: number;
  /** 当日 per-IP 成功调用数。 */
  ips: Record<string, number>;
  /** per-IP 的当前分钟桶计数：{ b: 分钟桶, n: 次数 }；桶不匹配即视为 0（旧桶条目写回时顺手清掉，值不会无限长大）。 */
  min: Record<string, { b: string; n: number }>;
  /** usage 账目（只有 chat 记账）：成功调用次数与 token 数。 */
  calls: number;
  prompt: number;
  completion: number;
}

export function ledgerKey(now: number, scope: Scope = 'c'): string {
  return 'L:' + scope + ':' + utcDay(now);
}

function emptyLedger(): Ledger {
  return { n: 0, ips: {}, min: {}, calls: 0, prompt: 0, completion: 0 };
}

function safeCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

async function readLedger(kv: KVLike, now: number, scope: Scope = 'c'): Promise<Ledger> {
  try {
    const raw = await kv.get(ledgerKey(now, scope));
    if (!raw) return emptyLedger();
    const j = JSON.parse(raw) as Partial<Ledger>;
    const ips: Record<string, number> = {};
    if (j.ips && typeof j.ips === 'object') {
      for (const [k, v] of Object.entries(j.ips)) {
        const c = safeCount(v);
        if (c > 0) ips[k] = c;
      }
    }
    const min: Record<string, { b: string; n: number }> = {};
    if (j.min && typeof j.min === 'object') {
      for (const [k, v] of Object.entries(j.min)) {
        const e = v as { b?: unknown; n?: unknown };
        if (typeof e.b === 'string') min[k] = { b: e.b, n: safeCount(e.n) };
      }
    }
    return { n: safeCount(j.n), ips, min, calls: safeCount(j.calls), prompt: safeCount(j.prompt), completion: safeCount(j.completion) };
  } catch {
    return emptyLedger();
  }
}

async function writeLedger(kv: KVLike, now: number, scope: Scope, l: Ledger): Promise<void> {
  await kv.put(ledgerKey(now, scope), JSON.stringify(l), { expirationTtl: 172800 });
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

/** 三个计数（分钟 / 当日 per-IP / 当日全局）都从同一个日账本里读出来：1 次 get。 */
async function readState(kv: KVLike, ip: string, now: number, scope: Scope): Promise<{ counters: Counters; ledger: Ledger }> {
  const ledger = await readLedger(kv, now, scope);
  const slot = ledger.min[ip];
  const bucket = minuteBucket(now);
  const counters: Counters = {
    minute: slot && slot.b === bucket ? slot.n : 0,
    day: ledger.ips[ip] || 0,
    global: ledger.n,
  };
  return { counters, ledger };
}

export async function peek(kv: KVLike, ip: string, now: number, scope: Scope = 'c'): Promise<Counters> {
  return (await readState(kv, ip, now, scope)).counters;
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
/** 判定并占用一次额度（拒绝时不占用）：**只写一个键**（日账本），省 KV 写次数。 */
export async function consume(kv: KVLike, ip: string, limits: Limits, now: number, scope: Scope = 'c'): Promise<Decision> {
  const { counters, ledger } = await readState(kv, ip, now, scope);
  const d = verdict(counters, limits, now);
  if (!d.ok) return d;
  const next: Counters = { minute: counters.minute + 1, day: counters.day + 1, global: counters.global + 1 };
  const bucket = minuteBucket(now);
  // 顺手清掉别的分钟桶（它们已经不参与判定），账本体积只跟「当分钟活跃 IP 数」有关
  const min: Record<string, { b: string; n: number }> = { [ip]: { b: bucket, n: next.minute } };
  for (const [key, slot] of Object.entries(ledger.min)) {
    if (key !== ip && slot.b === bucket) min[key] = slot;
  }
  const nextLedger: Ledger = {
    ...ledger,
    n: next.global,
    ips: { ...ledger.ips, [ip]: next.day },
    min,
  };
  await writeLedger(kv, now, scope, nextLedger);
  d.counters = next;
  return d;
}

export interface UsageTotals {
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

export async function readUsage(kv: KVLike, now: number, scope: Scope = 'c'): Promise<UsageTotals> {
  const l = await readLedger(kv, now, scope);
  return { calls: l.calls, promptTokens: l.prompt, completionTokens: l.completion };
}

/** 记一次真实上游调用的 token 用量（记账，不影响放行判定）。 */
export async function addUsage(
  kv: KVLike,
  u: { promptTokens: number; completionTokens: number },
  now: number,
  scope: Scope = 'c',
): Promise<void> {
  const l = await readLedger(kv, now, scope);
  await writeLedger(kv, now, scope, {
    ...l,
    calls: l.calls + 1,
    prompt: l.prompt + safeCount(u.promptTokens),
    completion: l.completion + safeCount(u.completionTokens),
  });
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
