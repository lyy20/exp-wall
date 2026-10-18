// P2 页壳：对话台放最上面，意图路由 / 知识库 / 工具契约收进折叠区（想看细节的人才会打开）。
import { useEffect, useState } from 'react';
import { useLlm } from '../shared/llm/useLlm';
import { Badge, Footer, PageShell, Panel, SubHeader } from '../shared/ui/core';
import { KeyBar } from '../shared/ui/llm-ui';
import { ChatPanel } from './ChatPanel';
import { IntentPanel } from './IntentPanel';
import { KbPanel } from './KbPanel';
import { loadYyAssets, type YyAssets } from './assets';
import { page } from '../shared/asset';

export function App() {
  const llm = useLlm('deepseek');
  const [a, setA] = useState<YyAssets | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadYyAssets().then((x) => { if (alive) setA(x); }).catch((e) => { if (alive) setErr(String((e as Error)?.message ?? e)); });
    return () => { alive = false; };
  }, []);

  const turns = a ? a.replay.reduce((s, c) => s + c.turns.length, 0) : 0;
  const toolTurns = a ? a.replay.reduce((s, c) => s + c.turns.filter((t) => t.role === 'tool').length, 0) : 0;

  return (
    <PageShell>
      <SubHeader
        kicker="Demo 01 · 应用层"
        title="YYHelp 电商智能客服平台"
        subtitle="一个能真把事办完的客服 Agent：查订单、算运费、建工单、退款。写操作先确认再落库，同一条请求重放会命中幂等键，不重复建单。"
        right={<Badge tone="live">真工具 · 真幂等</Badge>}
      />

      <div className="dp-wrap" style={{ paddingBottom: 60, display: 'grid', gap: 16 }}>
        {err && (
          <Panel title="数据加载失败">
            <p style={{ margin: 0, fontSize: 12, color: 'var(--err)' }}>{err}</p>
          </Panel>
        )}
        {!a && !err && (
          <Panel title="正在加载对话与知识库…">
            <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-dim)' }}>意图规则、工具信封、订单 fixture 与知识库切片都是项目里的真实产物。</p>
          </Panel>
        )}

        {a && (
          <>
            <div className="dp-panel-tight" style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: 'var(--fg-dim)' }}>
              <span>推荐流程：先去商城下一单（或改地址、申请退款）→ 回来问助手，它读到的就是你刚操作过的那张单。</span>
              <a className="dp-btn" style={{ fontSize: 11, marginLeft: 'auto' }} href={page('shop')}>打开商城 →</a>
            </div>

            <ChatPanel assets={a} llm={{ live: llm.live, mode: llm.mode }} />
            <p style={{ margin: '-4px 2px 0', fontSize: 11, lineHeight: 1.7, color: 'var(--fg-faint)' }}>
              {a.replay.length} 组真实对话回放（{turns} 轮，其中 {toolTurns} 个工具轮）：状态链、工具入参与结果、assistant 文本分别来自项目里的真实产物，拼接处已标注。
            </p>

            <details className="dp-panel-tight" style={{ padding: 14 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--fg-dim)' }}>
                看意图路由、知识库检索与 5 个工具的契约
              </summary>
              <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
                <IntentPanel assets={a} llm={{ live: llm.live, mode: llm.mode }} />
                <KbPanel assets={a} llm={{ live: llm.live, mode: llm.mode }} />
                <Panel title="5 个工具的契约" subtitle="共用一个信封：参数校验、错误可枚举；只读工具不登记幂等，写操作先确认再落库，成功后只登记一次。">
                  <div style={{ overflowX: 'auto' }} className="dp-scroll">
                    <table className="dp-mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr style={{ color: 'var(--fg-faint)', textAlign: 'left' }}>
                          <th style={{ padding: '6px 8px' }}>工具</th>
                          <th style={{ padding: '6px 8px' }}>副作用</th>
                          <th style={{ padding: '6px 8px' }}>幂等</th>
                          <th style={{ padding: '6px 8px' }}>错误类型</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.tools.map((t) => (
                          <tr key={t.name} style={{ borderTop: '1px solid var(--line-soft)', color: 'var(--fg-dim)' }}>
                            <td style={{ padding: '6px 8px', color: 'var(--fg)' }}>{t.name}</td>
                            <td style={{ padding: '6px 8px', color: t.side_effect === 'write' ? 'var(--warn)' : 'var(--live)' }}>{t.side_effect}</td>
                            <td style={{ padding: '6px 8px' }}>{String(t.idempotent)}</td>
                            <td style={{ padding: '6px 8px', maxWidth: 260 }}>{String(t.error_kinds)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 11.5, lineHeight: 1.8, color: 'var(--fg-dim)' }}>
                    <li>只读工具不登记幂等：重复读没有副作用，登记反而会让第二次读被误判成重复写</li>
                    <li>幂等键命中 → 不执行、直接回放首次结果（duplicate=true）</li>
                    <li>只在成功后登记：否则「第一次 5xx 失败」会被记成已执行，用户永远退不了款</li>
                    <li>need_confirmation 的结果不登记：否则用户确认后那次真调用会被判成 duplicate 吞掉</li>
                  </ul>
                </Panel>
              </div>
            </details>

            <details className="dp-panel-tight" style={{ padding: 14 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--fg-dim)' }}>用自己的 API key（可选）</summary>
              <p style={{ margin: '10px 0 8px', fontSize: 11.5, lineHeight: 1.7, color: 'var(--fg-faint)' }}>
                不填也能用：意图兜底、实时 ReAct、真语义检索走本站自带的模型通道；规则路由、工具执行与回放完全不需要 key。
              </p>
              <KeyBar llm={llm} note="填了 key 只存在你自己浏览器的 localStorage，本站不中转、不记录。" />
            </details>
          </>
        )}

        <Footer />
      </div>
    </PageShell>
  );
}

export default App;
