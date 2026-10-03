import type { ReactNode } from 'react';
import { page } from '../asset';

export type Tone = 'neutral' | 'live' | 'replay' | 'warn' | 'err' | 'accent';

const TONE_COLOR: Record<Tone, string> = {
  neutral: 'var(--fg-faint)',
  live: 'var(--live)',
  replay: 'var(--replay)',
  warn: 'var(--warn)',
  err: 'var(--err)',
  accent: 'var(--accent)',
};

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className="dp-badge" style={{ color: TONE_COLOR[tone] }} title={title}>
      <span className="dp-dot" />
      {children}
    </span>
  );
}

export function Panel({
  title,
  subtitle,
  right,
  children,
  className = '',
  bodyClassName = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={'dp-panel ' + className} style={{ padding: 16 }}>
      {(title || right) && (
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div>
            {title && <h3 style={{ margin: 0, fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--fg-dim)' }}>{title}</h3>}
            {subtitle && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--fg-faint)', lineHeight: 1.5 }}>{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function StatTile({ label, value, sub, tone = 'neutral' }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="dp-panel-tight" style={{ padding: '10px 12px', minWidth: 0 }}>
      <p style={{ margin: 0, fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>{label}</p>
      <p className="dp-mono" style={{ margin: '6px 0 0', fontSize: 20, fontWeight: 700, color: tone === 'neutral' ? 'var(--fg)' : TONE_COLOR[tone], lineHeight: 1.1 }}>
        {value}
      </p>
      {sub && <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--fg-faint)', lineHeight: 1.45 }}>{sub}</p>}
    </div>
  );
}

export function Sparkline({
  values,
  width = 220,
  height = 44,
  color = 'var(--replay)',
  fill = true,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
}) {
  if (!values.length) return <div style={{ height }} />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values.map((v, i) => [i * stepX, height - ((v - lo) / span) * (height - 4) - 2] as const);
  const d = pts.map(([x, y], i) => (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1)).join(' ');
  return (
    <svg width={width} height={height} viewBox={'0 0 ' + width + ' ' + height} style={{ display: 'block', maxWidth: '100%' }} aria-hidden="true">
      {fill && <path d={d + ' L ' + width + ' ' + height + ' L 0 ' + height + ' Z'} fill={color} opacity={0.12} />}
      <path d={d} fill="none" stroke={color} strokeWidth={1.4} />
    </svg>
  );
}

export function KeyValue({ items, columns = 1 }: { items: [ReactNode, ReactNode][]; columns?: number }) {
  return (
    <dl
      style={{
        margin: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(' + columns + ', minmax(0, 1fr))',
        gap: '6px 18px',
        fontSize: 12,
      }}
    >
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>
          <dt style={{ color: 'var(--fg-faint)', whiteSpace: 'nowrap' }}>{k}</dt>
          <dd className="dp-mono" style={{ margin: 0, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function CodeBlock({ children, maxHeight = 260 }: { children: ReactNode; maxHeight?: number }) {
  return (
    <pre
      className="dp-scroll dp-mono"
      style={{
        margin: 0,
        maxHeight,
        overflow: 'auto',
        background: 'rgba(0,0,0,0.4)',
        border: '1px solid var(--line-soft)',
        borderRadius: 12,
        padding: 12,
        fontSize: 11.5,
        lineHeight: 1.6,
        color: 'var(--fg)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {children}
    </pre>
  );
}

export function Chip({ children, active, onClick }: { children: ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="dp-btn"
      style={{
        fontSize: 11,
        padding: '4px 11px',
        background: active ? 'var(--panel-strong)' : 'transparent',
        borderColor: active ? 'rgba(215,226,234,0.4)' : 'var(--line)',
        textAlign: 'left',
      }}
    >
      {children}
    </button>
  );
}

export function SubHeader({
  kicker,
  title,
  subtitle,
  right,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header style={{ borderBottom: '1px solid var(--line-soft)', background: 'rgba(12,12,12,0.72)', backdropFilter: 'blur(10px)', position: 'sticky', top: 0, zIndex: 20 }}>
      <div className="dp-wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingTop: 12, paddingBottom: 12 }}>
        <a href={page('home')} className="dp-btn" style={{ fontSize: 11 }}>
          ← 返回作品集
        </a>
        <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="dp-btn" style={{ fontSize: 11 }} href={page('rag')}>
            RAG
          </a>
          <a className="dp-btn" style={{ fontSize: 11 }} href={page('yyhelp')}>
            YYHelp
          </a>
          <a className="dp-btn" style={{ fontSize: 11 }} href={page('eap')}>
            EAP
          </a>
        </nav>
      </div>
      <div className="dp-wrap" style={{ paddingBottom: 18 }}>
        {kicker && <p style={{ margin: 0, fontSize: 11, letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>{kicker}</p>}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
          <h1 className="hero-heading" style={{ margin: 0, fontSize: 'clamp(2rem, 5.4vw, 3.6rem)', fontWeight: 900, lineHeight: 1.02, textTransform: 'uppercase' }}>
            {title}
          </h1>
          {right}
        </div>
        {subtitle && <p style={{ margin: '10px 0 0', maxWidth: 720, fontSize: 13, lineHeight: 1.65, color: 'var(--fg-dim)' }}>{subtitle}</p>}
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="dp-wrap" style={{ padding: '28px 20px 40px', fontSize: 11, color: 'var(--fg-faint)', lineHeight: 1.7 }}>
      罗毅扬 · 华中科技大学计算机科学与技术 2027 届硕士 · 求职意向 AI Agent 开发工程师 ·
      <a href="mailto:yiyangluo@hust.edu.cn" style={{ color: 'var(--fg-dim)', marginLeft: 6 }}>
        yiyangluo@hust.edu.cn
      </a>
    </footer>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return <div className="dp-page">{children}</div>;
}
