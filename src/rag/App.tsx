// P1 RAG 页：真检索（浏览器内 int8 稠密 + BM25 + RRF）+ 真评测 + 真调模型 / 零配置回放。
import { useEffect, useState } from 'react';
import { asset } from '../shared/asset';
import { useLlm } from '../shared/llm/useLlm';
import { Badge, CodeBlock, Footer, KeyValue, PageShell, Panel, StatTile, SubHeader } from '../shared/ui/core';
import { KeyBar } from '../shared/ui/llm-ui';
import { AskPanel, type RagReplayItem } from './AskPanel';
import { EvalPanel } from './EvalPanel';
import { loadRagAssets, type RagAssets } from './assets';

function fmtBytes(n?: number): string {
  if (!n) return '—';
  return n >= 1024 * 1024 ? (n / 1048576).toFixed(2) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';
}

export function App() {
  const llm = useLlm('deepseek');
  const [assets, setAssets] = useState<RagAssets | null>(null);
  const [err, setErr] = useState<{ title: string; detail: string } | null>(null);
  const [replay, setReplay] = useState<RagReplayItem[]>([]);
  const [replayNote, setReplayNote] = useState('正在载入录制问答…');

  useEffect(() => {
    let alive = true;
    loadRagAssets()
      .then((a) => { if (alive) setAssets(a); })
      .catch((e) => { if (alive) setErr({ title: '数据资产加载失败', detail: String((e as Error)?.message ?? e) }); });
    fetch(asset('data/rag/replay_rag.json'))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((j) => {
        if (!alive) return;
        const items: RagReplayItem[] = Array.isArray(j) ? j : Array.isArray(j?.items) ? j.items : Array.isArray(j?.sessions) ? j.sessions : [];
        setReplay(items);
        setReplayNote(items.length ? '已载入 ' + items.length + ' 条录制问答（零配置时按真实节奏逐字回放，并标注录制时间与原始延迟）' : '该项目日志里没有留下模型原始输出，因此本页没有可回放的问答：零配置下仍可跑真检索与真评测，实时生成需要你自己的 key。');
      })
      .catch(() => { if (alive) { setReplay([]); setReplayNote('录制问答资产缺失（replay_rag.json 未就绪）。'); } });
    return () => { alive = false; };
  }, []);

  const cfg = assets?.config;

  return (
    <PageShell>
      <SubHeader
        kicker="Demo 03 · 应用层"
        title="科研文献 RAG 问答平台"
        subtitle="55 篇论文 / 5325 chunk 的真实语料上，把「分词 → BM25 → 去量化向量内积 → RRF 融合 → 精排 → 生成」整条链路拆开给你看：检索与评测算子在浏览器里真跑，embedding 与生成真调接口。"
        right={<Badge tone="live">真跑 · 可自查</Badge>}
      />

      <div className="dp-wrap" style={{ paddingBottom: 60, display: 'grid', gap: 16 }}>
        <Panel
          title="先看边界：什么在真跑，什么没做"
          subtitle="演示的价值在于每一步都能被验证，所以这里先把话说清楚。"
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <div className="dp-panel-tight" style={{ padding: 14 }}>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--live)', fontWeight: 700, letterSpacing: '0.06em' }}>真跑（可现场复现）</p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.85, color: 'var(--fg-dim)' }}>
                <li>查询分词：拉丁词 + <span className="dp-mono">CJK bigram</span>，与项目 Python 侧同一实现</li>
                <li>稀疏检索：BM25(k1={cfg ? String(cfg['k1'] ?? 1.5) : '1.5'}, b=0.75)，倒排表来自真实语料</li>
                <li>稠密检索：<span className="dp-mono">int8 去量化 × float32 查询</span> 的 800×1024 内积，浏览器里算</li>
                <li>融合：RRF(k={cfg ? String(cfg.rrf_k) : '60'}) 取 top20 再截 top5</li>
                <li>20 题评测：Recall@5 / MRR 在浏览器内逐题真算，并逐题与 Python 侧对照</li>
                <li>有 key 时：查询向量真调 embedding、top20 真调 bge-reranker 精排、回答真调 LLM 流式生成</li>
              </ul>
            </div>
            <div className="dp-panel-tight" style={{ padding: 14 }}>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--warn)', fontWeight: 700, letterSpacing: '0.06em' }}>本期未做（不是做不到，是刻意砍掉）</p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.85, color: 'var(--fg-dim)' }}>
                <li>PDF 解析与切块：题目里 15–21 MB 的 PDF 与 2.2 GB 的 bge-m3 权重不进静态站点，改为导出真实的 800 条 chunk 子集</li>
                <li>知识库是 5325 条的<b>子集</b>（{cfg ? String(cfg.asset_chunks) : '800'} / {cfg ? String(cfg.corpus_chunks) : '5325'}），依据是让评测 gold 全部落在子集内，数字可直接对齐</li>
                <li>不跑 FastAPI 服务：静态站本身没有后端；填了 key 走浏览器直连（CORS 已实测），没填 key 走本站另部署的 Cloudflare Worker 代理（不是这个静态站的一部分）</li>
                <li>零配置下的模型回答：站内代理额度内是<b>真答</b>，额度用完则回落到<b>录制回放</b>，两种都会在徽标上写明</li>
              </ul>
            </div>
          </div>
        </Panel>

        <KeyBar llm={llm} note="填了 key：只存在你自己浏览器的 localStorage，浏览器直连服务商，本站不中转；没填 key：走站内代理（本站自己的 Cloudflare Worker，密钥只在服务端），零配置也能真答。检索与评测本来就全在本地真跑。" />

        {err && (
          <Panel title="资产加载失败">
            <p style={{ margin: 0, fontSize: 12, color: 'var(--err)', fontWeight: 600 }}>{err.title}</p>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--fg-dim)' }}>{err.detail}</p>
          </Panel>
        )}

        {!assets && !err && <Panel title="正在加载真实数据资产…"><p style={{ margin: 0, fontSize: 12, color: 'var(--fg-dim)' }}>chunks.json / vectors.bin / bm25.json / eval.json</p></Panel>}

        {assets && (
          <>
            <AskPanel assets={assets} llm={{ live: llm.live, mode: llm.mode }} replayScripts={replay} />
            <EvalPanel assets={assets} llm={{ live: llm.live, mode: llm.mode }} />

            <Panel title="语料与资产自检" subtitle="页面上每个数字都来自这些文件；这里把它们摊开，方便你对账。">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                <StatTile label="语料 chunk（全量）" value={String(cfg?.corpus_chunks ?? '—')} sub={(cfg?.corpus_docs ?? '—') + ' 篇论文'} tone="neutral" />
                <StatTile label="本页装载 chunk" value={String(assets.chunks.length)} sub={fmtBytes(assets.bytes['chunks.json'])} tone="live" />
                <StatTile label="稠密向量" value={assets.meta.count + ' × ' + assets.meta.dim} sub={'int8 · ' + fmtBytes(assets.bytes['vectors.bin']) + '（原始 float32 约 3.3 MB）'} tone="live" />
                <StatTile label="倒排表 token" value={String(Object.keys(assets.bm25.post).length)} sub={'df≥2 且 len≤8 · ' + fmtBytes(assets.bytes['bm25.json'])} tone="live" />
                <StatTile label="查询向量资产" value={assets.queryVectors ? String(assets.queryVectors.items.length) + ' 条' : '未就绪'} sub={assets.queryVectors ? assets.queryVectors.dtype + ' · ' + fmtBytes(assets.bytes['query_vectors.json']) : '零配置检索将不可用'} tone={assets.queryVectors ? 'live' : 'warn'} />
                <StatTile label="评测题" value={String(assets.evalFile.questions.length)} sub={'Python Recall@5 ' + String(assets.evalFile._python_baseline['recall@5'])} tone="accent" />
              </div>
              <div style={{ marginTop: 12 }}>
                <KeyValue
                  columns={2}
                  items={[
                    ['embedding 模型', cfg?.embed_model ?? '—'],
                    ['rerank 模型', cfg?.rerank_model ?? '—'],
                    ['最终 top_k / 融合候选', (cfg?.top_k ?? '—') + ' / ' + (cfg?.fused_top_k ?? '—')],
                    ['dense / sparse 候选', (cfg?.dense_top_k ?? '—') + ' / ' + (cfg?.sparse_top_k ?? '—')],
                    ['分块长度 / 重叠', (cfg?.chunk_chars ?? '—') + ' / ' + (cfg?.overlap_chars ?? '—')],
                    ['生成模型（默认）', cfg?.llm_model ?? '—'],
                    ['资产文件', Object.keys(assets.bytes).length + ' 个 / 合计 ' + fmtBytes(Object.values(assets.bytes).reduce((a, b) => a + b, 0))],
                    ['录制问答', replayNote],
                  ]}
                />
              </div>
            </Panel>

            <Panel title="检索链路（与 Python 侧逐行同口径）" subtitle="下面这段就是浏览器里跑的算子顺序；评测面板里的数字由它算出，可与项目 Python 输出对齐。">
              <CodeBlock maxHeight={420}>{[
                '1) tokenize(q): lower -> 拉丁/数字词 findall -> CJK 连续段切 bigram（单字保留）',
                '',
                '2) BM25（稀疏）',
                '   idf   = log(N - df + 0.5) - log(df + 0.5)      # 负值回退 0.25 * avg_idf',
                '   score = Σ idf[t] * f * (k1 + 1) / (f + k1 * (1 - b + b * docLen[d] / avgdl))',
                '         k1 = ' + String(cfg?.['k1'] ?? 1.5) + ', b = 0.75, N = ' + String(assets.bm25.N) + ', avgdl = ' + assets.bm25.avgdl.toFixed(3),
                '   -> 稳定降序，保留 score > 0 的前 ' + String(cfg?.sparse_top_k ?? 20) + ' 条',
                '',
                '3) dense（稠密）',
                '   x_i = Vq[i] * row_scale[i]                      # int8 去量化',
                '   sim_i = row_scale[i] * Σ_j q[j] * Vq[i * dim + j]   # 查询保持 float32，不再量化',
                '   -> 稳定降序前 ' + String(cfg?.dense_top_k ?? 20) + ' 条',
                '',
                '4) RRF 融合： agg[idx] += 1 / (k + rank), rank 从 1 起，k = ' + String(cfg?.rrf_k ?? 60),
                '   -> 稳定降序取 ' + String(cfg?.fused_top_k ?? 20) + '，再截前 ' + String(cfg?.top_k ?? 5),
                '',
                '5) 精排（可选，仅真调 API 时）： bge-reranker-v2-m3 对 top20 打分取前 ' + String(cfg?.rerank_top_n ?? 5),
                '   # 评测口径不含精排，便于和 Python 的 0.75 / 0.4958 直接对齐',
                '',
                '6) 生成： 仅把 top5 chunk 文本 + 编号约束放进 prompt，要求「只依据片段回答 + [编号] 标来源」',
              ].join('\n')}</CodeBlock>
            </Panel>
          </>
        )}

        <Footer />
      </div>
    </PageShell>
  );
}

export default App;
