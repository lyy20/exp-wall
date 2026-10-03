// P3 EAP 页数据资产：8 工具契约 / 9 类错误 / 报告台账 / 真实序列 / Python golden / 证据链。
import { asset } from '../shared/asset';

export type ToolParam = { type: string; required?: boolean; enum?: (string | number)[]; desc?: string };
export type ToolContract = {
  name: string; timeout_ms: number; readonly: boolean; idempotent: boolean;
  what: string; when: string; when_not: string; on_fail: string;
  params: Record<string, ToolParam>; returns: string;
};
export type ErrorSpec = {
  code: string; name: string; meaning: string; triggers: string; sample: string; sample_src: string;
  retryable: boolean; max_attempts: number; user_text?: string;
};
export type RunRecord = {
  run_id: string; created?: string; kind?: string; metrics?: Record<string, number | null>;
  verdict?: string; verdict_kind?: string; n?: number; [k: string]: unknown;
};
export type SeriesRec = { run_id: string; metric: string; xs: number[]; ys: number[]; source?: string };
export type GoldenSeries = {
  run_id: string; metric: string; n: number; mean: number; std: number; sem: number;
  median: number; p95: number; first: number; last: number; slope_per_100: number;
};
export type WelchGolden = { a: string; b: string; t: number; df: number; p: number; n_a: number; n_b: number };
export type GoldenFile = { computed_with: string; note: string; series: GoldenSeries[]; welch_tests: WelchGolden[] };
export type Claim = { claim: string; evidence: { file: string; offset: string; kind: string }; n?: number };
export type AuditFile = { run_id: string; source_batch_csv?: string; claims: Claim[] };
export type ReplayFile = { sessions: unknown[]; note?: string };

export type EapAssets = {
  contracts: { source?: Record<string, string>; count: number; tools: ToolContract[] };
  errors: { source?: string; count: number; errors: ErrorSpec[] };
  runs: { source?: string; runs: RunRecord[]; metric_names: string[] };
  series: { source_note?: string; runs: SeriesRec[] };
  golden: GoldenFile;
  audit: AuditFile;
  replay: ReplayFile;
  bytes: Record<string, number>;
};

const FILES = [
  'data/eap/contracts.json', 'data/eap/errors.json', 'data/eap/runs.json', 'data/eap/series.json',
  'data/eap/golden.json', 'data/eap/audit_sample.json', 'data/eap/replay_eap.json',
];

let cache: Promise<EapAssets> | null = null;

export function loadEapAssets(): Promise<EapAssets> {
  if (!cache) cache = load();
  return cache;
}

async function load(): Promise<EapAssets> {
  const bytes: Record<string, number> = {};
  const raws = await Promise.all(FILES.map(async (p) => {
    const r = await fetch(asset(p));
    if (!r.ok) throw new Error('资产 ' + p + ' 加载失败：HTTP ' + r.status);
    const buf = await r.arrayBuffer();
    bytes[p.replace('data/eap/', '')] = buf.byteLength;
    return JSON.parse(new TextDecoder('utf-8').decode(buf));
  }));
  const [contracts, errors, runs, series, golden, audit, replay] = raws as [
    EapAssets['contracts'], EapAssets['errors'], EapAssets['runs'], EapAssets['series'],
    GoldenFile, AuditFile, ReplayFile,
  ];
  return { contracts, errors, runs, series, golden, audit, replay, bytes };
}

/* ---------- 契约校验：复刻工具调用门禁（参数表 + 枚举 + 循环控制） ---------- */

export type ValidateResult = { ok: boolean; code?: string; message: string; detail?: string };

const TYPE_MAP: Record<string, string> = { str: 'string', int: 'number', number: 'number', float: 'number', bool: 'boolean' };

export function sampleArgs(contract: ToolContract): Record<string, unknown> {
  const hints: Record<string, unknown> = {
    run_id: '20260915_172805', baseline_run_id: '20260913_182700', candidate_run_ids: ['20260915_172805'],
    metric: 'reward_sum', metrics: ['reward_sum', 'success'], query: 'USV 避碰 内部化', exp_id: 'exp-0001',
    uri: 'reports/index.sqlite', reasoning: 'n=100 下未观察到显著差异', path: 'reports/L1-20260915.md',
    idempotency_key: 'k-20260915-l1', reason_code: 'DATA_QUALITY', max_bytes: 65536, top_k: 3, min_n: 3,
    step_range: '0-99', max_points: 200, paired: 1, record: {}, rows: [],
  };
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(contract.params ?? {})) {
    if (p.required) {
      if (k in hints) { out[k] = hints[k]; continue; }
      if (p.enum && p.enum.length) { out[k] = p.enum[0]; continue; }
      out[k] = p.type === 'int' || p.type === 'number' ? 1 : p.type === 'bool' ? true : '示例';
    }
  }
  return out;
}

export function validateCall(contract: ToolContract, args: unknown): ValidateResult {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, code: 'BAD_ARGUMENT', message: '[BAD_ARGUMENT] 参数必须是 JSON 对象（键值对）' };
  }
  const a = args as Record<string, unknown>;
  const params = contract.params ?? {};
  for (const k of Object.keys(a)) {
    if (!(k in params)) {
      return {
        ok: false, code: 'BAD_ARGUMENT',
        message: '[BAD_ARGUMENT] 参数 ' + k + ' 不在 ' + contract.name + ' 的契约声明中',
        detail: '契约只声明了：' + Object.keys(params).join(', ') + '。冗余字段会被门禁拒绝，避免模型自由发挥。',
      };
    }
  }
  for (const [k, p] of Object.entries(params)) {
    if (p.required && !(k in a)) {
      return { ok: false, code: 'BAD_ARGUMENT', message: '[BAD_ARGUMENT] 缺少必填参数 ' + k + '（' + p.type + '）', detail: p.desc };
    }
  }
  for (const [k, p] of Object.entries(params)) {
    if (!(k in a)) continue;
    const v = a[k];
    const want = TYPE_MAP[p.type] ?? 'any';
    if (want !== 'any' && typeof v !== want) {
      return { ok: false, code: 'BAD_ARGUMENT', message: '[BAD_ARGUMENT] 参数 ' + k + ' 类型错误：收到 ' + typeof v + '，契约要求 ' + p.type, detail: p.desc };
    }
    if (p.enum && p.enum.length && !p.enum.includes(v as string | number)) {
      return {
        ok: false, code: 'BAD_ARGUMENT',
        message: '[BAD_ARGUMENT] 枚举越界：' + k + ' = ' + JSON.stringify(v) + ' 不在 [' + p.enum.join(' | ') + '] 中',
        detail: '枚举是「收缩模型猜测空间」的手段（契约规范 §1）；越界值不会被静默纠正。',
      };
    }
  }
  return { ok: true, message: '参数通过契约校验：' + contract.name + ' 将按 ' + contract.timeout_ms + ' ms 超时预算执行' };
}

export function loopControlMessage(name: string, n: number): string {
  return '[BAD_ARGUMENT] 检测到重复调用：' + name + ' 以相同参数被调用 ' + n + ' 次';
}

export function fmtBytes(n?: number): string {
  if (!n) return '—';
  return n >= 1024 * 1024 ? (n / 1048576).toFixed(2) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';
}
