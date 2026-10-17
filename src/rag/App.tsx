// P1 RAG 页：真检索（浏览器内 int8 稠密 + BM25 + RRF）+ 真评测 + 真调模型 / 零配置回放。
// 页面只留「问到什么 / 引用哪几段 / 评测数字」；实现细节收进底部的折叠区，面试官不用先读一堆后端说明。
import { useEffect, useState } from 'react';
import { asset } from '../shared/asset';
import { useLlm } from '../shared/llm/useLlm';
import { Badge, Footer, PageShell, Panel, SubHeader } from '../shared/ui/core';
import { KeyBar } from '../shared/ui/llm-ui';
import { AskPanel, type RagReplayItem } from './AskPanel';
import { EvalPanel } from './EvalPanel';
import { loadRagAssets, type RagAssets } from './assets';

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
        setReplayNote(items.length + ' 条录制问答（没有模型通道时按录制节奏回放）');
      })
      .catch(() => { if (alive) { setReplay([]); setReplayNote('录制问答资产缺失'); } });
    return () => { alive = false; };
  }, []);

  return (
    <PageShell>
      <SubHeader
        kicker="Demo 02 · 应用层"
        title="科研文献 RAG 问答平台"
        subtitle="55 篇论文、5325 个片段组成的真实语料：问一句，它先在浏览器里检索，再让模型只依据检索到的片段作答，每条结论都带可展开的原文引用。"
        right={<Badge tone="live">真检索 · 真引用</Badge>}
      />

      <div className="dp-wrap" style={{ paddingBottom: 60, display: 'grid', gap: 16 }}>
        {err && (
          <Panel title="数据加载失败">
            <p style={{ margin: 0, fontSize: 12, color: 'var(--err)', fontWeight: 600 }}>{err.title}</p>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--fg-dim)' }}>{err.detail}</p>
          </Panel>
        )}
        {!assets && !err && (
          <Panel title="正在加载语料…">
            <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-dim)' }}>首次进入会加载约 1.9 MB 的真实检索资产，随后整页不再重复请求。</p>
          </Panel>
        )}

        {assets && (
          <>
            <AskPanel assets={assets} llm={{ live: llm.live, mode: llm.mode }} replayScripts={replay} />
            <EvalPanel assets={assets} llm={{ live: llm.live, mode: llm.mode }} />

            <details className="dp-panel-tight" style={{ padding: 14 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--fg-dim)' }}>
                用自己的 API key（可选） / 查看实现细节
              </summary>
              <p style={{ margin: '10px 0 8px', fontSize: 11.5, lineHeight: 1.7, color: 'var(--fg-faint)' }}>
                不填也能用：本站自带的模型通道有每日额度，额度内直接真答；填自己的 key 只是绕开额度限制。{replayNote}。
              </p>
              <KeyBar llm={llm} note="填了 key 只存在你自己浏览器的 localStorage，本站不中转、不记录。" />
              <p style={{ margin: '10px 0 0', fontSize: 11.5, lineHeight: 1.75, color: 'var(--fg-faint)' }}>
                检索链路：分词（拉丁词 + CJK bigram）→ BM25(k1=1.5, b=0.75) 与 int8 去量化稠密内积 → RRF(k=60) 取 20 截 5 → 可选精排 → 生成。
                评测口径不含精排，便于和 Python 侧 0.75 / 0.4958 直接对齐；知识库是 5325 条里让 gold 全部命中的 800 条子集。
              </p>
            </details>
          </>
        )}

        <Footer />
      </div>
    </PageShell>
  );
}

export default App;
