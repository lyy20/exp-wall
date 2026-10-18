// 站内代理的预算闸门：按「每天最多花多少钱」限制，不再限制每分钟次数 / 每 IP 次数。
// 口径：每天 ¥5（UTC 日切，北京时间的次日 08:00）；每次调用按 token 用量折算成钱，记进当天的日账本。
// 为什么不用次数：一次多步 ReAct 回答要 2–4 次模型调用，按次数计费会让「问一个问题」就撞上限；
// 按钱计费才真正对应「花多少」，也不用给用户解释「分钟桶」。
// KV 的 get/put 没有原子自增：并发下计数是「近似」的，属于可接受的误差（最多多花一次请求的钱）。

export interface Limits {
  /** 每天最多花多少钱（人民币）。 */
  dailyBudgetYuan: number;
  /** 每百万输入 token 的价格（人民币，默认按 deepseek-chat cache-miss 价格）。 */
  priceInPerM: number;
  /** 每百万输出 token 的价格（人民币）。 */
  priceOutPerM: number;
  /** 单次输出的 token 上限（这是请求参数，不是额度）。 */
  maxOutputTokens: number;
  /** 单条输入的字符上限（防超长，不是额度）。 */
  maxInputChars: number;
  maxMessages: number;
  maxTotalChars: number;
}

export const DEFAULT_LIMITS: Limits = {
  dailyBudgetYuan: 5,
  priceInPerM: 2,
  priceOutPerM: 8,
  maxOutputTokens: 512,
  maxInputChars: 6000,
  maxMessages: 12,
  maxTotalChars: 12000,
};

export type Scope = 'c' | 'a';

export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export const MINUTE_MS = 60000;

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function ledgerKey(now: number, scope: Scope = 'c'): string {
  return 'L:' + scope + ':' + utcDay(now);
}

/**
 * 日账本：一个键装下当天的调用次数、token 账目与花费。
 * chat 与 embedding/rerank 分作用域（'c' / 'a'），但两边共用同一个 ¥5 预算吗？——不：
 * 预算只对 chat 生效（aux 是检索/精排，成本可忽略），所以 aux 的 consume 只看 'a' 账本的花费，
 * 而 'a' 的花费由 price=0 折算，等于不限；这样一次 RAG 提问不会因为 embedding 把预算吃光。
 */
export interface Ledger {
  /** 当天调用次数（展示用）。 */
  n: number;
  /** 当天累计花费（人民币，保留 6 位）。 */
  cost: number;
  /** 各 IP 的调用次数（仅展示）。 */
  ips: Record<string, number>;
  /** usage 账目：调用次数与 token 数。 */
  calls: number;
  prompt: number;
  completion: number;
}

function emptyLedger(): Ledger {
  return { n: 0, cost: 0, ips: {}, calls: 0, prompt: 0, completion: 0 };
}

function safeCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function safeMoney(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1e6) / 1e6 : 0;
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
    return {
      n: safeCount(j.n), cost: safeMoney(j.cost), ips,
      calls: safeCount(j.calls), prompt: safeCount(j.prompt), completion: safeCount(j.completion),
    };
  } catch {
    return emptyLedger();
  }
}

async function writeLedger(kv: KVLike, now: number, scope: Scope, l: Ledger): Promise<void> {
  await kv.put(ledgerKey(now, scope), JSON.stringify(l), { expirationTtl: 172800 });
}

/** 把 token 用量折算成人民币。 */
export function costOf(promptTokens: number, completionTokens: number, limits: Limits): number {
  const p = Math.max(0, promptTokens) * limits.priceInPerM / 1e6;
  const c = Math.max(0, completionTokens) * limits.priceOutPerM / 1e6;
  return Math.round((p + c) * 1e6) / 1e6;
}

export interface Budget {
  limitYuan: number;
  spentYuan: number;
  remainingYuan: number;
}

export function budgetOf(ledger: Ledger, limits: Limits): Budget {
  const spent = Math.round(Math.min(ledger.cost, limits.dailyBudgetYuan) * 1e6) / 1e6;
  return {
    limitYuan: limits.dailyBudgetYuan,
    spentYuan: spent,
    remainingYuan: Math.max(0, Math.round((limits.dailyBudgetYuan - ledger.cost) * 1e6) / 1e6),
  };
}

export interface Decision {
  ok: boolean;
  code?: 'budget-day';
  message: string;
  retryAfterMs: number;
  budget: Budget;
}

export function msUntilUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
}

export async function peek(kv: KVLike, _ip: string, now: number, scope: Scope = 'c', limits: Limits = DEFAULT_LIMITS): Promise<Budget> {
  return budgetOf(await readLedger(kv, now, scope), limits);
}

/** 判定并登记一次调用：只看「今天还剩多少钱」。 */
export async function consume(kv: KVLike, ip: string, limits: Limits, now: number, scope: Scope = 'c'): Promise<Decision> {
  const ledger = await readLedger(kv, now, scope);
  const budget = budgetOf(ledger, limits);
  if (ledger.cost >= limits.dailyBudgetYuan) {
    return {
      ok: false,
      code: 'budget-day',
      message: '今天的站内预算（¥' + limits.dailyBudgetYuan + '）已用完，明天 08:00（北京时间）恢复；想现在继续就填自己的 API key。',
      retryAfterMs: msUntilUtcMidnight(now),
      budget,
    };
  }
  const next: Ledger = {
    ...ledger,
    n: ledger.n + 1,
    ips: { ...ledger.ips, [ip]: (ledger.ips[ip] || 0) + 1 },
  };
  await writeLedger(kv, now, scope, next);
  return { ok: true, message: 'ok', retryAfterMs: 0, budget: budgetOf(next, limits) };
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

/** 记一次真实上游调用的 token 用量与花费（记账，不影响放行判定）。 */
export async function addUsage(
  kv: KVLike,
  u: { promptTokens: number; completionTokens: number },
  now: number,
  scope: Scope = 'c',
  limits: Limits = DEFAULT_LIMITS,
): Promise<void> {
  const l = await readLedger(kv, now, scope);
  await writeLedger(kv, now, scope, {
    ...l,
    calls: l.calls + 1,
    prompt: l.prompt + safeCount(u.promptTokens),
    completion: l.completion + safeCount(u.completionTokens),
    cost: Math.round((l.cost + costOf(u.promptTokens, u.completionTokens, limits)) * 1e6) / 1e6,
  });
}

/** aux（embedding / rerank）不再单独设额度：它们的价格按 0 计，不受 ¥5 预算影响。 */
export function auxLimits(limits: Limits): Limits {
  return { ...limits, priceInPerM: 0, priceOutPerM: 0 };
}

export function limitsFrom(raw: string | undefined): Limits {
  if (!raw) return DEFAULT_LIMITS;
  try {
    const j = JSON.parse(raw) as Partial<Limits>;
    const num = (v: unknown, d: number) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : d;
    };
    return {
      dailyBudgetYuan: num(j.dailyBudgetYuan, DEFAULT_LIMITS.dailyBudgetYuan),
      priceInPerM: num(j.priceInPerM, DEFAULT_LIMITS.priceInPerM),
      priceOutPerM: num(j.priceOutPerM, DEFAULT_LIMITS.priceOutPerM),
      maxOutputTokens: num(j.maxOutputTokens, DEFAULT_LIMITS.maxOutputTokens),
      maxInputChars: num(j.maxInputChars, DEFAULT_LIMITS.maxInputChars),
      maxMessages: num(j.maxMessages, DEFAULT_LIMITS.maxMessages),
      maxTotalChars: num(j.maxTotalChars, DEFAULT_LIMITS.maxTotalChars),
    };
  } catch {
    return DEFAULT_LIMITS;
  }
}
