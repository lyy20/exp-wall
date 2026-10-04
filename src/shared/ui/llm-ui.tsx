import { useEffect, useState } from 'react';
import { limiter } from '../llm/limiter';
import { MODE_TITLE, type LlmMode } from '../llm/mode';
import { proxyBase, proxyStatus } from '../llm/proxy';
import { PROVIDERS } from '../llm/providers';
import { maskKey } from '../llm/keys';
import type { LlmController } from '../llm/useLlm';
import { Badge, type Tone } from './core';

/** 三种模式各有一种颜色和文案，任何面板上都必须写清楚现在是哪一种。 */
export function ModeBadge({
  mode,
  liveLabel = '实时',
  proxyLabel = '站内代理',
  replayLabel = '回放',
}: {
  mode: LlmMode;
  liveLabel?: string;
  proxyLabel?: string;
  replayLabel?: string;
}) {
  const tone: Tone = mode === 'byok' ? 'live' : mode === 'proxy' ? 'accent' : 'replay';
  const label = mode === 'byok' ? liveLabel : mode === 'proxy' ? proxyLabel : replayLabel;
  return (
    <Badge tone={tone} title={MODE_TITLE[mode]}>
      {label}
    </Badge>
  );
}

export function ModeNote({ llm, note }: { llm: LlmController; note?: string }) {
  if (llm.mode === 'byok') {
    return <>当前用你自己的 key 直连 {llm.providerLabel}（key 只在本机 localStorage）。</>;
  }
  if (llm.mode === 'proxy') {
    return (
      <>
        当前走<b>站内代理</b>：本站自己的 Cloudflare Worker 转发到 DeepSeek，密钥只在服务端，浏览器里没有 key。
        {note ? ' ' + note : ''}
      </>
    );
  }
  return <>零配置可直接体验：下面所有回答都来自项目真实日志的回放。</>;
}

/**
 * limiter.snapshot() 与 proxyStatus() 读的都是模块级可变状态（本机计数、服务端额度的缓存），
 * 它们变化不会触发 React 重渲染 —— 不 tick 的话，提问后页面上的额度数字不会自己掉，
 * 用户看到的是「提问了但站内额度没变」。低频 ticker 只做重渲染，不发请求。
 */
function useTicker(ms = 1500) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function QuotaBar({ mode }: { mode?: LlmMode }) {
  const snap = limiter.snapshot();
  const proxy = proxyStatus();
  useTicker();
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 11, color: 'var(--fg-faint)' }}>
      <span>
        限流：本分钟剩 <b className="dp-mono" style={{ color: 'var(--fg-dim)' }}>{snap.minuteLeft}</b>/{snap.minuteTotal} 次 ·
        本次会话已用 <b className="dp-mono" style={{ color: 'var(--fg-dim)' }}>{snap.quota.live}</b>/{snap.limits.perSession} 次 ·
        单次输出上限 {snap.limits.maxOutputTokens} token
      </span>
      {mode === 'proxy' && proxy && (
        <span>
          站内额度：本分钟剩 <b className="dp-mono" style={{ color: 'var(--fg-dim)' }}>{proxy.remaining.minute}</b>/{proxy.limits.perMinute} 次 ·
          今日剩 <b className="dp-mono" style={{ color: 'var(--fg-dim)' }}>{proxy.remaining.day}</b>/{proxy.limits.perDay} 次 ·
          全站今日剩 <b className="dp-mono" style={{ color: 'var(--fg-dim)' }}>{proxy.remaining.global}</b>/{proxy.limits.globalPerDay} 次
        </span>
      )}
      <button
        type="button"
        className="dp-btn"
        style={{ fontSize: 10, padding: '2px 8px' }}
        onClick={() => {
          limiter.resetQuota();
        }}
      >
        重置计数
      </button>
    </div>
  );
}

export function KeyBar({ llm, note }: { llm: LlmController; note?: string }) {
  useTicker();
  const provider = PROVIDERS.find((p) => p.id === llm.providerId);
  const caps = provider?.caps.join(' / ') ?? '';
  const proxy = llm.proxyStatus;
  return (
    <div className="dp-panel-tight" style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <ModeBadge mode={llm.mode} />
        <span style={{ fontSize: 11, color: 'var(--fg-faint)' }}>
          <ModeNote llm={llm} />
        </span>
        <span style={{ flex: 1 }} />
        <QuotaBar mode={llm.mode} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        <label style={{ display: 'block' }}>
          <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>服务商</span>
          <select className="dp-input" value={llm.providerId} onChange={(e) => llm.setProviderId(e.target.value)} style={{ marginTop: 4 }}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}（{p.caps.join('/')}）
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'block' }}>
          <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>API key（只存本机）</span>
          <input
            className="dp-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={llm.cred ? maskKey(llm.cred.apiKey) : 'sk-...'}
            value={llm.keyDraft}
            onChange={(e) => llm.setKeyDraft(e.target.value)}
            style={{ marginTop: 4 }}
          />
        </label>
        <label style={{ display: 'block' }}>
          <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>模型（可改）</span>
          <input
            className="dp-input"
            spellCheck={false}
            placeholder={provider?.chatModel ?? ''}
            value={llm.modelDraft}
            onChange={(e) => llm.setModelDraft(e.target.value)}
            style={{ marginTop: 4 }}
          />
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button type="button" className="dp-btn dp-btn-primary" style={{ fontSize: 11, padding: '6px 14px' }} onClick={llm.save} disabled={!llm.keyDraft.trim()}>
          保存到本机
        </button>
        <button type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={() => void llm.test()} disabled={llm.testing || !llm.keyDraft.trim()}>
          {llm.testing ? '测试中…' : '测试连通性'}
        </button>
        <button type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={llm.clear} disabled={!llm.cred}>
          清除
        </button>
        {llm.testResult && (
          <span style={{ fontSize: 11, color: llm.testResult.ok ? 'var(--live)' : 'var(--err)' }}>{llm.testResult.detail}</span>
        )}
      </div>

      <p style={{ margin: '9px 0 0', fontSize: 11, lineHeight: 1.6, color: 'var(--fg-faint)' }}>
        隐私与成本：填了 key 时，key 只写入你自己浏览器的 localStorage，浏览器直连服务商，本站不中转、不记录；没填 key 时走
        <b>站内代理</b>（本站的 Cloudflare Worker，密钥只在服务端 secret 里），所以零配置也能真答，但额度有限（每 IP 每分钟 3 次 / 每天 30 次 / 全站每天 200 次 / 单次输出 ≤512 token），
        超额会明确返回 429 并提示你填自己的 key。本机限流（每分钟 6 次 / 每次会话 60 次）只数真正调模型的次数；
        走站内代理时 embedding 与精排由服务端单独限额，不占这份本机计数。
        {provider?.note ? ' 提示：' + provider.note + '。' : ''}
        {note ? ' ' + note : ''}
      </p>
      {llm.proxyChecking && <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--fg-faint)' }}>正在探测站内代理…</p>}
      {!llm.proxyChecking && llm.proxyDetail && (
        <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--warn)' }}>
          站内代理没连上（{proxyBase()}）：{llm.proxyDetail} —— 填自己的 key 可以直连服务商。
        </p>
      )}
      {!llm.proxyChecking && !llm.proxyDetail && proxy && llm.mode === 'proxy' && (
        <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--fg-faint)' }}>
          站内代理已就绪：模型 {proxy.models.join(' / ')}；embedding {proxy.embedModels.length ? proxy.embedModels.join(' / ') : '未配置'}。
        </p>
      )}
      {!llm.proxyChecking && proxy && llm.mode === 'proxy' && (proxy.remaining.minute === 0 || proxy.remaining.day === 0 || proxy.remaining.global === 0) && (
        <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--warn)' }}>
          站内额度已用完（{proxy.remaining.minute === 0 ? '本分钟' : proxy.remaining.day === 0 ? '今日' : '全站今日'}）：下一次提问会被服务端明确拒绝（429）
          —— 填自己的 key 可以继续用，不受这份额度限制。
        </p>
      )}
      {provider && !provider.corsVerified && (
        <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--warn)' }}>该服务商尚未实测浏览器直连 CORS，可能被浏览器拦截。</p>
      )}
      <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--fg-faint)' }}>能力：{caps}</p>
    </div>
  );
}
