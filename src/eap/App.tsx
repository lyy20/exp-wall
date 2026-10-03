// P3 EAP 页：把「LLM 不得参与数值计算、不得自判正确性」做成可现场验证的演示。
import { useEffect, useState } from 'react';
import { useLlm } from '../shared/llm/useLlm';
import { Badge, Footer, KeyValue, PageShell, Panel, StatTile, SubHeader } from '../shared/ui/core';
import { KeyBar } from '../shared/ui/llm-ui';
import { AuditPanel } from './AuditPanel';
import { StatsPanel } from './StatsPanel';
import { ToolsPanel } from './ToolsPanel';
import { WordingPanel } from './WordingPanel';
import { fmtBytes, loadEapAssets, type EapAssets } from './assets';

export function App() {
  const llm = useLlm('deepseek');
  const [a, setA] = useState<EapAssets | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadEapAssets().then((x) => { if (alive) setA(x); }).catch((e) => { if (alive) setErr(String((e as Error)?.message ?? e)); });
    return () => { alive = false; };
  }, []);

  const totalPts = a ? a.series.runs.reduce((s, r) => s + r.ys.length, 0) : 0;

  return (
    <PageShell>
      <SubHeader
        kicker="Demo 01 · 平台层"
        title="科研实验分析助手 Agent"
        subtitle="一个把「可溯源、可拒答、可审计」写在第一行的实验分析平台：8 个外部工具用四段式契约约束，9 类错误码区分「没取到」与「没有数据」，所有统计量在确定性代码里算，LLM 只被允许改写措辞 —— 而且写出来的话还要过一遍代码检查器。"
        right={<Badge tone="live">真计算 · 真门禁</Badge>}
      />

      <div className="dp-wrap" style={{ paddingBottom: 60, display: 'grid', gap: 16 }}>
        <Panel
          title="先看边界：这页在真跑什么"
          subtitle="面试时最怕被问「这里面哪部分是演示」。所以把真跑与未做分开写清。"
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <div className="dp-panel-tight" style={{ padding: 14 }}>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--live)', fontWeight: 700, letterSpacing: '0.06em' }}>真跑（你现在就能验证）</p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.85, color: 'var(--fg-dim)' }}>
                <li>契约门禁：参数表 / 类型 / 必填 / enum 越界都在浏览器里被判，拒绝理由是真实规则而非文案</li>
                <li>循环控制：同工具同参数第 2 次调用被拦（对应 resilience.py:251-255）</li>
                <li>统计重算：{a ? a.golden.series.length : 10} 条真实序列 × 8 个统计量在浏览器重算，逐字段对齐 scipy/numpy golden</li>
                <li>Welch t 检验：{a ? a.golden.welch_tests.length : 4} 组不等方差检验重算 t / df / p</li>
                <li>措辞检查器：禁词表 + 必要声明按 inference.py 的真实规则执行，LLM 输出也要过它</li>
                <li>证据链与台账：{a ? a.audit.claims.length : 11} 条论断的 raw/derived 溯源、{a ? a.runs.runs.length : 5} 条报告记录的判定依据</li>
              </ul>
            </div>
            <div className="dp-panel-tight" style={{ padding: 14 }}>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--warn)', fontWeight: 700, letterSpacing: '0.06em' }}>本期未做（刻意砍掉，不是包装）</p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.85, color: 'var(--fg-dim)' }}>
                <li>真实训练日志接入：源数据是本地 {a ? '146.5 GB' : '146.5 GB'} 的 SAC 日志目录与 SQLite 台账，静态站只带走导出后的真实序列与 golden 值</li>
                <li>真实工具 I/O：8 个工具的四个段是真实契约，但线上没有后端去执行它们，参数门禁是真跑、执行是本地模拟</li>
                <li>LLM 数值参与：<b>永不做</b> —— 这是项目的第一条设计约束，不是没实现</li>
                <li>LLM 回放素材：项目日志里没有模型回答记录，所以本页没有回放；想现场看模型改写请填 key（改写结果仍要被检查器判）</li>
              </ul>
            </div>
          </div>
        </Panel>

        <KeyBar llm={llm} note="只有「让 LLM 试着重写措辞」这一步会用到 key；其余全部是浏览器内确定性计算。key 只存在你的 localStorage。" />

        {err && <Panel title="资产加载失败"><p style={{ margin: 0, fontSize: 12, color: 'var(--err)' }}>{err}</p></Panel>}
        {!a && !err && <Panel title="正在加载数据资产…"><p style={{ margin: 0, fontSize: 12, color: 'var(--fg-dim)' }}>contracts / errors / runs / series / golden / audit_sample</p></Panel>}

        {a && (
          <>
            <Panel title="一眼看规模" subtitle="下面每个数字都对应一个可下载的资产文件。">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                <StatTile label="工具契约" value={String(a.contracts.count) + ' 个'} sub="每个四段式 + 参数表 + enum" tone="live" />
                <StatTile label="错误语义" value={String(a.errors.count) + ' 类'} sub={a.errors.errors.filter((e) => e.retryable).length + ' 类可重试'} tone="live" />
                <StatTile label="真实序列点" value={String(totalPts)} sub={a.series.runs.length + ' 条序列（配对两臂）'} tone="accent" />
                <StatTile label="golden 统计量" value={String(a.golden.series.length * 8)} sub={a.golden.computed_with} tone="accent" />
                <StatTile label="证据链" value={String(a.audit.claims.length) + ' 条'} sub="raw + derived 均可回溯" tone="replay" />
                <StatTile label="资产体积" value={fmtBytes(Object.values(a.bytes).reduce((x, y) => x + y, 0))} sub={Object.keys(a.bytes).length + ' 个 JSON'} tone="neutral" />
              </div>
            </Panel>

            <ToolsPanel tools={a.contracts.tools} />
            <StatsPanel series={a.series.runs} golden={a.golden} />
            <WordingPanel llm={{ live: llm.live, keyDraft: llm.keyDraft }} />
            <AuditPanel
              errors={a.errors.errors}
              audit={a.audit}
              runs={a.runs.runs}
              metricNames={a.runs.metric_names}
              replayNote={a.replay.note ?? '（未提供说明）'}
            />

            <Panel title="资产自检" subtitle="页面上的数字来自这些文件，这里把来源摊开。">
              <KeyValue
                columns={2}
                items={[
                  ...Object.entries(a.bytes).map(([k, v]) => [k, fmtBytes(v)] as [string, string]),
                  ['契约来源', a.contracts.source?.contract ?? '—'],
                  ['超时表来源', a.contracts.source?.tool_list ?? '—'],
                  ['错误语义来源', a.errors.source ?? '—'],
                  ['序列来源', a.series.source_note ?? '—'],
                ]}
              />
            </Panel>
          </>
        )}

        <Footer />
      </div>
    </PageShell>
  );
}

export default App;
