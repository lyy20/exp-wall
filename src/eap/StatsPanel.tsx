// P3 统计自检：浏览器内重算序列统计量与 Welch t 检验，逐字段与 Python golden 对比。
import { useMemo, useState } from 'react';
import { linreg, mean, median, quantile, std, sem, welchT } from '../shared/compute/stats';
import { Badge, Chip, KeyValue, Panel, Sparkline, StatTile } from '../shared/ui/core';
import type { GoldenFile, SeriesRec } from './assets';

const FIELDS: { key: keyof Computed; label: string; digits: number }[] = [
  { key: 'mean', label: 'mean', digits: 6 }, { key: 'std', label: 'std (ddof=1)', digits: 6 },
  { key: 'sem', label: 'sem', digits: 6 }, { key: 'median', label: 'median', digits: 6 },
  { key: 'p95', label: 'p95', digits: 6 }, { key: 'first', label: 'first', digits: 6 },
  { key: 'last', label: 'last', digits: 6 }, { key: 'slope', label: 'slope ×100', digits: 6 },
];

type Computed = { mean: number; std: number; sem: number; median: number; p95: number; first: number; last: number; slope: number };

function computeSerie(s: SeriesRec): Computed {
  const ys = s.ys;
  return {
    mean: mean(ys), std: std(ys, 1), sem: sem(ys), median: median(ys), p95: quantile(ys, 0.95),
    first: ys[0], last: ys[ys.length - 1], slope: linreg(s.xs, ys).slope * 100,
  };
}

function rel(a: number, b: number): number {
  const d = Math.abs(a - b);
  return d / Math.max(1e-12, Math.abs(b));
}

export function StatsPanel({ series, golden }: { series: SeriesRec[]; golden: GoldenFile }) {
  const [sel, setSel] = useState(0);
  const s = series[sel];
  const computed = useMemo(() => computeSerie(s), [s]);
  const g = golden.series.find((x) => x.run_id === s.run_id && x.metric === s.metric);

  const byKey = useMemo(() => {
    const m = new Map<string, SeriesRec>();
    for (const r of series) m.set(r.run_id + '|' + r.metric, r);
    return m;
  }, [series]);

  const welchRows = golden.welch_tests.map((w) => {
    const a = byKey.get(w.a);
    const b = byKey.get(w.b);
    const r = a && b ? welchT(a.ys, b.ys) : null;
    return { w, r, okT: r && Math.abs(r.t - w.t) < 1e-5, okDf: r && Math.abs(r.df - w.df) < 1e-4, okP: r && Math.abs(r.p - w.p) < 1e-9 };
  });

  const allSeriesOk = golden.series.every((gx) => {
    const src = byKey.get(gx.run_id + '|' + gx.metric);
    if (!src) return false;
    const c = computeSerie(src);
    return rel(c.mean, gx.mean) < 1e-9 && rel(c.std, gx.std) < 1e-9 && rel(c.sem, gx.sem) < 1e-9 &&
      rel(c.median, gx.median) < 1e-9 && rel(c.p95, gx.p95) < 1e-9 && rel(c.first, gx.first) < 1e-12 &&
      rel(c.last, gx.last) < 1e-12 && rel(c.slope, gx.slope_per_100) < 1e-9;
  });
  const welchOk = welchRows.filter((x) => x.okT && x.okDf && x.okP).length;

  return (
    <Panel
      title="数值全部在确定性代码里算：浏览器重算 vs Python golden"
      subtitle="这是这个项目最核心的约束：LLM 不允许参与任何数值计算，也不允许判定自己输出的正确性。所以这页把 1000 个真实点上的统计量在浏览器里重算一遍，逐字段对齐 scipy/numpy 的 golden 值。"
      right={<Badge tone={allSeriesOk && welchOk === welchRows.length ? 'live' : 'warn'}>{allSeriesOk && welchOk === welchRows.length ? '全部一致' : '存在差异'}</Badge>}
    >
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {series.map((x, i) => (
          <Chip key={x.run_id + x.metric + i} active={i === sel} onClick={() => setSel(i)}>
            {x.run_id.slice(-6)} · {x.metric}
          </Chip>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 12 }}>
        <StatTile label="序列" value={s.metric.split('/')[0]} sub={s.run_id + ' · n=' + s.ys.length} tone="neutral" />
        <StatTile label="均值 mean" value={computed.mean.toFixed(4)} sub={'golden ' + (g?.mean.toFixed(4) ?? '—')} tone="live" />
        <StatTile label="标准差 std" value={computed.std.toFixed(4)} sub={'golden ' + (g?.std.toFixed(4) ?? '—')} tone="live" />
        <StatTile label="每 100 episode 斜率" value={computed.slope.toFixed(4)} sub={'golden ' + (g?.slope_per_100.toFixed(4) ?? '—')} tone="accent" />
      </div>

      <div style={{ marginTop: 12 }}>
        <Sparkline values={s.ys} height={64} width={1200} color="#7AA2FF" />
        <p className="dp-mono" style={{ margin: '6px 0 0', fontSize: 10.5, color: 'var(--fg-faint)' }}>
          来源：{s.source ?? 'filter_on_off_pair_summary.csv'}（每点 = 一次真实 episode 的评测行）
        </p>
      </div>

      <div style={{ marginTop: 14, overflowX: 'auto' }} className="dp-scroll">
        <table className="dp-mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
          <thead>
            <tr style={{ color: 'var(--fg-faint)', textAlign: 'left' }}>
              <th style={{ padding: '6px 8px' }}>统计量</th>
              <th style={{ padding: '6px 8px' }}>浏览器内重算</th>
              <th style={{ padding: '6px 8px' }}>Python golden</th>
              <th style={{ padding: '6px 8px' }}>相对误差</th>
              <th style={{ padding: '6px 8px' }}>结论</th>
            </tr>
          </thead>
          <tbody>
            {FIELDS.map((f) => {
              const mine = computed[f.key];
              const theirs = g ? (f.key === 'slope' ? g.slope_per_100 : (g as unknown as Record<string, number>)[f.key]) : NaN;
              const d = rel(mine, theirs);
              const ok = d < 1e-6;
              return (
                <tr key={f.key} style={{ borderTop: '1px solid var(--line-soft)', color: ok ? 'var(--fg-dim)' : 'var(--err)' }}>
                  <td style={{ padding: '6px 8px' }}>{f.label}</td>
                  <td style={{ padding: '6px 8px' }}>{mine.toFixed(f.digits)}</td>
                  <td style={{ padding: '6px 8px' }}>{Number.isFinite(theirs) ? theirs.toFixed(f.digits) : '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{d.toExponential(1)}</td>
                  <td style={{ padding: '6px 8px' }}>{ok ? '✅ 一致' : '❌ 不一致'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16 }}>
        <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--fg)', fontWeight: 600 }}>
          Welch t 检验（不等方差，双侧 p）：4 组全部在浏览器内重算
        </p>
        <div style={{ overflowX: 'auto' }} className="dp-scroll">
          <table className="dp-mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ color: 'var(--fg-faint)', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>A vs B</th>
                <th style={{ padding: '6px 8px' }}>t（重算 / golden）</th>
                <th style={{ padding: '6px 8px' }}>df（重算 / golden）</th>
                <th style={{ padding: '6px 8px' }}>p（重算 / golden）</th>
                <th style={{ padding: '6px 8px' }}>n</th>
                <th style={{ padding: '6px 8px' }}>结论</th>
              </tr>
            </thead>
            <tbody>
              {welchRows.map((x, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--line-soft)', color: x.okT && x.okDf && x.okP ? 'var(--fg-dim)' : 'var(--err)' }}>
                  <td style={{ padding: '6px 8px' }}>{x.w.a} <span style={{ color: 'var(--fg-faint)' }}>vs</span> {x.w.b}</td>
                  <td style={{ padding: '6px 8px' }}>{x.r ? x.r.t.toFixed(6) : '—'} / {x.w.t.toFixed(6)}</td>
                  <td style={{ padding: '6px 8px' }}>{x.r ? x.r.df.toFixed(4) : '—'} / {x.w.df.toFixed(4)}</td>
                  <td style={{ padding: '6px 8px', color: x.r && x.r.p < 0.05 ? 'var(--live)' : 'var(--fg-dim)' }}>{x.r ? x.r.p.toExponential(3) : '—'} / {x.w.p.toExponential(3)}</td>
                  <td style={{ padding: '6px 8px' }}>{x.w.n_a}/{x.w.n_b}</td>
                  <td style={{ padding: '6px 8px' }}>{x.okT && x.okDf && x.okP ? '✅ 一致' : '❌ 不一致'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <KeyValue columns={2} items={[
          ['Python 侧计算环境', golden.computed_with],
          ['口径', golden.note],
          ['序列自检', allSeriesOk ? '10/10 条序列 × 8 个统计量全部一致（相对误差 < 1e-9）' : '存在不一致，见表内红色行'],
          ['Welch 自检', welchOk + '/' + welchRows.length + ' 组一致（t 1e-5 / df 1e-4 / p 1e-9 绝对容差）'],
        ]} />
      </div>
    </Panel>
  );
}
