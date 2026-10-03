/**
 * 浏览器内的确定性统计：与 Python(scipy/numpy) 口径一致，用于真计算与自检。
 * 全部为纯函数、无随机副作用（bootstrap 用可复现的 seeded PRNG）。
 */

export function mean(xs: readonly number[]): number {
  if (!xs.length) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function variance(xs: readonly number[], ddof = 1): number {
  const n = xs.length;
  if (n - ddof <= 0) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / (n - ddof);
}

export function std(xs: readonly number[], ddof = 1): number {
  return Math.sqrt(variance(xs, ddof));
}

export function sem(xs: readonly number[]): number {
  return std(xs, 1) / Math.sqrt(xs.length);
}

export function sorted(xs: readonly number[]): number[] {
  return xs.slice().sort((a, b) => a - b);
}

export function median(xs: readonly number[]): number {
  return quantile(xs, 0.5);
}

/** 与 numpy.percentile 默认（linear）一致 */
export function quantile(xs: readonly number[], q: number): number {
  if (!xs.length) return NaN;
  const a = sorted(xs);
  if (a.length === 1) return a[0];
  const pos = (a.length - 1) * Math.min(Math.max(q, 0), 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

export function minOf(xs: readonly number[]): number {
  return xs.reduce((acc, x) => (x < acc ? x : acc), Infinity);
}

export function maxOf(xs: readonly number[]): number {
  return xs.reduce((acc, x) => (x > acc ? x : acc), -Infinity);
}

export function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const den = Math.sqrt(sxx * syy);
  return den === 0 ? NaN : sxy / den;
}

export interface LinReg {
  slope: number;
  intercept: number;
  r2: number;
}

export function linreg(xs: readonly number[], ys: readonly number[]): LinReg {
  const n = Math.min(xs.length, ys.length);
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) * (xs[i] - mx);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const r = pearson(xs, ys);
  return { slope, intercept, r2: Number.isNaN(r) ? NaN : r * r };
}

/* ---------- t 分布 ---------- */

function logGamma(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2,
    -0.5395239384953e-5,
  ];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j += 1) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** 正则化不完全贝塔函数 I_x(a,b) */
export function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

export interface Welch {
  t: number;
  df: number;
  p: number;
  meanA: number;
  meanB: number;
  diff: number;
}

/** Welch 双样本 t 检验（不等方差，双侧 p 值，与 scipy.stats.ttest_ind(equal_var=False) 一致） */
export function welchT(a: readonly number[], b: readonly number[]): Welch {
  const n1 = a.length;
  const n2 = b.length;
  const m1 = mean(a);
  const m2 = mean(b);
  const v1 = variance(a, 1);
  const v2 = variance(b, 1);
  const se2 = v1 / n1 + v2 / n2;
  const se = Math.sqrt(se2);
  const t = se === 0 ? 0 : (m1 - m2) / se;
  const df = (se2 * se2) / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1));
  const p = betai(df / 2, 0.5, df / (df + t * t));
  return { t, df, p, meanA: m1, meanB: m2, diff: m1 - m2 };
}

/** 可复现随机数（bootstrap 自检需要确定性） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type StatName = 'mean' | 'median' | 'std';

export interface BootstrapResult {
  stat: StatName;
  point: number;
  lo: number;
  hi: number;
  level: number;
  iters: number;
  seed: number;
}

export function bootstrapCI(
  xs: readonly number[],
  opts: { stat?: StatName; level?: number; iters?: number; seed?: number } = {},
): BootstrapResult {
  const stat: StatName = opts.stat || 'mean';
  const level = opts.level ?? 0.95;
  const iters = opts.iters ?? 2000;
  const seed = opts.seed ?? 42;
  const rnd = mulberry32(seed);
  const fn = (v: number[]) => (stat === 'mean' ? mean(v) : stat === 'median' ? median(v) : std(v, 1));
  const n = xs.length;
  const draws: number[] = [];
  for (let i = 0; i < iters; i += 1) {
    const sample: number[] = new Array(n);
    for (let j = 0; j < n; j += 1) sample[j] = xs[Math.floor(rnd() * n)];
    draws.push(fn(sample));
  }
  const alpha = (1 - level) / 2;
  return {
    stat,
    point: fn(xs.slice()),
    lo: quantile(draws, alpha),
    hi: quantile(draws, 1 - alpha),
    level,
    iters,
    seed,
  };
}

export function fmt(x: number, digits = 3): string {
  if (!Number.isFinite(x)) return '—';
  if (x !== 0 && Math.abs(x) < 10 ** -digits) return x.toExponential(2);
  return x.toFixed(digits);
}

export function fmtInt(x: number): string {
  return Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : '—';
}
