// P1 主交互：提问 -> 浏览器内真检索（int8 稠密 + BM25 + RRF[+ 精排]）-> 真调模型生成 / 零配置回放。
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { chatStream, describeError, embedTexts, normalize, rerankDocs } from '../shared/llm/client';
import { matchReplay, playText } from '../shared/replay';
import { Badge, Chip, KeyValue, Panel, StatTile } from '../shared/ui/core';
import { ModeBadge, QuotaBar } from '../shared/ui/llm-ui';
import { findQueryVector, f32FromBase64, type RagAssets } from './assets';
import { retrieve, type Chunk, type Stages } from './retrieve';

export interface RagReplayItem {
  id: string;
  q: string;
  answer: string;
  model?: string;
  ts?: string;
  latency_ms?: number;
  latencyMs?: number;
  hits?: { id: string; doc?: string; score?: number; rank?: number }[];
}

type Hit = { idx: number; rrf: number; rrfRank: number; denseRank?: number; sparseRank?: number; chunk: Chunk; rerankScore?: number; rerankRank?: number };

type Result = {
  mode: 'live' | 'replay';
  question: string;
  tokens: string[];
  stages: Stages;
  hits: Hit[];
  answerMode: 'live' | 'replay' | 'none';
  provenance?: string;
  embed: { source: 'key' | 'precomputed'; model: string; latencyMs?: number; sim?: number };
  rerank?: { applied: boolean; model: string; latencyMs?: number; note?: string };
  timings: { retrieveMs: number; answerMs?: number; firstTokenMs?: number };
  usage?: { promptTokens: number; completionTokens: number };
  evalRef?: { id: string; rank: number; rr: number; recall5: number; pyRank?: number; pyMrr?: number; pyRecall5?: number };
};

const SYSTEM =
  '你是科研文献问答助手。只依据【检索片段】回答，每个结论后用 [编号] 标注来源；片段里没有的信息必须回答「检索片段未提供」，不得编造。回答用中文，200 字以内。';

function buildUser(hits: Hit[], question: string): string {
  const ctx = hits.map((h, i) => '[' + (i + 1) + '] ' + h.chunk.doc + ' · p' + h.chunk.page + '\n' + h.chunk.text.slice(0, 900)).join('\n\n');
  return '【检索片段】\n' + ctx + '\n\n【问题】' + question;
}

function fmtMs(ms?: number): string {
  if (ms === undefined) return '—';
  return ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : Math.round(ms) + ' ms';
}

export function AskPanel({ assets, llm, replayScripts }: { assets: RagAssets; llm: { live: boolean }; replayScripts: RagReplayItem[] }) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);
  const [useRerank, setUseRerank] = useState(true);
  const [openChunk, setOpenChunk] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const goldById = useCallback((q: string) => {
    const qq = assets.evalFile.questions.find((x) => x.q === q);
    if (!qq) return null;
    const map = new Map<string, number>();
    assets.meta.ids.forEach((id, i) => map.set(id, i));
    const gold = new Set<number>();
    qq.gt.forEach((g) => { const i = map.get(g.id); if (i !== undefined) gold.add(i); });
    return { qq, gold };
  }, [assets]);

  const ask = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q || busy) return;
    setBusy(true); setError(null); setAnswer(''); setResult(null); setOpenChunk(null);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const t0 = performance.now();
    try {
      let qVec: Float32Array;
      let embedInfo: Result['embed'];

      if (llm.live) {
        setStage('正在用你的 key 真算查询向量（embedding）…');
        const emb = await embedTexts([q], { signal: ctrl.signal });
        qVec = normalize(emb.vectors[0]);
        embedInfo = { source: 'key', model: emb.providerId + ' · ' + emb.model, latencyMs: emb.latencyMs };
      } else {
        const found = findQueryVector(assets, q);
        if (!found || found.sim < 0.5) {
          setStage('');
          setError({
            title: '零配置模式：这条问题没有预置向量',
            detail: '预置了 ' + (assets.queryVectors?.items.length ?? 0) + ' 个问题（评测 20 题 + 录制问答）可在无 key 时跑真检索。请点下面的示例问题，或在上方填入你自己的 embedding key 后提问任意问题。',
          });
          setBusy(false); return;
        }
        qVec = normalize(f32FromBase64(found.item.vec));
        embedInfo = { source: 'precomputed', model: (assets.queryVectors?.model ?? 'bge-m3') + ' · 离线预计算', sim: found.sim };
        setStage('零配置：命中预置问题向量（相似度 ' + found.sim.toFixed(3) + '），开始真检索…');
      }

      const cfg = {
        denseTopK: assets.config.dense_top_k, sparseTopK: assets.config.sparse_top_k, rrfK: assets.config.rrf_k,
        fusedTopK: assets.config.fused_top_k, finalK: assets.config.top_k,
      };
      const tR = performance.now();
      const stages = retrieve(qVec, q, assets.vecs, assets.rowScale, assets.config.embed_dim, assets.bm25, cfg);
      const retrieveMs = performance.now() - tR;

      const denseRank = new Map(stages.dense.map((s, i) => [s.idx, i + 1] as const));
      const sparseRank = new Map(stages.sparse.map((s, i) => [s.idx, i + 1] as const));
      let hits: Hit[] = stages.fused.map((s) => ({
        idx: s.idx, rrf: s.score, rrfRank: stages.fused.findIndex((x) => x.idx === s.idx) + 1,
        denseRank: denseRank.get(s.idx), sparseRank: sparseRank.get(s.idx), chunk: assets.chunks[s.idx],
      }));
      let top = hits.slice(0, cfg.finalK);

      let rerankInfo: Result['rerank'] | undefined;
      if (useRerank && llm.live) {
        setStage('真调 bge-reranker 精排 top20…');
        const tRe = performance.now();
        const rr = await rerankDocs(q, hits.map((h) => h.chunk.text.slice(0, 900)), { topN: cfg.finalK, signal: ctrl.signal });
        if (rr) {
          top = rr.order.slice(0, cfg.finalK).map((i, rank) => ({ ...hits[i], rerankScore: rr.scores[rank], rerankRank: rank + 1 }));
          rerankInfo = { applied: true, model: rr.providerId + ' · ' + rr.model, latencyMs: performance.now() - tRe };
        } else {
          rerankInfo = { applied: false, model: '本期未接入可用 rerank 服务商', note: 'RRF 融合结果直接作为最终结果（与评测口径一致）' };
        }
      } else if (useRerank && !llm.live) {
        rerankInfo = { applied: false, model: '未配置 key', note: '零配置下不精排，与 Python 评测口径一致（评测本身也不跑 rerank）' };
      }

      const g = goldById(q);
      const evalRef = g
        ? (() => {
            const rank = top.findIndex((h) => g.gold.has(h.idx)) + 1;
            return { id: g.qq.id, rank, rr: rank ? 1 / rank : 0, recall5: rank > 0 && rank <= 5 ? 1 : 0, pyRank: g.qq.py_rank, pyMrr: g.qq.py_mrr, pyRecall5: g.qq.py_recall5 };
          })()
        : undefined;

      const base: Result = {
        mode: llm.live ? 'live' : 'replay', question: q, tokens: stages.tokens, stages, hits, answerMode: 'none',
        embed: embedInfo, rerank: rerankInfo, timings: { retrieveMs }, evalRef,
      };

      if (llm.live) {
        setStage('真调模型生成回答（SSE 流式）…');
        const tA = performance.now();
        const res = await chatStream(
          [{ role: 'system', content: SYSTEM }, { role: 'user', content: buildUser(top, q) }],
          { signal: ctrl.signal, onToken: (c) => setAnswer((prev) => prev + c) },
        );
        setAnswer(res.text);
        setResult({
          ...base, answerMode: 'live', provenance: res.providerId + ' · ' + res.model + ' @ ' + new Date().toLocaleTimeString(),
          timings: { retrieveMs, answerMs: performance.now() - tA, firstTokenMs: res.firstTokenMs },
          usage: res.usage,
        });
      } else {
        const m = matchReplay(replayScripts, q);
        const script = m?.script;
        const text = script?.answer ?? '';
        if (script && text) {
          setStage('零配置：按真实节奏回放录制的模型输出…');
          const ms = await playText(text, { onToken: (c) => setAnswer((prev) => prev + c), charsPerSecond: 60, signal: ctrl.signal });
          setResult({
            ...base, answerMode: 'replay',
            provenance: (script.model || 'deepseek-chat') + ' · 录制于 ' + (script.ts || '项目日志') + ' · 原始延迟 ' + fmtMs(script.latency_ms ?? script.latencyMs),
            timings: { retrieveMs, answerMs: ms },
          });
        } else {
          setResult({ ...base, answerMode: 'none' });
        }
      }
      setStage('');
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') setError(describeError(err));
      setStage('');
    } finally {
      setBusy(false);
      abort.current = null;
      void t0;
    }
  }, [assets, busy, goldById, llm.live, replayScripts, useRerank]);

  const examples = (assets.queryVectors?.items ?? []).filter((it) => it.q).slice(0, 6);

  return (
    <Panel
      title="提问：浏览器内真检索 → 真生成"
      subtitle="检索算子完全在本地跑（int8 去量化内积 + BM25 + RRF）。有 key 时查询向量与回答都真调接口；没 key 时查询向量取离线预计算那份，检索仍是真的，回答走录制回放。"
      right={<ModeBadge live={llm.live} />}
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          className="dp-input"
          style={{ flex: '1 1 320px' }}
          placeholder="问点关于 USV / CTRIP-SAC / 路径规划的问题…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void ask(question); }}
          disabled={busy}
        />
        <button type="button" className="dp-btn dp-btn-primary" onClick={() => void ask(question)} disabled={busy || !question.trim()}>
          {busy ? '运行中…' : '提问'}
        </button>
        {busy && (
          <button type="button" className="dp-btn" onClick={() => abort.current?.abort()}>
            取消
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>示例</span>
        {examples.map((it) => (
          <Chip key={it.q} onClick={() => { setQuestion(it.q); void ask(it.q); }}>{it.q.length > 34 ? it.q.slice(0, 34) + '…' : it.q}</Chip>
        ))}
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 11, color: 'var(--fg-faint)' }}>
        <input type="checkbox" checked={useRerank} onChange={(e) => setUseRerank(e.target.checked)} />
        有 key 时叠加 bge-reranker-v2-m3 精排（评测口径不含精排，便于与 Python 对齐）
      </label>

      <div style={{ marginTop: 10 }}><QuotaBar /></div>
      {stage && <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--replay)' }}>{stage}</p>}
      {error && (
        <div className="dp-panel-tight" style={{ marginTop: 10, padding: 12, borderColor: 'var(--err)' }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--err)', fontWeight: 600 }}>{error.title}</p>
          <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--fg-dim)', lineHeight: 1.6 }}>{error.detail}</p>
        </div>
      )}

      {result && (
        <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
            <StatTile label="检索耗时" value={fmtMs(result.timings.retrieveMs)} sub={result.stages.dense.length + ' dense / ' + result.stages.sparse.length + ' sparse / ' + result.stages.fused.length + ' 融合'} tone="live" />
            <StatTile label="查询向量" value={result.embed.source === 'key' ? '真调 API' : '离线预计算'} sub={result.embed.model + (result.embed.sim !== undefined ? ' · 匹配 ' + result.embed.sim.toFixed(3) : '')} tone={result.embed.source === 'key' ? 'live' : 'replay'} />
            <StatTile label="生成" value={result.answerMode === 'live' ? '实时' : result.answerMode === 'replay' ? '回放' : '未生成'} sub={result.provenance || '需要 key 才能实时生成'} tone={result.answerMode === 'live' ? 'live' : 'replay'} />
            <StatTile label="精排" value={result.rerank?.applied ? '已启用' : '未启用'} sub={result.rerank?.model || '—'} tone={result.rerank?.applied ? 'live' : 'neutral'} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Badge tone="live">检索命中 top {result.hits.slice(0, assets.config.top_k).length}</Badge>
              <span style={{ fontSize: 11, color: 'var(--fg-faint)' }}>
                查询分词 {result.tokens.length} 个（CJK bigram）：{result.tokens.slice(0, 14).join(' / ')}{result.tokens.length > 14 ? ' …' : ''}
              </span>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {result.hits.slice(0, assets.config.top_k).map((h, i) => (
                <div key={h.idx} className="dp-panel-tight" style={{ padding: 12 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span className="dp-mono" style={{ fontSize: 12, color: 'var(--live)', fontWeight: 700 }}>[{i + 1}]</span>
                    <span style={{ fontSize: 12.5, color: 'var(--fg)', minWidth: 0 }}>{h.chunk.doc.length > 62 ? h.chunk.doc.slice(0, 62) + '…' : h.chunk.doc}</span>
                    <span className="dp-mono" style={{ fontSize: 11, color: 'var(--fg-faint)' }}>p{h.chunk.page}</span>
                    <span style={{ flex: 1 }} />
                    <span className="dp-mono" style={{ fontSize: 11, color: 'var(--fg-faint)' }}>
                      dense #{h.denseRank ?? '-'} · bm25 #{h.sparseRank ?? '-'} · RRF {h.rrf.toFixed(4)}{h.rerankRank ? ' · rerank #' + h.rerankRank + ' (' + (h.rerankScore ?? 0).toFixed(3) + ')' : ''}
                    </span>
                    <button type="button" className="dp-btn" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => setOpenChunk(openChunk === i ? null : i)}>
                      {openChunk === i ? '收起' : '原文'}
                    </button>
                  </div>
                  <p style={{ margin: '7px 0 0', fontSize: 11.5, lineHeight: 1.65, color: 'var(--fg-dim)' }}>
                    {openChunk === i ? h.chunk.text : h.chunk.text.slice(0, 190) + (h.chunk.text.length > 190 ? ' …' : '')}
                  </p>
                  <p className="dp-mono" style={{ margin: '6px 0 0', fontSize: 10, color: 'var(--fg-faint)' }}>{h.chunk.id}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="dp-panel-tight" style={{ padding: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <ModeBadge live={result.answerMode === 'live'} />
              <span style={{ fontSize: 11, color: 'var(--fg-faint)' }}>
                {result.answerMode === 'none'
                  ? '零配置下这条问题没有录制答案 —— 填入你自己的 key 即可实时提问。检索结果（上面）仍然是刚刚在浏览器里真算出来的。'
                  : result.provenance}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.75, color: 'var(--fg)', whiteSpace: 'pre-wrap' }}>
              {answer || (busy ? '…' : '（无）')}
              {busy && <span className="dp-caret">▍</span>}
            </p>
            {result.usage && (
              <p className="dp-mono" style={{ margin: '8px 0 0', fontSize: 10.5, color: 'var(--fg-faint)' }}>
                prompt {result.usage.promptTokens} tok · completion {result.usage.completionTokens} tok · 首 token {fmtMs(result.timings.firstTokenMs)} · 总耗时 {fmtMs(result.timings.answerMs)}
              </p>
            )}
          </div>

          {result.evalRef && (
            <div className="dp-panel-tight" style={{ padding: 12 }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-dim)' }}>
                这条问题属于评测集 <b className="dp-mono">{result.evalRef.id}</b>：本次浏览器内检索 rank=
                <b className="dp-mono" style={{ color: result.evalRef.recall5 ? 'var(--live)' : 'var(--err)' }}>{result.evalRef.rank || '未命中'}</b>
                （Recall@5 {result.evalRef.recall5}，RR {result.evalRef.rr.toFixed(3)}）· Python 侧 rank=
                <b className="dp-mono">{result.evalRef.pyRank ?? '—'}</b>（recall5 {result.evalRef.pyRecall5 ?? '—'}，RR {result.evalRef.pyMrr ?? '—'}）
              </p>
            </div>
          )}

          <details>
            <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--fg-dim)' }}>查看完整管线（dense top20 / bm25 top20 / RRF top20 → top5）</summary>
            <div style={{ marginTop: 10, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
              <KeyValue columns={1} items={result.stages.dense.slice(0, 8).map((s, i) => ['dense #' + (i + 1), assets.chunks[s.idx].doc.slice(0, 30) + ' p' + assets.chunks[s.idx].page + ' · ' + s.score.toFixed(4)] as [ReactNode, ReactNode])} />
              <KeyValue columns={1} items={result.stages.sparse.slice(0, 8).map((s, i) => ['bm25 #' + (i + 1), assets.chunks[s.idx].doc.slice(0, 30) + ' p' + assets.chunks[s.idx].page + ' · ' + s.score.toFixed(3)] as [ReactNode, ReactNode])} />
              <KeyValue columns={1} items={result.stages.fused.slice(0, 8).map((s, i) => ['RRF #' + (i + 1), assets.chunks[s.idx].doc.slice(0, 30) + ' p' + assets.chunks[s.idx].page + ' · ' + s.score.toFixed(5)] as [ReactNode, ReactNode])} />
            </div>
          </details>
        </div>
      )}
    </Panel>
  );
}
