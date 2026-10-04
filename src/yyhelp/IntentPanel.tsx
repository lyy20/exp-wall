// P2 意图路由台：13 条正则规则在浏览器里真跑，LLM 只做兜底。
import { useMemo, useState } from 'react';
import { chatStream, describeError } from '../shared/llm/client';
import { Badge, Chip, Panel, StatTile } from '../shared/ui/core';
import { ModeBadge } from '../shared/ui/llm-ui';
import type { LlmMode } from '../shared/llm/mode';
import type { YyAssets } from './assets';
import { decide, ruleClassify } from './engine';

const SAMPLES = ['我要退款', '运费怎么算', '运单号 EX1001TEST023 查不到', '多久能到', '怎么弄啊', '今天天气怎么样', '订单 1001 什么时候到'];

export function IntentPanel({ assets, llm }: { assets: YyAssets; llm: { live: boolean; mode: LlmMode } }) {
  const [text, setText] = useState('我要退款');
  const [llmIntent, setLlmIntent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ title: string; detail: string } | null>(null);
  const [raw, setRaw] = useState('');

  const file = assets.intents;
  const rules = file.router_impl.rules;
  const hits = useMemo(() => ruleClassify(text, rules, file.router_impl.rule_threshold).hits, [text, rules, file.router_impl.rule_threshold]);
  const hitIndex = useMemo(() => new Map(hits.map((h) => [h.index, h])), [hits]);
  const d = useMemo(() => decide(text, file, { llmIntent, hasLlm: llm.live }), [text, file, llmIntent, llm.live]);

  const askLlm = async () => {
    if (busy || !llm.live) return;
    setBusy(true); setErr(null); setRaw(''); setLlmIntent(null);
    let out = '';
    try {
      const res = await chatStream([
        { role: 'system', content: (file.router_prompt || '') + '\n只输出 JSON，形如 {"intent":"<九类之一>"}。' },
        { role: 'user', content: text },
      ], { maxTokens: 120, onToken: (c) => { out += c; setRaw(out); } });
      const m = /\{[^}]*\}/.exec(res.text || out);
      const parsed = m ? (JSON.parse(m[0]) as { intent?: string }) : null;
      const valid = parsed?.intent && file.intents.some((i) => i.name === parsed.intent);
      if (valid) setLlmIntent(parsed!.intent!);
      else setErr({ title: '模型输出无法校验为九类之一', detail: '项目里的处理是 fallback：' + file.router_impl.fallback.with_llm });
    } catch (e) { setErr(describeError(e)); }
    setBusy(false);
  };

  const methodLabel: Record<string, string> = {
    rule: '规则命中（正则，未调用模型）', llm: '规则弃权 → LLM 判定', 'fallback-llm': '规则弃权 + LLM 校验失败 → fallback', 'fallback-no-llm': '规则弃权且无 key → fallback',
  };

  const nodePath = ['START', 'triage', d.node, ...(d.node === 'agent_memory' ? [] : ['agent_memory']), 'react_step', '…', 'finalize', 'END'];

  return (
    <Panel
      title="意图路由台：规则优先，模型兜底"
      subtitle="这不是「让大模型分类」。项目里九类意图先过 13 条正则/关键词规则（权重最大的命中，权重 < 2 就弃权），只有弃权时才调用模型。下面每一条规则都在浏览器里真跑。"
      right={<ModeBadge mode={llm.mode} liveLabel="可用模型兜底" replayLabel="纯规则模式" />}
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input className="dp-input" style={{ flex: '1 1 340px' }} value={text} onChange={(e) => { setText(e.target.value); setLlmIntent(null); }} placeholder="说一句话，看它被路由到哪个出口…" />
        <button type="button" className="dp-btn dp-btn-primary" onClick={() => void askLlm()} disabled={!llm.live || busy || (d.best !== null && d.best.weight >= 2)}>
          {busy ? '模型判定中…' : '规则弃权时让 LLM 判定'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {SAMPLES.map((s) => <Chip key={s} onClick={() => { setText(s); setLlmIntent(null); }}>{s}</Chip>)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 14 }}>
        <StatTile label="判定意图" value={d.intent} sub={'置信度 ' + d.confidence.toFixed(2)} tone="live" />
        <StatTile label="判定方式" value={d.method.startsWith('rule') ? '规则' : d.method === 'llm' ? 'LLM' : 'Fallback'} sub={methodLabel[d.method]} tone={d.method === 'rule' ? 'live' : d.method === 'llm' ? 'replay' : 'warn'} />
        <StatTile label="出口" value={d.exit} sub={assets.intents.exits.find((e) => e.id === d.exit)?.name ?? ''} tone="accent" />
        <StatTile label="命中规则" value={String(hits.length) + ' 条'} sub={'总权重 ' + d.totalWeight + ' · 阈值 ' + file.router_impl.rule_threshold} tone={d.best?.weight && d.best.weight >= 2 ? 'live' : 'warn'} />
      </div>

      <div className="dp-panel-tight" style={{ marginTop: 12, padding: 12 }}>
        <p className="dp-mono" style={{ margin: 0, fontSize: 12, color: 'var(--fg-dim)' }}>{nodePath.join('  →  ')}</p>
        <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--fg-faint)', lineHeight: 1.65 }}>
          出口节点 {d.node}｜是否需要知识库：{d.needsKb ? '需要（EXIT_NEEDS_KB=True）' : '不需要'}
          {d.abstained ? '｜规则已弃权（权重不足 2）：' + file.router_impl.rule_note : ''}
        </p>
      </div>

      {err && <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--err)' }}>{err.title}：{err.detail}</p>}
      {raw && <p className="dp-mono" style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--replay)' }}>模型原始输出：{raw.slice(0, 200)}</p>}

      <div style={{ marginTop: 14, overflowX: 'auto' }} className="dp-scroll">
        <table className="dp-mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ color: 'var(--fg-faint)', textAlign: 'left' }}>
              <th style={{ padding: '6px 8px' }}>#</th>
              <th style={{ padding: '6px 8px' }}>意图</th>
              <th style={{ padding: '6px 8px' }}>权重</th>
              <th style={{ padding: '6px 8px' }}>正则</th>
              <th style={{ padding: '6px 8px' }}>命中片段</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r, i) => {
              const h = hitIndex.get(i + 1);
              return (
                <tr key={i} style={{ borderTop: '1px solid var(--line-soft)', background: h ? 'rgba(61,220,151,0.07)' : 'transparent', color: h ? 'var(--fg)' : 'var(--fg-faint)' }}>
                  <td style={{ padding: '5px 8px' }}>{i + 1}</td>
                  <td style={{ padding: '5px 8px' }}>{r.intent}</td>
                  <td style={{ padding: '5px 8px' }}>{r.weight}</td>
                  <td style={{ padding: '5px 8px', maxWidth: 420, wordBreak: 'break-all' }}>{r.pattern}</td>
                  <td style={{ padding: '5px 8px', color: 'var(--live)' }}>{h ? h.matched : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        {assets.intents.exits.map((e) => (
          <div key={e.id} className="dp-panel-tight" style={{ padding: 10, borderColor: e.id === d.exit ? 'var(--live)' : undefined }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Badge tone={e.id === d.exit ? 'live' : 'neutral'}>{e.id}</Badge>
              <span style={{ fontSize: 12, color: 'var(--fg)' }}>{e.name}</span>
              <span className="dp-mono" style={{ fontSize: 10.5, color: 'var(--fg-faint)' }}>node={e.node} · needs_kb={String(e.needs_kb)}</span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--fg-dim)', lineHeight: 1.6 }}>{e.desc}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}
