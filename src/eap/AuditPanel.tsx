// P3 证据链与错误语义：9 类错误的分支差异、11 条论断的可溯源证据、报告台账。
import { useState } from 'react';
import { Badge, Chip, Panel, StatTile } from '../shared/ui/core';
import type { AuditFile, ErrorSpec, RunRecord } from './assets';

function base(p: string): string {
  const seg = p.replace(/\\/g, '/').split('/');
  return seg.length > 2 ? '…/' + seg.slice(-2).join('/') : p;
}

export function AuditPanel({ errors, audit, runs, metricNames, replayNote }: {
  errors: ErrorSpec[]; audit: AuditFile; runs: RunRecord[]; metricNames: string[]; replayNote: string;
}) {
  const [kind, setKind] = useState<'all' | 'raw' | 'derived'>('all');
  const claims = audit.claims.filter((c) => kind === 'all' || c.evidence.kind === kind);
  const raw = audit.claims.filter((c) => c.evidence.kind === 'raw').length;
  const derived = audit.claims.length - raw;

  return (
    <>
      <Panel
        title="9 类错误语义：把「没取到」和「没有数据」分开"
        subtitle="科研场景里最严重的事故不是报错，而是把系统故障说成「实验没有结果」。所以错误码必须是可枚举的九类，每类有独立的触发条件、重试策略与用户话术。"
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
          {errors.map((e) => (
            <div key={e.code} className="dp-panel-tight" style={{ padding: 12 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="dp-mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg)' }}>{e.code}</span>
                <Badge tone={e.retryable ? 'live' : 'err'}>{e.retryable ? '可重试 ≤' + e.max_attempts : '不重试'}</Badge>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--fg-dim)', fontWeight: 600 }}>{e.name}</p>
              <p style={{ margin: '4px 0 0', fontSize: 11.5, lineHeight: 1.65, color: 'var(--fg-dim)' }}>{e.meaning}</p>
              <p className="dp-mono" style={{ margin: '6px 0 0', fontSize: 10.5, color: 'var(--fg-faint)', lineHeight: 1.6 }}>触发：{e.triggers}</p>
              {e.sample && <p className="dp-mono" style={{ margin: '6px 0 0', fontSize: 10.5, color: 'var(--replay)', lineHeight: 1.6, wordBreak: 'break-all' }}>{e.sample}</p>}
              {e.user_text && <p style={{ margin: '4px 0 0', fontSize: 10.5, color: 'var(--warn)' }}>用户可见文案：{e.user_text}</p>}
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="证据链：每条论断都能点回原始行"
        subtitle="报告里的每个数字都要能追到「哪个文件、哪一行、n 是多少」。raw = 原始 CSV/日志，derived = 入库后的确定性派生表。"
        right={<div style={{ display: 'flex', gap: 6 }}><Chip active={kind === 'all'} onClick={() => setKind('all')}>全部 {audit.claims.length}</Chip><Chip active={kind === 'raw'} onClick={() => setKind('raw')}>raw {raw}</Chip><Chip active={kind === 'derived'} onClick={() => setKind('derived')}>derived {derived}</Chip></div>}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
          <StatTile label="论断条数" value={String(audit.claims.length)} sub={'审计样本 run ' + audit.run_id} tone="neutral" />
          <StatTile label="raw 证据" value={String(raw)} sub="直接读到 CSV/日志原文" tone="live" />
          <StatTile label="derived 证据" value={String(derived)} sub="index.sqlite 派生表行号" tone="replay" />
          <StatTile label="台账 run 数" value={String(runs.length)} sub={runs.filter((r) => r.verdict === 'BASELINE').length + ' 基线 / ' + runs.filter((r) => r.verdict === 'REJECT').length + ' 否决 / ' + runs.filter((r) => r.verdict === 'NOT_EVALUATED').length + ' 未评估'} tone="accent" />
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {claims.map((c, i) => (
            <div key={i} className="dp-panel-tight" style={{ padding: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                <Badge tone={c.evidence.kind === 'raw' ? 'live' : 'replay'}>{c.evidence.kind}</Badge>
                {c.n !== undefined && <span className="dp-mono" style={{ fontSize: 10.5, color: 'var(--fg-faint)' }}>n = {c.n}</span>}
              </div>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.7, color: 'var(--fg)' }}>{c.claim}</p>
              <p className="dp-mono" style={{ margin: '6px 0 0', fontSize: 10.5, color: 'var(--fg-faint)', lineHeight: 1.6, wordBreak: 'break-all' }}>
                {base(c.evidence.file)} ｜ {c.evidence.offset}
              </p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="报告台账与边界说明"
        subtitle="项目里的 LLM 角色被刻意压到最小：它只允许读已算好的数、写成措辞合规的文本。"
      >
        <div style={{ overflowX: 'auto' }} className="dp-scroll">
          <table className="dp-mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead>
              <tr style={{ color: 'var(--fg-faint)', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>run_id</th>
                <th style={{ padding: '6px 8px' }}>n</th>
                <th style={{ padding: '6px 8px' }}>verdict</th>
                <th style={{ padding: '6px 8px' }}>判定依据</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.run_id} style={{ borderTop: '1px solid var(--line-soft)', color: r.verdict === 'REJECT' ? 'var(--warn)' : r.verdict === 'BASELINE' ? 'var(--live)' : 'var(--fg-dim)' }}>
                  <td style={{ padding: '6px 8px' }}>{r.run_id}</td>
                  <td style={{ padding: '6px 8px' }}>{r.n ?? '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{r.verdict ?? '—'}</td>
                  <td style={{ padding: '6px 8px', maxWidth: 520 }}>{r.verdict_kind ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--fg-dim)', lineHeight: 1.7 }}>
          指标名共 {metricNames.length} 个：<span className="dp-mono" style={{ color: 'var(--fg-faint)' }}>{metricNames.join(' · ')}</span>
        </p>
        <div className="dp-panel-tight" style={{ marginTop: 12, padding: 12 }}>
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--fg-dim)', lineHeight: 1.7 }}>
            <b style={{ color: 'var(--fg)' }}>关于本页的模型调用：</b>{replayNote}
          </p>
        </div>
      </Panel>
    </>
  );
}
