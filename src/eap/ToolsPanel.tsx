// P3 工具契约：8 个外部能力的四段式契约 + 浏览器内真跑的参数门禁与循环控制。
import { useState } from 'react';
import { Badge, Chip, KeyValue, Panel } from '../shared/ui/core';
import { loopControlMessage, sampleArgs, validateCall, type ToolContract } from './assets';

type Verdict = { ok: boolean; code?: string; message: string; detail?: string };

export function ToolsPanel({ tools }: { tools: ToolContract[] }) {
  const [sel, setSel] = useState(0);
  const [argsText, setArgsText] = useState(() => JSON.stringify(sampleArgs(tools[0]), null, 2));
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [calls, setCalls] = useState<Record<string, number>>({});
  const t = tools[sel];

  const pick = (i: number) => { setSel(i); setArgsText(JSON.stringify(sampleArgs(tools[i]), null, 2)); setVerdict(null); };

  const mutate = (fn: (a: Record<string, unknown>) => void) => {
    try {
      const a = JSON.parse(argsText) as Record<string, unknown>;
      fn(a);
      setArgsText(JSON.stringify(a, null, 2));
      setVerdict(null);
    } catch { setVerdict({ ok: false, code: 'BAD_ARGUMENT', message: '[BAD_ARGUMENT] 参数不是合法 JSON，先修好再改' }); }
  };

  const call = () => {
    let parsed: unknown;
    try { parsed = JSON.parse(argsText); } catch (e) {
      setVerdict({ ok: false, code: 'BAD_ARGUMENT', message: '[BAD_ARGUMENT] 参数不是合法 JSON：' + (e as Error).message });
      return;
    }
    const res = validateCall(t, parsed);
    if (!res.ok) { setVerdict(res); return; }
    const key = t.name + '|' + JSON.stringify(parsed);
    const n = (calls[key] ?? 0) + 1;
    setCalls({ ...calls, [key]: n });
    if (n >= 2) {
      setVerdict({
        ok: false, code: 'BAD_ARGUMENT', message: loopControlMessage(t.name, n),
        detail: '循环控制在第 2 次「同工具同参数」调用时拦下（eap/resilience.py:251-255）。这个计数就是浏览器里的真实拦截状态，不是文案演示 —— 再点一次仍会被拦，改一个参数才会放行。',
      });
      return;
    }
    setVerdict({
      ok: true,
      message: '通过：' + t.name + ' 已按契约执行（参数门禁 + ' + t.timeout_ms + ' ms 超时预算 + ' + (t.readonly ? '只读' : '写操作') + (t.idempotent ? ' · 幂等' : '') + '）',
      detail: '契约声明返回：' + t.returns,
    });
  };

  return (
    <Panel
      title="工具契约：8 个能力，四段式写清「什么时候不该用」"
      subtitle="为什么不是一句 description 就够：模型最容易犯的错不是调错参数，而是在不该调的时候调。所以每个工具都要写 what / when / when_not / on_fail 四段，参数用 enum 收缩猜测空间。"
      right={<Badge tone="live">门禁可真跑</Badge>}
    >
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {tools.map((x, i) => (
          <Chip key={x.name} active={i === sel} onClick={() => pick(i)}>{x.name}</Chip>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10, marginTop: 14 }}>
        {([['what', '做什么', 'live'], ['when', '何时该用', 'live'], ['when_not', '何时不该用', 'warn'], ['on_fail', '失败怎么办', 'replay']] as const).map(([k, label, tone]) => (
          <div key={k} className="dp-panel-tight" style={{ padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Badge tone={tone}>{label}</Badge>
              <span className="dp-mono" style={{ fontSize: 10, color: 'var(--fg-faint)' }}>{k}</span>
            </div>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: 'var(--fg-dim)' }}>{t[k]}</p>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        <KeyValue columns={2} items={[
          ['超时预算', t.timeout_ms + ' ms'],
          ['只读 / 幂等', (t.readonly ? '只读' : '可写') + ' / ' + (t.idempotent ? '幂等' : '非幂等')],
          ['参数个数', String(Object.keys(t.params ?? {}).length)],
          ['溯源句柄', t.returns.slice(Math.max(0, t.returns.indexOf('（溯源')), t.returns.indexOf('（溯源') + 120) || '见 returns'],
        ]} />
      </div>

      <div style={{ marginTop: 14 }}>
        <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--fg)', fontWeight: 600 }}>参数表（enum 即猜测空间的边界）</p>
        <div style={{ display: 'grid', gap: 6 }}>
          {Object.entries(t.params ?? {}).map(([name, p]) => (
            <div key={name} className="dp-panel-tight" style={{ padding: '8px 10px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <span className="dp-mono" style={{ fontSize: 12, color: 'var(--fg)', fontWeight: 600 }}>{name}</span>
              <span className="dp-mono" style={{ fontSize: 10.5, color: 'var(--fg-faint)' }}>{p.type}{p.required ? ' · 必填' : ' · 可选'}</span>
              {p.enum && <span className="dp-mono" style={{ fontSize: 10.5, color: 'var(--replay)' }}>[{p.enum.join(' | ')}]</span>}
              <span style={{ fontSize: 11, color: 'var(--fg-dim)', flex: '1 1 240px' }}>{p.desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--fg)', fontWeight: 600 }}>亲手试：把这份调用喂给门禁</p>
        <textarea
          className="dp-input dp-mono"
          style={{ minHeight: 132, fontSize: 12, lineHeight: 1.6, resize: 'vertical' }}
          value={argsText}
          onChange={(e) => { setArgsText(e.target.value); setVerdict(null); }}
          spellCheck={false}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <button type="button" className="dp-btn dp-btn-primary" onClick={call}>调用 {t.name}</button>
          <button type="button" className="dp-btn" onClick={() => setArgsText(JSON.stringify(sampleArgs(t), null, 2))}>重置为合法调用</button>
          <button type="button" className="dp-btn" onClick={() => mutate((a) => { for (const [k, p] of Object.entries(t.params)) if (p.required) { delete a[k]; break; } })}>删掉一个必填项</button>
          <button type="button" className="dp-btn" onClick={() => mutate((a) => { for (const [k, p] of Object.entries(t.params)) if (p.enum?.length) { a[k] = 'bogus_value'; return; } a.bogus = 'x'; })}>塞一个越界值</button>
          <button type="button" className="dp-btn" onClick={() => mutate((a) => { a.extra_field = 1; })}>塞一个多余字段</button>
        </div>
        {verdict && (
          <div className="dp-panel-tight" style={{ marginTop: 10, padding: 12, borderColor: verdict.ok ? 'var(--live)' : 'var(--err)' }}>
            <p className="dp-mono" style={{ margin: 0, fontSize: 12, color: verdict.ok ? 'var(--live)' : 'var(--err)', fontWeight: 600 }}>{verdict.message}</p>
            {verdict.detail && <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--fg-dim)', lineHeight: 1.65 }}>{verdict.detail}</p>}
          </div>
        )}
        <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--fg-faint)', lineHeight: 1.6 }}>
          说明：这里的门禁是浏览器内的确定性实现（参数表 / 类型 / enum / 必填 / 循环控制），规则照抄 Python 侧契约；
          真实项目里由 eap/policy.py 与 resilience.py 执行，本页不含任何 LLM 判定。
        </p>
      </div>
    </Panel>
  );
}
