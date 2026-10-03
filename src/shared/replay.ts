/**
 * 回放引擎：零配置体验的核心。
 *
 * 素材是项目自己日志里**真实录制**的模型输出（YYHelp trace.jsonl / RAG logs/app.jsonl 等），
 * 前端按 token 粒度 + 真实节奏逐字吐出，观感与实时几乎一致，但不需要任何 key、不花一分钱、
 * 也不会因为网络或限流失败。页面上会明确标注「回放」徽标与录制来源，不做虚假宣传。
 */

export interface ReplayHit {
  id: string;
  doc: string;
  score?: number;
}

export interface ReplayScript {
  id: string;
  q: string;
  answer: string;
  providerId?: string;
  model?: string;
  ts?: string;
  latencyMs?: number;
  hits?: ReplayHit[];
}

export interface PlayOptions {
  onToken?: (chunk: string) => void;
  charsPerSecond?: number;
  signal?: AbortSignal;
}

/** 把文本切成接近 token 粒度的小块：CJK 一字一块，拉丁按词，标点跟随。 */
export function tokenizeForPlayback(text: string): string[] {
  const pieces = text.match(/[\u3400-\u9fff]|[A-Za-z0-9_'\-]+|[^\u3400-\u9fffA-Za-z0-9_'\-]+/g);
  if (!pieces) return text ? [text] : [];
  const out: string[] = [];
  for (const piece of pieces) {
    if (/^[\u3400-\u9fff]$/.test(piece) || piece.length <= 4) {
      out.push(piece);
    } else {
      for (let i = 0; i < piece.length; i += 4) out.push(piece.slice(i, i + 4));
    }
  }
  return out;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** 按真实节奏逐块吐出。返回实际用时（毫秒）。 */
export async function playText(text: string, opts: PlayOptions = {}): Promise<number> {
  const cps = opts.charsPerSecond && opts.charsPerSecond > 0 ? opts.charsPerSecond : 42;
  const pieces = tokenizeForPlayback(text);
  const started = performance.now();
  let emitted = 0;
  for (const piece of pieces) {
    if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    emitted += piece.length;
    opts.onToken?.(piece);
    const targetMs = (emitted / cps) * 1000;
    const wait = targetMs - (performance.now() - started);
    if (wait > 4) await sleep(Math.min(wait, 120), opts.signal);
  }
  return performance.now() - started;
}

function bigrams(text: string): string[] {
  const clean = text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const out: string[] = [];
  for (let i = 0; i < clean.length - 1; i += 1) out.push(clean.slice(i, i + 2));
  if (!out.length && clean) out.push(clean);
  return out;
}

/** 用字符二元组的 Dice 系数做问题匹配 —— 只走本地，不发网络请求。 */
export function similarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const bag = new Map<string, number>();
  for (const g of A) bag.set(g, (bag.get(g) || 0) + 1);
  let hit = 0;
  for (const g of B) {
    const left = bag.get(g) || 0;
    if (left > 0) {
      hit += 1;
      bag.set(g, left - 1);
    }
  }
  return (2 * hit) / (A.length + B.length);
}

export interface ReplayMatch<T> {
  script: T;
  score: number;
}

export function matchReplay<T extends { q: string }>(scripts: T[], query: string): ReplayMatch<T> | null {
  const q = query.trim();
  if (!q) return null;
  let best: ReplayMatch<T> | null = null;
  for (const script of scripts) {
    const score = similarity(q, script.q);
    if (!best || score > best.score) best = { script, score };
  }
  if (!best || best.score < 0.32) return null;
  return best;
}

/** 给首页/子页推荐几个「一定录过」的示例问题。 */
export function suggestionChips<T extends { q: string }>(scripts: T[], n = 4): string[] {
  return scripts.slice(0, n).map((s) => s.q);
}
