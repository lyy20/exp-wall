import { limiter } from '../llm/limiter';
import { PROVIDERS } from '../llm/providers';
import { maskKey } from '../llm/keys';
import type { LlmController } from '../llm/useLlm';
import { Badge, type Tone } from './core';

export function ModeBadge({ live, liveLabel = '实时', replayLabel = '回放' }: { live: boolean; liveLabel?: string; replayLabel?: string }) {
  const tone: Tone = live ? 'live' : 'replay';
  const title = live
    ? '已配置你的 API key：本次回答是当前真实调用模型生成的'
    : '回放模式：下面展示的是录制自项目真实日志的模型输出，按真实节奏重放；不需要任何 key。填入你自己的 key 即可实时提问。';
  return (
    <Badge tone={tone} title={title}>
      {live ? liveLabel : replayLabel}
    </Badge>
  );
}

export function QuotaBar() {
  const snap = limiter.snapshot();
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 11, color: 'var(--fg-faint)' }}>
      <span>
        限流：本分钟剩 <b className="dp-mono" style={{ color: 'var(--fg-dim)' }}>{snap.minuteLeft}</b>/{snap.minuteTotal} 次 ·
        本次会话已用 <b className="dp-mono" style={{ color: 'var(--fg-dim)' }}>{snap.quota.live}</b>/{snap.limits.perSession} 次 ·
        单次输出上限 {snap.limits.maxOutputTokens} token
      </span>
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
  const provider = PROVIDERS.find((p) => p.id === llm.providerId);
  const caps = provider?.caps.join(' / ') ?? '';
  return (
    <div className="dp-panel-tight" style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <ModeBadge live={llm.live} />
        <span style={{ fontSize: 11, color: 'var(--fg-faint)' }}>
          {llm.live ? '当前用你自己的 key 实时调用 ' + llm.providerLabel : '零配置可直接体验：下面所有回答都来自项目真实日志的回放'}
        </span>
        <span style={{ flex: 1 }} />
        <QuotaBar />
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
        隐私与成本：key 只写入你自己浏览器的 localStorage，页面没有后端、不上传、不记录。本站对真实调用做了限流（每分钟 6 次 / 每次会话 60 次 / 单次输出 ≤512 token），避免误触或脚本刷量。
        {provider?.note ? ' 提示：' + provider.note + '。' : ''}
        {note ? ' ' + note : ''}
      </p>
      {provider && !provider.corsVerified && (
        <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--warn)' }}>该服务商尚未实测浏览器直连 CORS，可能被浏览器拦截。</p>
      )}
      <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--fg-faint)' }}>能力：{caps}</p>
    </div>
  );
}
