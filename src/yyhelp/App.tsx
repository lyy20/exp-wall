// P2 页壳：把意图路由、对话/ReAct、知识库检索、工具契约与溯源拼成一条可验收的链。
import { useEffect, useState } from 'react';
import { useLlm } from '../shared/llm/useLlm';
import { Badge, CodeBlock, Footer, KeyValue, PageShell, Panel, StatTile, SubHeader } from '../shared/ui/core';
import { KeyBar } from '../shared/ui/llm-ui';
import { ChatPanel } from './ChatPanel';
import { IntentPanel } from './IntentPanel';
import { KbPanel } from './KbPanel';
import { fmtBytes, loadYyAssets, type YyAssets } from './assets';

const TRACE_ROW = '{"kind": "trace_end", "trace_id": "a14af817f7164f868ec375884a4faa33", "ts": "2026-10-03T09:35:07.886+00:00", "name": "selftest-degrade", "status": "ok", "duration_ms": 1.042, "span_count": 2, "error_count": 0, "cost_usd": 2.7e-05, "usage_total": {"input_tokens": 100, "output_tokens": 20, "cached_tokens": 0}, "tags": {"user_id": "u_test"}}';

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
        kicker="Demo 02 · 应用层"
        title="YYHelp 电商智能客服平台"
        subtitle="多轮对话 Agent 的真实问题不是「答得像不像」，而是「多轮之后它还记不记得、调不调得对、写操作会不会重复扣款」。所以这里能看的是：意图怎么被路由、工具怎么被约束、状态怎么被持久化、失败怎么被区分。"
        right={<Badge tone="live">真规则 · 真工具 · 真幂等</Badge>}
      />

      <div className="dp-wrap" style={{ paddingBottom: 60, display: 'grid', gap: 16 }}>
        <Panel title="先看边界：这页在真跑什么" subtitle="把「真跑」与「未做」分开写，避免面试时被一句「这是演示吧」问住。">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <div className="dp-panel-tight" style={{ padding: 14 }}>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--live)', fontWeight: 700 }}>真跑（现在就能验证）</p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.85, color: 'var(--fg-dim)' }}>
                <li>意图路由：{a ? a.intents.router_impl.rules.length : 13} 条正则/关键词规则在浏览器里真匹配，权重阈值 {a ? a.intents.router_impl.rule_threshold : 2} 真判</li>
                <li>知识库检索：stub 后端逐字复刻（单字覆盖度 + 关键词加成，k 上限 5），能真拿到「检索不到」</li>
                <li>5 个工具：参数校验、统一信封、错误分类、只读不登记幂等、写操作确认点与幂等回放，全部在浏览器执行</li>
                <li>ReAct 终止条件：{a ? String(a.config.max_steps) : '6'} 步 / {a ? String(a.config.max_wall_s) : '60'}s / 同 (tool,args) 第 3 次 真判</li>
                <li>{a ? a.replay.length : 17} 组真实对话回放：{turns} 轮、其中 {toolTurns} 个工具轮，工具信封是项目 venv 真跑出来的</li>
                <li>状态快照：按 langgraph 的真实表结构逐轮追加 checkpoint</li>
              </ul>
            </div>
            <div className="dp-panel-tight" style={{ padding: 14 }}>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--warn)', fontWeight: 700 }}>本期未做（不是包装）</p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.85, color: 'var(--fg-dim)' }}>
                <li>不跑 Python / LangGraph：状态机用 TypeScript 按同一套节点与终止条件重写，语义对齐但不是同一个运行时</li>
                <li>不连真实 Milvus 与订单库：库向量是从 Milvus parquet 导出的 int8 真向量，订单是项目源码里的真值 + 5 条标注补齐</li>
                <li>没有「完整对话日志」这回事：源项目里没有 assistant 角色的多轮日志，回放由三处真实产物拼装（下面逐条标注）</li>
                <li>语义检索需要你的 key（真 embedding）；项目默认走 stub，这不是我砍的，是线上默认状态</li>
              </ul>
            </div>
          </div>
        </Panel>

        <KeyBar llm={llm} note="只有「让 LLM 兜底判意图」和「实时 ReAct」「真语义检索」三步用 key；规则路由、工具执行、回放都零配置可跑。" />

        {err && <Panel title="资产加载失败"><p style={{ margin: 0, fontSize: 12, color: 'var(--err)' }}>{err}</p></Panel>}
        {!a && !err && <Panel title="正在加载数据资产…"><p style={{ margin: 0, fontSize: 12, color: 'var(--fg-dim)' }}>kb / kb_vectors / intents / tools / policy / orders / replay_chat / config</p></Panel>}

        {a && (
          <>
            <Panel title="一眼看规模">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                <StatTile label="意图 → 出口" value={a.intents.intents.length + ' → ' + a.intents.exits.length} sub={a.intents.router_impl.rules.length + ' 条规则 + LLM 兜底'} tone="live" />
                <StatTile label="知识库切片" value={String(a.kb.length)} sub={'向量 ' + a.kbMeta.count + '×' + a.kbMeta.dim + ' ' + a.kbMeta.dtype} tone="accent" />
                <StatTile label="工具" value={String(a.tools.length) + ' 个'} sub={a.tools.filter((t) => t.side_effect === 'write').length + ' 个写操作（唯一）'} tone="live" />
                <StatTile label="业务规则" value={String(a.policy.length) + ' 条'} sub="来自 8 个业务 md" tone="neutral" />
                <StatTile label="订单 fixture" value={String(a.orders.length) + ' 条'} sub={a.orders.filter((o) => o._extended).length + ' 条标注为补齐'} tone="replay" />
                <StatTile label="回放对话" value={a.replay.length + ' 组 / ' + turns + ' 轮'} sub={toolTurns + ' 个工具轮 · ' + fmtBytes(Object.values(a.bytes).reduce((x, y) => x + y, 0))} tone="warn" />
              </div>
            </Panel>

            <IntentPanel assets={a} llm={{ live: llm.live }} />
            <ChatPanel assets={a} llm={{ live: llm.live }} />
            <KbPanel assets={a} llm={{ live: llm.live }} />

            <Panel title="工具契约：为什么「工具失败」不等于「系统崩溃」" subtitle="5 个工具共用一个信封，错误必须可枚举；只读不登记幂等，写操作先确认再落库，成功后只登记一次。">
              <div style={{ overflowX: 'auto' }} className="dp-scroll">
                <table className="dp-mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ color: 'var(--fg-faint)', textAlign: 'left' }}>
                      <th style={{ padding: '6px 8px' }}>工具</th>
                      <th style={{ padding: '6px 8px' }}>副作用</th>
                      <th style={{ padding: '6px 8px' }}>幂等</th>
                      <th style={{ padding: '6px 8px' }}>可并行</th>
                      <th style={{ padding: '6px 8px' }}>错误类型</th>
                      <th style={{ padding: '6px 8px' }}>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.tools.map((t) => (
                      <tr key={t.name} style={{ borderTop: '1px solid var(--line-soft)', color: 'var(--fg-dim)' }}>
                        <td style={{ padding: '6px 8px', color: 'var(--fg)' }}>{t.name}</td>
                        <td style={{ padding: '6px 8px', color: t.side_effect === 'write' ? 'var(--warn)' : 'var(--live)' }}>{t.side_effect}</td>
                        <td style={{ padding: '6px 8px' }}>{String(t.idempotent)}</td>
                        <td style={{ padding: '6px 8px' }}>{String(t.parallel)}</td>
                        <td style={{ padding: '6px 8px', maxWidth: 240 }}>{String(t.error_kinds)}</td>
                        <td style={{ padding: '6px 8px', maxWidth: 380 }}>{Object.keys(t.params).length} 个参数 · 上限 {String(t.max_observation_chars)} 字符 · {t.fixture_source ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
                <CodeBlock maxHeight={200}>{'ToolResult {\n  tool: string\n  ok: boolean\n  data: {...} | null\n  error: { kind, message, detail, retryable } | null\n  idempotency_key: string\n  duplicate?: boolean\n  truncated?: boolean\n  elapsed_ms: number\n  meta: { side_effect: "read"|"write" }\n}'}</CodeBlock>
                <div className="dp-panel-tight" style={{ padding: 12 }}>
                  <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--fg)' }}>四条不可交换的规则（源码原样）</p>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, lineHeight: 1.8, color: 'var(--fg-dim)' }}>
                    <li>只读工具不登记幂等：重复读没有副作用，登记反而会让第二次读被误判成重复写</li>
                    <li>幂等键命中 → 不执行、直接回放首次结果（duplicate=true, replayed_from=idempotency_store）</li>
                    <li>只在成功后登记：若失败也登记，「第一次 5xx 失败」会被记成已执行，用户永远退不了款</li>
                    <li>need_confirmation 的结果不登记、不计副作用：否则用户确认后的那次真调用会被判成 duplicate 吞掉</li>
                  </ul>
                  <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--fg-faint)', lineHeight: 1.6 }}>
                    工具结果进模型上下文前统一包成 &lt;untrusted_data&gt;…&lt;/untrusted_data&gt; 并附 [notice]（上限 {String(a.config.max_observation_chars)} 字符）：注入隔离只在 observation 层做，所以工具不允许把裸 JSON 塞进上下文。
                  </p>
                </div>
              </div>
            </Panel>

            <Panel title="溯源与边界：哪些是原样，哪些是拼装" subtitle="这个项目的「数据缺口」比「数据」更值得看 —— 缺口怎么被标注，才决定结论能不能用。">
              <div style={{ display: 'grid', gap: 10 }}>
                <div className="dp-panel-tight" style={{ padding: 12 }}>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--fg)' }}>① 对话回放的三处真实来源</p>
                  <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--fg-dim)', lineHeight: 1.7 }}>
                    状态链取自 D:/yyhelp/data/demo_ckpt.db（唯一真实会话 thread_id=cross：我要退款 → refund_flow → 工单 TK-1001-073C3C → answered）；
                    工具轮的 args/result 来自用项目 venv 真实调用 5 个 @tool 的落盘证据（D:/DSH_Plot/code/_yyhelp_tool_evidence.json 与 _yyhelp_replay_evidence.json）；
                    assistant 文本取自 D:/DSH_AI_Product/output/yyhelp-v2/ab/ 目录下 multi 与 single 两份 perquestion.jsonl（各 40 行，无时间戳、只记工具名不记入参）。
                  </p>
                </div>
                <div className="dp-panel-tight" style={{ padding: 12 }}>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--warn)' }}>② 明确标注为「拼接」或「没有」的部分</p>
                  <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--fg-dim)', lineHeight: 1.7 }}>
                    源项目里没有任何 assistant 角色的多轮对话日志（trace.jsonl 683 行与 _selftest/compare.jsonl 都是单轮 span 级、且不记录工具入参和结果），所以「多轮」是拼装而非现成日志；
                    意图标注集的两组对话（ic_I06 / ic_I47）只有两轮用户原话、没有模型回复，页面上也如实只显示用户轮。
                  </p>
                </div>
                <div className="dp-panel-tight" style={{ padding: 12 }}>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--accent, #B600A8)' }}>③ 订单 fixture 的真值边界</p>
                  <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--fg-dim)', lineHeight: 1.7 }}>
                    字段名以源码为真：order_no / user_id / status / status_cn / total_amount / created_at / tracking_no / refundable / items（sku / name / qty）/ events（time / node / city）（任务书里写的 order_id / carrier / shipped 在源码中不存在，写进去会 pydantic ValidationError）。
                    1001–1005 是源码真值，1006–1010 标 _extended=true 补齐，页面上可以逐条看到标记。
                  </p>
                </div>
                <div className="dp-panel-tight" style={{ padding: 12 }}>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--fg)' }}>④ 可观测性的一行真数据（trace.jsonl）</p>
                  <CodeBlock maxHeight={140}>{TRACE_ROW}</CodeBlock>
                  <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--fg-faint)', lineHeight: 1.6 }}>
                    键：kind / trace_id / ts / name / status / duration_ms / span_count / error_count / cost_usd / usage_total（input_tokens / output_tokens / cached_tokens）/ price_source / price_asof / tags。
                  </p>
                </div>
              </div>
            </Panel>

            <Panel title="资产自检">
              <KeyValue columns={2} items={[
                ...Object.entries(a.bytes).map(([k, v]) => [k, fmtBytes(v)] as [string, string]),
                ['kb 来源', a.kb[0]?.source ?? '—'],
                ['回放来源', a.replay[0]?.source ?? '—'],
                ['config.llm_model', String(a.config.llm_model ?? '—') + '（@ ' + String(a.config.llm_base_url ?? '—') + '）'],
                ['config.kb_retrieve', String(a.config.kb_retrieve ?? '—') + ' · index_version ' + String(a.config.index_version ?? '—')],
              ]} />
            </Panel>
          </>
        )}

        <Footer />
      </div>
    </PageShell>
  );
}

export default App;
