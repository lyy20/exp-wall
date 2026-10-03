import { useEffect, useState } from 'react';
import { asset } from '../shared/asset';
import { KeyBar, ModeBadge } from '../shared/ui/llm-ui';
import { useLlm } from '../shared/llm/useLlm';
import { CodeBlock, Footer, PageShell, Panel, StatTile, SubHeader } from '../shared/ui/core';

export default function App() {
  const llm = useLlm('deepseek');
  const [assets, setAssets] = useState<{ name: string; ok: boolean; size: number }[]>([]);

  useEffect(() => {
    const files = ['kb.json', 'intents.json', 'tools.json', 'policy.json', 'orders.json', 'replay_chat.json', 'config.json'];
    void Promise.all(
      files.map(async (name) => {
        try {
          const res = await fetch(asset('data/yyhelp/' + name));
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
        kicker="Demo 02 · YYHelp 电商智能客服平台"
        title="YYHelp"
        subtitle="多轮对话 Agent：9 类意图分流到 5 个出口，状态图持久化，ReAct 循环里真调工具函数，全过程 trace 可回看。"
        right={<ModeBadge live={llm.live} />}
      />
      <main className="dp-wrap" style={{ paddingTop: 18, paddingBottom: 64, display: 'grid', gap: 14 }}>
        <KeyBar llm={llm} note="对话意图路由与回复生成需要 chat 能力；零配置时自动走真实日志回放。" />
        <Panel title="数据资产自检">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {assets.map((a) => (
              <StatTile key={a.name} label={a.name} value={a.ok ? 'OK' : '缺失'} sub={(a.size / 1024).toFixed(1) + ' KB'} tone={a.ok ? 'live' : 'err'} />
            ))}
          </div>
        </Panel>
        <Panel title="对话内核" subtitle="P2 施工中">
          <CodeBlock>{'即将落地：\n- 9 类意图 → 5 个出口的同构状态机（与 Python 侧节点/边一致）\n- 真 ReAct：工具调用（订单/物流/退换/发票）走真实 fixture 层\n- checkpointer：会话状态写 localStorage，刷新可续、可回放\n- trace 面板：每一步意图判定、工具入参、返回证据全部可见'}</CodeBlock>
        </Panel>
      </main>
      <Footer />
    </PageShell>
  );
}
