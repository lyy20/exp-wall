// P2 资产加载：全部来自项目真实导出（public/data/yyhelp/）。
import { asset } from '../shared/asset';

export interface YyRule { intent: string; pattern: string; weight: number }
export interface YyIntent { name: string; desc: string; exit: string }
export interface YyExit { id: string; name: string; desc: string; needs_kb: boolean; node: string }
export interface IntentsFile {
  source?: { file?: string; lines?: string; exit_file?: string };
  intents: YyIntent[];
  exits: YyExit[];
  router_prompt?: string;
  coref_prompt?: string;
  router_impl: {
    kind: string; rule_threshold: number; rule_note: string; llm: string;
    fallback: { with_llm: string; without_llm: string };
    rules: YyRule[]; should_abstain: string[]; exit_needs_kb: Record<string, boolean>;
  };
}
export interface YyToolParam { type?: string; required?: boolean; desc?: string; default?: unknown }
export interface YyTool {
  name: string; desc: string; params: Record<string, YyToolParam>; returns: unknown;
  fixture_hint?: string; args_model?: unknown; side_effect: string; idempotent?: boolean;
  parallel?: boolean; error_kinds?: string; max_observation_chars?: number;
  error_kinds_table?: Record<string, boolean>; fixture_source?: string;
}
export interface YyOrder {
  order_no: string; user_id: string; status: string; status_cn: string; total_amount: number;
  created_at: string; tracking_no: string; refundable: boolean;
  items: { sku: string; name: string; qty: number }[];
  events: { time: string; node: string; city: string }[];
  _extended?: boolean; source?: string;
}
export interface YyPolicy { topic: string; rule: string; source: string; kind?: string }
export interface YyKbChunk { id: string; title: string; text: string; source: string; kind?: string; heading_path?: string[] }
export interface YyKbMeta { count: number; dim: number; dtype: string; ids: string[]; row_scale: number[]; norm?: number[] }
export interface YyTurn {
  role: 'user' | 'tool' | 'assistant'; text?: string; ts?: string; seq?: number;
  tool?: string; args?: Record<string, unknown>; result?: string; note?: string;
}
export interface YyConv { id: string; title: string; turns: YyTurn[]; source?: string; exit?: string; intent?: string; note?: string }
export interface YyAssets {
  config: Record<string, unknown>; intents: IntentsFile; tools: YyTool[]; policy: YyPolicy[];
  orders: YyOrder[]; kb: YyKbChunk[]; kbVecs: Int8Array; kbMeta: YyKbMeta; kbScale: Float32Array;
  replay: YyConv[]; bytes: Record<string, number>;
}

async function fetchJson<T>(path: string): Promise<{ data: T; bytes: number }> {
  const res = await fetch(asset(path));
  if (!res.ok) throw new Error('HTTP ' + res.status + ' · ' + path);
  const text = await res.text();
  return { data: JSON.parse(text) as T, bytes: new TextEncoder().encode(text).length };
}

async function fetchBin(path: string): Promise<{ data: ArrayBuffer; bytes: number }> {
  const res = await fetch(asset(path));
  if (!res.ok) throw new Error('HTTP ' + res.status + ' · ' + path);
  const buf = await res.arrayBuffer();
  return { data: buf, bytes: buf.byteLength };
}

export function cnum(v: unknown, d = 0): number { const n = Number(v); return Number.isFinite(n) ? n : d; }

export async function loadYyAssets(): Promise<YyAssets> {
  const [config, intents, tools, policy, orders, kb, kbMeta, bin, replayRaw] = await Promise.all([
    fetchJson<Record<string, unknown>>('data/yyhelp/config.json'),
    fetchJson<IntentsFile>('data/yyhelp/intents.json'),
    fetchJson<YyTool[]>('data/yyhelp/tools.json'),
    fetchJson<YyPolicy[]>('data/yyhelp/policy.json'),
    fetchJson<YyOrder[]>('data/yyhelp/orders.json'),
    fetchJson<YyKbChunk[]>('data/yyhelp/kb.json'),
    fetchJson<YyKbMeta>('data/yyhelp/kb_vectors_meta.json'),
    fetchBin('data/yyhelp/kb_vectors.bin'),
    fetchJson<Record<string, YyConv>>('data/yyhelp/replay_chat.json'),
  ]);
  const bytes: Record<string, number> = {
    'config.json': config.bytes, 'intents.json': intents.bytes, 'tools.json': tools.bytes,
    'policy.json': policy.bytes, 'orders.json': orders.bytes, 'kb.json': kb.bytes,
    'kb_vectors_meta.json': kbMeta.bytes, 'kb_vectors.bin': bin.bytes, 'replay_chat.json': replayRaw.bytes,
  };
  const replay = Object.keys(replayRaw.data)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => replayRaw.data[k]);
  return {
    config: config.data, intents: intents.data, tools: tools.data, policy: policy.data,
    orders: orders.data, kb: kb.data, kbVecs: new Int8Array(bin.data), kbMeta: kbMeta.data,
    kbScale: Float32Array.from(kbMeta.data.row_scale ?? []), replay, bytes,
  };
}

/** 去量化第 i 行 int8 向量：x = Vq * row_scale[i]（与 Python 侧一致）。 */
export function dequantRow(vecs: Int8Array, scale: Float32Array, i: number, dim: number): Float32Array {
  const out = new Float32Array(dim);
  const off = i * dim;
  for (let j = 0; j < dim; j++) out[j] = vecs[off + j] * scale[i];
  return out;
}

export function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}
