// P2 知识库检索：项目默认的 stub 关键字路径（零配置真跑）vs 真语义路径（需要 key）对照。
import { useState } from 'react';
import { describeError, embedTexts } from '../shared/llm/client';
import { Badge, Chip, Panel, StatTile } from '../shared/ui/core';
import { ModeBadge } from '../shared/ui/llm-ui';
import type { LlmMode } from '../shared/llm/mode';
import type { YyAssets } from './assets';
import { semanticSearchKb, ToolRuntime } from './engine';

interface Hit { chunk_id: string; heading: string; text: string; score: number }

export function KbPanel({ assets, llm }: { assets: YyAssets; llm: { live: boolean; mode: LlmMode } }) {
  const [q, setQ] = useState('新疆的运费是多少钱');
  const [topK, setTopK] = useState(3);
  const [stub, setStub] = useState<{ hits: Hit[]; err?: string; index?: string } | null>(null);
  const [sem, setSem] = useState<{ hits: Hit[]; err?: string; ms?: number; model?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const runStub = () => {
    const rt = new ToolRuntime(assets, 'kb-panel');
    const env = { hits: [] as Hit[] };
    try {
      const r = rt.stubSearchKb(q, topK) as unknown as { hits: Hit[]; index_version: string };
      env.hits = r.hits;
      setStub({ hits: r.hits, index: r.index_version });
    } catch (e) {
      setStub({ hits: [], err: (e as Error).message });
    }
  };

  const runSemantic = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const emb = await embedTexts([q], { providerId: 'siliconflow', model: 'BAAI/bge-m3' });
      const r = semanticSearchKb(emb.vectors[0], assets, topK);
      setSem({ hits: r.hits as Hit[], ms: emb.latencyMs, model: (emb.providerId === 'proxy' ? '站内代理' : emb.providerId) + ' · ' + emb.model });
    } catch (e) { const d = describeError(e); setSem({ hits: [], err: d.title + '：' + d.detail }); }
    setBusy(false);
  };

  const rankOf = (h: Hit[], id: string) => { const i = h.findIndex((x) => x.chunk_id === id); return i < 0 ? '—' : String(i + 1); };

  return (
    <Panel
      title="知识库检索：两条后端，必须说清用的是哪条"
      subtitle="左边是项目默认的 stub 关键字路径（零配置、真跑、就是线上默认行为），右边是真语义检索（需要你的 bge-m3 key）。项目自己在 docstring 里写明：默认 stub 时端到端用的是关键字匹配，不是语义检索，典型症状就是「新疆的运费是多少钱」答不出。"
      right={<ModeBadge mode={llm.mode} liveLabel="语义路径可用" replayLabel="仅 stub 路径" />}
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="dp-input" style={{ flex: '1 1 300px' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="试试「新疆的运费是多少钱」和「运费怎么算」" />
        <span style={{ fontSize: 11, color: 'var(--fg-faint)' }}>top_k</span>
        {[1, 2, 3, 4, 5].map((k) => <Chip key={k} active={k === topK} onClick={() => setTopK(k)}>{k}</Chip>)}
        <button type="button" className="dp-btn dp-btn-primary" onClick={runStub}>stub 检索</button>
        <button type="button" className="dp-btn" onClick={() => void runSemantic()} disabled={!llm.live || busy}>{busy ? '语义检索中…' : '真语义检索'}</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 12 }}>
        <StatTile label="知识库切片" value={String(assets.kb.length)} sub={assets.kb[0]?.source ? '来源：' + assets.kb[0].source + ' 等 8 个业务文档' : ''} tone="neutral" />
        <StatTile label="向量库" value={assets.kbMeta.count + ' × ' + assets.kbMeta.dim} sub={'int8 量化 · ' + assets.kbMeta.dtype + ' · 真实 bge-m3 向量'} tone="accent" />
        <StatTile label="stub 算法" value="char-overlap" sub="单字覆盖度 + 6 个业务关键词加成" tone="live" />
        <StatTile label="index_version" value="stub-keyword-v1" sub="默认路径的可见信号" tone="warn" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginTop: 14 }}>
        <div className="dp-panel-tight" style={{ padding: 12 }}>
          <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--live)', fontWeight: 700 }}>stub 关键字路径（默认后端）</p>
          {stub?.index && <p className="dp-mono" style={{ margin: '0 0 8px', fontSize: 10.5, color: 'var(--fg-faint)' }}>index_version = {stub.index}</p>}
          {stub?.err && <p style={{ margin: 0, fontSize: 11.5, color: 'var(--warn)' }}>NOT_FOUND：{stub.err}</p>}
          {!stub && <p style={{ margin: 0, fontSize: 11.5, color: 'var(--fg-faint)' }}>点「stub 检索」跑真实算法。</p>}
          {(stub?.hits ?? []).map((h, i) => (
            <div key={h.chunk_id + i} style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line-soft)' }}>
              <p className="dp-mono" style={{ margin: 0, fontSize: 10.5, color: 'var(--live)' }}>#{i + 1} {h.chunk_id} · score {h.score}</p>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--fg)' }}>{h.heading}</p>
              <p style={{ margin: '3px 0 0', fontSize: 11.5, color: 'var(--fg-dim)', lineHeight: 1.65 }}>{h.text.slice(0, 190)}{h.text.length > 190 ? ' …' : ''}</p>
            </div>
          ))}
        </div>
        <div className="dp-panel-tight" style={{ padding: 12, borderColor: sem?.hits.length ? 'var(--replay)' : undefined }}>
          <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--replay)', fontWeight: 700 }}>真语义路径（bge-m3 + int8 库向量）</p>
          {sem?.model && <p className="dp-mono" style={{ margin: '0 0 8px', fontSize: 10.5, color: 'var(--fg-faint)' }}>{sem.model} · 查询耗时 {Math.round(sem.ms ?? 0)} ms · 索引 yyhelp_kb_v1</p>}
          {sem?.err && <p style={{ margin: 0, fontSize: 11.5, color: 'var(--warn)' }}>{sem.err}</p>}
          {!sem && <p style={{ margin: 0, fontSize: 11.5, color: 'var(--fg-faint)' }}>{llm.mode === 'byok' ? '点「真语义检索」：会用你的 key 真调 embedding 接口，再与库里的 163×1024 int8 向量算余弦。' : llm.mode === 'proxy' ? '点「真语义检索」：走站内代理的 embedding 通道（密钥在服务端），再与库里的 163×1024 int8 向量算余弦。' : '需要模型通道：站内代理没配 embedding，请填你自己的 key（SiliconFlow / DashScope 的 embedding）。'}</p>}
          {(sem?.hits ?? []).map((h, i) => (
            <div key={h.chunk_id + i} style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line-soft)' }}>
              <p className="dp-mono" style={{ margin: 0, fontSize: 10.5, color: 'var(--replay)' }}>#{i + 1} {h.chunk_id} · cos {h.score}</p>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--fg)' }}>{h.heading}</p>
              <p style={{ margin: '3px 0 0', fontSize: 11.5, color: 'var(--fg-dim)', lineHeight: 1.65 }}>{h.text.slice(0, 190)}{h.text.length > 190 ? ' …' : ''}</p>
            </div>
          ))}
        </div>
      </div>

      {stub?.hits?.length && sem?.hits?.length ? (
        <div className="dp-panel-tight" style={{ marginTop: 12, padding: 12 }}>
          <p style={{ margin: '0 0 6px', fontSize: 11.5, color: 'var(--fg)' }}>
            <Badge tone="accent">对照</Badge> 同一条 query 下两种后端的名次差异
          </p>
          <div style={{ overflowX: 'auto' }} className="dp-scroll">
            <table className="dp-mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead><tr style={{ color: 'var(--fg-faint)', textAlign: 'left' }}><th style={{ padding: '5px 8px' }}>chunk</th><th style={{ padding: '5px 8px' }}>stub 名次</th><th style={{ padding: '5px 8px' }}>语义名次</th></tr></thead>
              <tbody>
                {Array.from(new Set([...stub.hits.map((h) => h.chunk_id), ...sem.hits.map((h) => h.chunk_id)])).map((id) => (
                  <tr key={id} style={{ borderTop: '1px solid var(--line-soft)', color: 'var(--fg-dim)' }}>
                    <td style={{ padding: '5px 8px' }}>{id}</td>
                    <td style={{ padding: '5px 8px' }}>{rankOf(stub.hits, id)}</td>
                    <td style={{ padding: '5px 8px' }}>{rankOf(sem.hits, id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <p style={{ margin: '12px 0 0', fontSize: 11, color: 'var(--fg-faint)', lineHeight: 1.7 }}>
        诚实说明：stub 路径逐字复刻 code/yyhelp/graph/tools.py:644-667（score = 单字覆盖度 + 关键词 +0.5，k 上限 5，无命中即 NOT_FOUND）；
        语义路径用真实 bge-m3 接口出向量，再与从 Milvus parquet 导出的 int8 库向量做去量化内积（库向量已 L2 归一化，故等价于余弦）。
        项目源码里那条实测结论原文是：「默认 stub 时，端到端链路用的是关键字匹配，不是语义检索 —— 表现就是『新疆的运费是多少钱』答不出」，index_version=stub-keyword-v1 就是这个状态的可见信号。
      </p>
    </Panel>
  );
}
