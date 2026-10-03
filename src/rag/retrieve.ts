// RAG 检索算子：逐行等价复刻项目 Python 侧实现（code/_build_rag_assets.py + rag-demo/config.py）。
// 浏览器内真跑：CJK bigram 分词 -> BM25(过滤倒排) -> int8 去量化稠密内积 -> RRF(k=60) 融合 -> top5。

export type Chunk = { id: string; doc: string; page: number; text: string };
export type Bm25Index = {
  k1: number; b: number; N: number; avgdl: number;
  df: Record<string, number>; post: Record<string, number[]>;
  docLen: number[]; idf: Record<string, number>;
};
export type Scored = { idx: number; score: number };

const LATIN_NUM = /[A-Za-z][A-Za-z0-9\-]*|\d+(?:\.\d+)?/g;
const CJK_RUN = /[\u4e00-\u9fff]+/g;

/** 与 config.py:357-374 / tokenize() 逐字一致：拉丁数字词 + CJK 二元组 */
export function tokenize(text: string): string[] {
  const low = text.toLowerCase();
  const toks: string[] = low.match(LATIN_NUM) ?? [];
  for (const run of low.match(CJK_RUN) ?? []) {
    if (run.length === 1) toks.push(run);
    else for (let i = 0; i + 2 <= run.length; i++) toks.push(run.slice(i, i + 2));
  }
  return toks;
}

/** BM25Okapi 打分：idf[q]*(f*(k1+1))/(f+k1*(1-b+b*dl/avgdl))，累加到 doc */
export function bm25Scores(qtoks: string[], bm: Bm25Index): Float64Array {
  const s = new Float64Array(bm.N);
  const { k1, b, avgdl, docLen, idf, post } = bm;
  for (const q of qtoks) {
    const iq = idf[q];
    if (iq === undefined) continue;
    const flat = post[q];
    if (!flat) continue;
    for (let j = 0; j < flat.length; j += 2) {
      const d = flat[j], f = flat[j + 1];
      s[d] += iq * (f * (k1 + 1)) / (f + k1 * (1 - b + b * docLen[d] / avgdl));
    }
  }
  return s;
}

/** 稳定降序 top-k（同分按索引升序），与 np.argsort(-s, kind='stable') 等价 */
function stableTopK(scores: ArrayLike<number>, topK: number, minExclusive: number | null): Scored[] {
  const n = scores.length;
  const order = new Array<number>(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => (scores[b] - scores[a]) || (a - b));
  const out: Scored[] = [];
  for (let i = 0; i < n && out.length < topK; i++) {
    const v = scores[order[i]];
    if (minExclusive !== null && !(v > minExclusive)) continue;
    out.push({ idx: order[i], score: v });
  }
  return out;
}

/** 稠密检索：库向量 int8 去量化后与查询向量做内积（= 余弦，双方均已 L2 归一化） */
export function denseTopK(q: Float32Array, vecs: Int8Array, rowScale: Float32Array, dim: number, topK: number): Scored[] {
  const n = rowScale.length;
  const sims = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const off = i * dim;
    let s = 0;
    for (let j = 0; j < dim; j++) s += q[j] * vecs[off + j];
    sims[i] = s * rowScale[i];
  }
  return stableTopK(sims, topK, null);
}

/** 稀疏检索：BM25 打分，只保留 score>0 */
export function sparseTopK(qtoks: string[], bm: Bm25Index, topK: number): Scored[] {
  return stableTopK(bm25Scores(qtoks, bm), topK, 0);
}

/** RRF 融合（retrieve.py:215-239 等价）：1/(k+rank) 累加，稳定降序，截 top_k */
export function rrfFuse(lists: number[][], k: number, topK: number): Scored[] {
  const agg = new Map<number, number>();
  for (const hits of lists) {
    for (let r = 0; r < hits.length; r++) {
      const idx = hits[r];
      agg.set(idx, (agg.get(idx) ?? 0) + 1 / (k + r + 1));
    }
  }
  const arr: Scored[] = [...agg.entries()].map(([idx, score]) => ({ idx, score }));
  arr.sort((a, b) => b.score - a.score);
  return arr.slice(0, topK);
}

export type Stages = {
  dense: Scored[]; sparse: Scored[]; fused: Scored[]; final: Scored[]; tokens: string[];
};

/** 完整管线：dense + sparse -> RRF -> 取前 finalK */
export function retrieve(
  qVector: Float32Array, query: string,
  vecs: Int8Array, rowScale: Float32Array, dim: number, bm: Bm25Index,
  cfg: { denseTopK: number; sparseTopK: number; rrfK: number; fusedTopK: number; finalK: number },
): Stages {
  const dense = denseTopK(qVector, vecs, rowScale, dim, cfg.denseTopK);
  const tokens = tokenize(query);
  const sparse = sparseTopK(tokens, bm, cfg.sparseTopK);
  // 两路门控（retrieve.py:288-336，SPARSE_MODE="overlap"，sparse_overlap_min=2）：dense_top20 与 sparse_top20 的
  // 交集 < 2 时退化为纯 dense 前 20 —— 与 Python 侧逐位一致，否则个别题的 rank 会与基线不符。
  const denseSet = new Set(dense.map((d) => d.idx));
  let overlap = 0;
  for (const s of sparse) if (denseSet.has(s.idx)) overlap++;
  const lists = [dense.map((d) => d.idx)];
  if (sparse.length && overlap >= 2) lists.push(sparse.map((s) => s.idx));
  const fused = rrfFuse(lists, cfg.rrfK, cfg.fusedTopK);
  return { dense, sparse, fused, final: fused.slice(0, cfg.finalK), tokens };
}

/** recall@5 / MRR（首个命中 gt 的 1/rank，未命中 0），与 Python evaluate() 口径一致 */
export function scoreOne(finalIdx: number[], gold: Set<number>): { rank: number; recall5: number; rr: number } {
  let rank = 0;
  for (let i = 0; i < finalIdx.length; i++) if (gold.has(finalIdx[i])) { rank = i + 1; break; }
  return { rank, recall5: rank > 0 && rank <= 5 ? 1 : 0, rr: rank ? 1 / rank : 0 };
}

export const pct = (x: number) => (x * 100).toFixed(2) + '%';
export const f3 = (x: number) => x.toFixed(3);
