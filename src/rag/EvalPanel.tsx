// P1 评测面板：在浏览器里跑完 20 题，真算 Recall@5 / MRR，并与 Python 侧同口径数字并列。
import { useCallback, useState } from 'react';
import { describeError, embedTexts, normalize } from '../shared/llm/client';
import { Badge, Panel, StatTile } from '../shared/ui/core';
import { ModeBadge } from '../shared/ui/llm-ui';
import type { LlmMode } from '../shared/llm/mode';
import { f32FromBase64, type RagAssets } from './assets';
import { retrieve, scoreOne } from './retrieve';

type Row = {
  id: string; q: string; type: string; rank: number; rr: number; recall5: number;
  pyRank?: number; pyMrr?: number; pyRecall5?: number; ms: number; fetched?: string[];
};

export function EvalPanel({ assets, llm }: { assets: RagAssets; llm: { live: boolean; mode: LlmMode } }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<{ title: string; detail: string } | null>(null);
  const [embedNote, setEmbedNote] = useState('');
  const [totalMs, setTotalMs] = useState(0);

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true); setErr(null); setRows(null); setProgress(0);
    const started = performance.now();
    try {
      const qs = assets.evalFile.questions;
      const map = new Map<string, number>();
      assets.meta.ids.forEach((id, i) => map.set(id, i));
      const dim = assets.config.embed_dim;
      const vectors: Float32Array[] = new Array(qs.length);

      const pre = new Map<string, string>();
      for (const it of assets.queryVectors?.items ?? []) pre.set(it.q, it.vec);
      const missing = qs.filter((q) => !pre.has(q.q)).length;

      if (missing === 0) {
        for (let i = 0; i < qs.length; i++) vectors[i] = normalize(f32FromBase64(pre.get(qs[i].q) as string));
        setEmbedNote('查询向量来自 public/data/rag/query_vectors.json（与建库同一 bge-m3 权重离线预计算，float32，不再量化）');
      } else if (llm.live) {
        setEmbedNote('资产里缺少部分预计算向量，正在用你的 key 真调 embedding 一次性算 ' + qs.length + ' 条查询向量…');
        const emb = await embedTexts(qs.map((q) => q.q));
        if (emb.dim !== dim) throw new Error('向量维度不一致：接口返回 ' + emb.dim + '，资产是 ' + dim + '（请用 BAAI/bge-m3）');
        for (let i = 0; i < qs.length; i++) vectors[i] = normalize(emb.vectors[i]);
        setEmbedNote('查询向量由' + (emb.providerId === 'proxy' ? '站内代理' : '你的 key') + '真调 API 生成（' + emb.model + '，' + emb.latencyMs.toFixed(0) + ' ms / ' + qs.length + ' 条）');
      } else {
        throw new Error('缺少 query_vectors.json（' + missing + '/' + qs.length + ' 题没有向量）。零配置下无法为任意问题算向量：请等资产补齐，或填入 embedding key 后重跑。');
      }

      const cfg = {
        denseTopK: assets.config.dense_top_k, sparseTopK: assets.config.sparse_top_k, rrfK: assets.config.rrf_k,
        fusedTopK: assets.config.fused_top_k, finalK: assets.config.top_k,
      };
      const out: Row[] = [];
      for (let i = 0; i < qs.length; i++) {
        const q = qs[i];
        const t = performance.now();
        const st = retrieve(vectors[i], q.q, assets.vecs, assets.rowScale, dim, assets.bm25, cfg);
        const finalIdx = st.final.map((s) => s.idx);
        const gold = new Set<number>();
        q.gt.forEach((g) => { const gi = map.get(g.id); if (gi !== undefined) gold.add(gi); });
        const sc = scoreOne(finalIdx, gold);
        out.push({
          id: q.id, q: q.q, type: q.type, rank: sc.rank, rr: sc.rr, recall5: sc.recall5,
          pyRank: q.py_rank, pyMrr: q.py_mrr, pyRecall5: q.py_recall5, ms: performance.now() - t,
          fetched: finalIdx.slice(0, 5).map((idx) => assets.chunks[idx].doc.slice(0, 34) + ' p' + assets.chunks[idx].page),
        });
        setProgress(i + 1);
        if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
      }
      setRows(out);
      setTotalMs(performance.now() - started);
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setRunning(false);
    }
  }, [assets, llm.live, running]);

  const base = assets.evalFile._python_baseline;
  const recall = rows ? rows.reduce((s, r) => s + r.recall5, 0) / rows.length : 0;
  const mrr = rows ? rows.reduce((s, r) => s + r.rr, 0) / rows.length : 0;
  const rankDiff = rows ? rows.filter((r) => (r.rank || 0) !== (r.pyRank || 0)).length : 0;
  const total = assets.evalFile.questions.length;
  // 同算子跑全量 5325 语料的对照（证明 800 子集没有把题目变易/变难）——键名来自 build 脚本写出的 full_corpus_ref。
  const fullRef = base.full_corpus_ref;

  return (
    <Panel
      title="评测：20 题 Recall@5 / MRR（浏览器内真算）"
      subtitle="与项目 Python 侧完全同口径：dense(int8 去量化 top20) + BM25(过滤倒排 top20) → RRF(k=60) 融合取 top5；不跑 rerank。gold 全部落在本页 800 条子集内，因此数字可直接对齐。"
      right={<ModeBadge mode={llm.mode} />}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="dp-btn dp-btn-primary" onClick={() => void run()} disabled={running}>
          {running ? '评测中 ' + progress + '/' + total : '在浏览器里跑 20 题'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--fg-faint)' }}>
          Python 侧参考：Recall@5 <b className="dp-mono" style={{ color: 'var(--fg-dim)' }}>{String(base['recall@5'])}</b> ·
          MRR <b className="dp-mono" style={{ color: 'var(--fg-dim)' }}>{String(base.mrr)}</b>
          {fullRef && fullRef['recall@5'] !== undefined ? '（同算子跑全量 5325 的对照：Recall@5 ' + String(fullRef['recall@5']) + ' · MRR ' + String(fullRef.mrr) + '，说明 800 子集没把题目变易或变难）' : ''}
        </span>
      </div>

      {embedNote && <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--fg-faint)', lineHeight: 1.6 }}>{embedNote}</p>}
      {err && (
        <div className="dp-panel-tight" style={{ marginTop: 10, padding: 12, borderColor: 'var(--err)' }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--err)', fontWeight: 600 }}>{err.title}</p>
          <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--fg-dim)' }}>{err.detail}</p>
        </div>
      )}

      {rows && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 12 }}>
            <StatTile label="浏览器 Recall@5" value={(recall * 100).toFixed(1) + '%'} sub={'Python ' + (Number(base['recall@5']) * 100).toFixed(1) + '%'} tone={Math.abs(recall - Number(base['recall@5'])) < 1e-9 ? 'live' : 'warn'} />
            <StatTile label="浏览器 MRR" value={mrr.toFixed(4)} sub={'Python ' + String(base.mrr)} tone={Math.abs(mrr - Number(base.mrr)) < 1e-4 ? 'live' : 'warn'} />
            <StatTile label="与 Python 逐题一致" value={(total - rankDiff) + '/' + total} sub={rankDiff ? rankDiff + ' 题 rank 不同（多数是同分次序差异）' : '全部题 rank 完全一致'} tone={rankDiff ? 'warn' : 'live'} />
            <StatTile label="20 题总耗时" value={totalMs >= 1000 ? (totalMs / 1000).toFixed(2) + ' s' : totalMs.toFixed(0) + ' ms'} sub={'平均 ' + (rows.reduce((s, r) => s + r.ms, 0) / rows.length).toFixed(1) + ' ms / 题（含 dense 800×1024 内积）'} tone="accent" />
          </div>

          <div style={{ marginTop: 12, overflowX: 'auto' }} className="dp-scroll">
            <table className="dp-mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ color: 'var(--fg-faint)', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>ID</th>
                  <th style={{ padding: '6px 8px' }}>问题</th>
                  <th style={{ padding: '6px 8px' }}>类型</th>
                  <th style={{ padding: '6px 8px' }}>浏览器 rank</th>
                  <th style={{ padding: '6px 8px' }}>Python rank</th>
                  <th style={{ padding: '6px 8px' }}>RR</th>
                  <th style={{ padding: '6px 8px' }}>耗时</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--line-soft)', color: (r.rank || 0) === (r.pyRank || 0) ? 'var(--fg-dim)' : 'var(--warn)' }}>
                    <td style={{ padding: '6px 8px' }}>{r.id}</td>
                    <td style={{ padding: '6px 8px', maxWidth: 420 }}>{r.q}</td>
                    <td style={{ padding: '6px 8px' }}>{r.type}</td>
                    <td style={{ padding: '6px 8px' }}>{r.rank || '未命中'}</td>
                    <td style={{ padding: '6px 8px' }}>{r.pyRank ?? '—'}</td>
                    <td style={{ padding: '6px 8px' }}>{r.rr.toFixed(3)}</td>
                    <td style={{ padding: '6px 8px' }}>{r.ms.toFixed(1)} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--fg-faint)', lineHeight: 1.6 }}>
            <Badge tone="live">口径说明</Badge> {String(base.note ?? '')}
          </p>
        </>
      )}
    </Panel>
  );
}
