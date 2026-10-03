// RAG 页数据资产加载：从 public/data/rag/ 取真实资产，懒加载 + 会话内缓存。
import { asset } from '../shared/asset';
import type { Bm25Index, Chunk } from './retrieve';

export type RagConfig = {
  top_k: number; candidates: number; rrf_k: number; embed_model: string; rerank_model: string;
  embed_dim: number; chunk_chars: number; dense_top_k: number; sparse_top_k: number;
  fused_top_k: number; rerank_top_n: number; overlap_chars: number; min_chunk_chars: number;
  sparse_mode: string; refuse_threshold: number; llm_model: string;
  corpus_chunks: number; corpus_docs: number; asset_chunks: number; [k: string]: unknown;
};

export type VectorsMeta = { count: number; dim: number; dtype: string; ids: string[]; row_scale: number[]; norm: number[] };
export type EvalQuestion = { id: string; q: string; type: string; expected?: string; gt: { id: string; doc?: string }[]; py_recall5?: number; py_mrr?: number; py_rank?: number };
export type EvalFile = { questions: EvalQuestion[]; items: EvalQuestion[]; _python_baseline: Record<string, unknown> & { 'recall@5': number; mrr: number; note?: string; subset?: number; query_tokens_filtered_pct?: number; full_corpus_ref?: { 'recall@5'?: number; mrr?: number; note?: string } } };
export type QueryVectorFile = { model: string; dim: number; dtype: string; items: { q: string; id?: string; vec: string; scale?: number }[] };

export type RagAssets = {
  config: RagConfig;
  chunks: Chunk[];
  vecs: Int8Array;
  meta: VectorsMeta;
  rowScale: Float32Array;
  bm25: Bm25Index;
  evalFile: EvalFile;
  queryVectors: QueryVectorFile | null;
  bytes: Record<string, number>;
};

async function getJson<T>(p: string): Promise<{ data: T; bytes: number }> {
  const r = await fetch(asset(p));
  if (!r.ok) throw new Error('资产 ' + p + ' 加载失败：HTTP ' + r.status);
  const buf = await r.arrayBuffer();
  return { data: JSON.parse(new TextDecoder('utf-8').decode(buf)) as T, bytes: buf.byteLength };
}

async function getBin(p: string): Promise<{ data: ArrayBuffer; bytes: number }> {
  const r = await fetch(asset(p));
  if (!r.ok) throw new Error('资产 ' + p + ' 加载失败：HTTP ' + r.status);
  const buf = await r.arrayBuffer();
  return { data: buf, bytes: buf.byteLength };
}

const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && isFinite(Number(v)) ? Number(v) : d);

let cache: Promise<RagAssets> | null = null;

export function loadRagAssets(): Promise<RagAssets> {
  if (!cache) cache = load();
  return cache;
}

async function load(): Promise<RagAssets> {
  const bytes: Record<string, number> = {};
  const [cfg, ch, meta, bin, bm, ev] = await Promise.all([
    getJson<RagConfig>('data/rag/config.json'),
    getJson<Chunk[]>('data/rag/chunks.json'),
    getJson<VectorsMeta>('data/rag/vectors_meta.json'),
    getBin('data/rag/vectors.bin'),
    getJson<Bm25Index>('data/rag/bm25.json'),
    getJson<EvalFile>('data/rag/eval.json'),
  ]);
  bytes['config.json'] = cfg.bytes; bytes['chunks.json'] = ch.bytes; bytes['vectors_meta.json'] = meta.bytes;
  bytes['vectors.bin'] = bin.bytes; bytes['bm25.json'] = bm.bytes; bytes['eval.json'] = ev.bytes;
  const norm: RagConfig = {
    ...cfg.data,
    top_k: num(cfg.data.top_k, 5), candidates: num(cfg.data.candidates, 20), rrf_k: num(cfg.data.rrf_k, 60),
    embed_dim: num(cfg.data.embed_dim, 1024), dense_top_k: num(cfg.data.dense_top_k, 20), sparse_top_k: num(cfg.data.sparse_top_k, 20),
    fused_top_k: num(cfg.data.fused_top_k, 20), rerank_top_n: num(cfg.data.rerank_top_n, 5),
    corpus_chunks: num(cfg.data.corpus_chunks, 0), corpus_docs: num(cfg.data.corpus_docs, 0), asset_chunks: num(cfg.data.asset_chunks, 0),
  };
  const bm25: Bm25Index = {
    k1: num(bm.data.k1, 1.5), b: num(bm.data.b, 0.75), N: num(bm.data.N, 0), avgdl: num(bm.data.avgdl, 0),
    df: bm.data.df, post: bm.data.post, docLen: bm.data.docLen, idf: bm.data.idf,
  };
  let qv: QueryVectorFile | null = null;
  try { const q = await getJson<QueryVectorFile>('data/rag/query_vectors.json'); qv = q.data; bytes['query_vectors.json'] = q.bytes; } catch { qv = null; }
  return {
    config: norm, chunks: ch.data, vecs: new Int8Array(bin.data), meta: meta.data,
    rowScale: Float32Array.from(meta.data.row_scale), bm25, evalFile: ev.data, queryVectors: qv, bytes,
  };
}

/** base64 -> Float32Array（小端），用于预计算查询向量 */
export function f32FromBase64(b64: string): Float32Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4);
}

/** 模糊匹配预计算问题（字符二元组 Dice），用于零配置时挑查询向量 */
export function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const t = s.toLowerCase().replace(/\s+/g, '');
    const out: string[] = [];
    for (let i = 0; i + 2 <= t.length; i++) out.push(t.slice(i, i + 2));
    return out.length ? out : [t];
  };
  const ga = grams(a), gb = grams(b);
  const map = new Map<string, number>();
  for (const g of ga) map.set(g, (map.get(g) ?? 0) + 1);
  let inter = 0;
  for (const g of gb) { const c = map.get(g) ?? 0; if (c > 0) { inter++; map.set(g, c - 1); } }
  return (2 * inter) / (ga.length + gb.length);
}

export function findQueryVector(assets: RagAssets, question: string): { item: QueryVectorFile['items'][number]; sim: number } | null {
  const items = assets.queryVectors?.items ?? [];
  let best: { item: QueryVectorFile['items'][number]; sim: number } | null = null;
  for (const it of items) {
    const s = similarity(question, it.q);
    if (!best || s > best.sim) best = { item: it, sim: s };
  }
  return best;
}
