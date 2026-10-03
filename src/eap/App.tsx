import { useEffect, useState } from 'react';
import { asset } from '../shared/asset';
import { KeyBar, ModeBadge } from '../shared/ui/llm-ui';
import { useLlm } from '../shared/llm/useLlm';
import { CodeBlock, Footer, PageShell, Panel, StatTile, SubHeader } from '../shared/ui/core';

export default function App() {
  const llm = useLlm('deepseek');
  const [assets, setAssets] = useState<{ name: string; ok: boolean; size: number }[]>([]);

  useEffect(() => {
    const files = ['contracts.json', 'errors.json', 'runs.json', 'series.json', 'golden.json', 'replay_eap.json', 'audit_sample.json'];
    void Promise.all(
      files.map(async (name) => {
        try {
          const res = await fetch(asset('data/eap/' + name));
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
        kicker="Demo 01 · 科研实验分析助手 Agent"
        title="Exp Agent"
        subtitle="把实验数据目录变成可溯源、可拒答、可审计的对比结论：8 个工具按四段式契约声明，9 类错误语义严格区分，统计量由确定性代码算出，LLM 不接触原始数值。"
        right={<ModeBadge live={llm.live} />}
      />
      <main className="dp-wrap" style={{ paddingTop: 18, paddingBottom: 64, display: 'grid', gap: 14 }}>
        <KeyBar llm={llm} note="这里模型只负责编排与措辞，数值一律由本地确定性代码计算（这也是项目的核心约束）。" />
        <Panel title="数据资产自检">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {assets.map((a) => (
              <StatTile key={a.name} label={a.name} value={a.ok ? 'OK' : '缺失'} sub={(a.size / 1024).toFixed(1) + ' KB'} tone={a.ok ? 'live' : 'err'} />
            ))}
          </div>
        </Panel>
        <Panel title="分析内核" subtitle="P3 施工中">
          <CodeBlock>{'即将落地：\n- 8 个工具的契约卡片（做什么/何时用/何时不用/失败怎么办）+ 非法调用真被拒\n- 浏览器内真算：mean/std/SEM/Welch t/bootstrap CI，与 Python golden 值逐项自检\n- 9 类错误语义演示：把"系统故障"和"实验没有结果"严格分开\n- 证明链路：模型看到的是句柄与摘要，不是原始数值'}</CodeBlock>
        </Panel>
      </main>
      <Footer />
    </PageShell>
  );
}
