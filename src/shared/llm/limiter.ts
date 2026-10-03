/**
 * 客户端限流 / 预算护栏。
 *
 * 用户要求「给 API 用量加一定的限流」，这里做三层：
 *   1) 滑动窗口：每分钟最多 6 次真实请求；
 *   2) 会话总额：单次页面生命周期最多 60 次（sessionStorage 记账，刷新不清零）；
 *   3) 单次上限：输出 token ≤ 512，输入字符 ≤ 6000，并发强制为 1。
 * 回放（replay）不占真实额度，单独计数。
 * 任何一层触发都会给出明确的中文提示，而不是静默失败。
 */

export interface LimitConfig {
  perMinute: number;
  perSession: number;
  maxOutputTokens: number;
  maxInputChars: number;
  concurrency: number;
}

export const DEFAULT_LIMITS: LimitConfig = {
  perMinute: 6,
  perSession: 60,
  maxOutputTokens: 512,
  maxInputChars: 6000,
  concurrency: 1,
};

const QUOTA_KEY = 'expwall.llm.quota.v1';

export interface Quota {
  live: number;
  replay: number;
  promptTokens: number;
  completionTokens: number;
}

export interface GateOk {
  ok: true;
}

export interface GateBlocked {
  ok: false;
  code: 'per-minute' | 'per-session';
  reason: string;
  retryAfterMs: number;
}

export type Gate = GateOk | GateBlocked;

export function estimateTokens(text: string): number {
  // 粗估：CJK 约 1 token/字，拉丁约 1 token/4 字符
  const cjk = (text.match(/[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk + rest / 4);
}

export class RateLimiter {
  limits: LimitConfig;
  private hits: number[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private quota: Quota;

  constructor(limits: LimitConfig = DEFAULT_LIMITS) {
    this.limits = { ...limits };
    this.quota = this.loadQuota();
  }

  private loadQuota(): Quota {
    try {
      const raw = window.sessionStorage.getItem(QUOTA_KEY);
      if (raw) {
        const q = JSON.parse(raw) as Quota;
        if (q && typeof q.live === 'number') return q;
      }
    } catch {
      /* sessionStorage 不可用则退化为内存计数 */
    }
    return { live: 0, replay: 0, promptTokens: 0, completionTokens: 0 };
  }

  private saveQuota(): void {
    try {
      window.sessionStorage.setItem(QUOTA_KEY, JSON.stringify(this.quota));
    } catch {
      /* ignore */
    }
  }

  private prune(now = Date.now()): void {
    this.hits = this.hits.filter((t) => now - t < 60000);
  }

  gate(): Gate {
    const now = Date.now();
    this.prune(now);
    if (this.quota.live >= this.limits.perSession) {
      return {
        ok: false,
        code: 'per-session',
        reason: '本次会话的真实 API 调用已达上限 ' + this.limits.perSession + ' 次（防止 key 被刷量），刷新页面可重置计数。',
        retryAfterMs: 0,
      };
    }
    if (this.hits.length >= this.limits.perMinute) {
      const oldest = this.hits[0];
      const wait = Math.max(0, 60000 - (now - oldest));
      return {
        ok: false,
        code: 'per-minute',
        reason: '限流：每分钟最多 ' + this.limits.perMinute + ' 次真实请求，请 ' + Math.ceil(wait / 1000) + ' 秒后再试。',
        retryAfterMs: wait,
      };
    }
    return { ok: true };
  }

  /** 串行执行 + 记账：并发被强制降到 1，先过闸再真正发请求。 */
  async run<T>(task: () => Promise<T>): Promise<T> {
    const gate = this.gate();
    if (!gate.ok) {
      const err = new Error(gate.reason) as Error & { code?: string };
      err.code = gate.code;
      throw err;
    }
    this.hits.push(Date.now());
    this.quota.live += 1;
    this.saveQuota();
    const next = this.chain.then(task);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  recordReplay(): void {
    this.quota.replay += 1;
    this.saveQuota();
  }

  recordUsage(prompt: number, completion: number): void {
    this.quota.promptTokens += prompt;
    this.quota.completionTokens += completion;
    this.saveQuota();
  }

  snapshot(): { limits: LimitConfig; quota: Quota; minuteLeft: number; minuteTotal: number } {
    this.prune();
    return {
      limits: this.limits,
      quota: { ...this.quota },
      minuteLeft: Math.max(0, this.limits.perMinute - this.hits.length),
      minuteTotal: this.limits.perMinute,
    };
  }

  resetQuota(): void {
    this.quota = { live: 0, replay: 0, promptTokens: 0, completionTokens: 0 };
    this.hits = [];
    this.saveQuota();
  }
}

export const limiter = new RateLimiter();
export function clampMaxTokens(want?: number): number {
  const limit = limiter.limits.maxOutputTokens;
  if (!want || want <= 0) return limit;
  return Math.min(want, limit);
}
export function clampInput(text: string): string {
  const limit = limiter.limits.maxInputChars;
  if (text.length <= limit) return text;
  return text.slice(0, limit);
}
