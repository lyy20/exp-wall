import { useEffect, useState } from 'react';
import { asset } from '../shared/asset';
import { KeyBar, ModeBadge } from '../shared/ui/llm-ui';
import { useLlm } from '../shared/llm/useLlm';
import { CodeBlock, Footer, PageShell, Panel, StatTile, SubHeader } from '../shared/ui/core';

export default function App() {
  const llm = useLlm('deepseek');
  const [assets, setAssets] = useState<{ name: string; ok: boolean; size: number }[]>([]);

  useEffect(() => {
    const files = ['chunks.json', 'vectors_meta.json', 'bm25.json', 'eval.json', 'replay_rag.json', 'config.json'];
    void Promise.all(
      files.map(async (name) => {
        try {
          const res = await fetch(asset('data/rag/' + name));
          const blob = await res.blob();
          return { name, ok: res.ok, size: blob.size };
        } catch {
          return { name, ok: false, size: 0 };
        }
      }),
    ).then(setAssets);
  }, []);

  return (
    <PageShell>
      <SubHeader
        kicker="Demo 03 · 科研文献 RAG 问答平台"
        title="RAG QA"
        subtitle="把 PDF 文献库变成带可核对引用的问答链路：检索在浏览器里真跑（向量 + BM25 + RRF），生成真调模型，评测在本地真算 Recall@5 / MRR。"
        right={<ModeBadge live={llm.live} />}
      />
      <main className="dp-wrap" style={{ paddingTop: 18, paddingBottom: 64, display: 'grid', gap: 14 }}>
        <KeyBar llm={llm} note="RAG 页需要 embedding 能力：若用 DeepSeek 对话，向量会自动改走 SiliconFlow / 百炼。" />
        <Panel title="数据资产自检" subtitle="这一步验证静态资源在子路径部署下是否都能取到（0 个 404 才算通过）">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {assets.map((a) => (
              <StatTile key={a.name} label={a.name} value={a.ok ? 'OK' : '缺失'} sub={(a.size / 1024).toFixed(1) + ' KB'} tone={a.ok ? 'live' : 'err'} />
            ))}
          </div>
        </Panel>
        <Panel title="检索内核" subtitle="P1 施工中：800 条真实 chunk + int8 向量 + 与 Python 同口径的 BM25(bigram) + RRF 融合">
          <CodeBlock>{'即将落地：\n- 浏览器内 IndexFlatIP 等价实现（int8 反量化 + 点积）\n- BM25：与 rag-demo 相同的 K1/B 与 CJK bigram 分词\n- RRF 融合 + 可选的 bge-reranker 精排（真调 API）\n- 20 题评测：本地真算 Recall@5 / MRR，并与 Python baseline 并列显示'}</CodeBlock>
        </Panel>
      </main>
      <Footer />
    </PageShell>
  );
}
