// P3 措辞门禁：LLM 负责生成，代码负责判定。检查器规则照抄 eap/inference.py:33-41 与 :272-302。
import { useState } from 'react';
import { chatStream, describeError } from '../shared/llm/client';
import { Badge, Chip, Panel } from '../shared/ui/core';
import { ModeBadge, QuotaBar } from '../shared/ui/llm-ui';
import type { LlmMode } from '../shared/llm/mode';

const FORBIDDEN_L1 = ['两者相同', '完全等价', '证明', '必然', '一定优于', '没有任何差别', '效果相同', '可以断定'];

type Level = 'SIGNIFICANT' | 'EXPLORATORY' | 'NOT_SIGNIFICANT';

const RULES: Record<Level, { need: string[]; hint: string }> = {
  SIGNIFICANT: { need: ['显著'], hint: '达到显著性：必须出现「显著」二字' },
  EXPLORATORY: { need: ['探索', '未纳入多重比较校正'], hint: '探索性结论：必须自我声明「探索」+「未纳入多重比较校正」' },
  NOT_SIGNIFICANT: { need: ['未观察到', '不能据此认定两者相同'], hint: '未达显著：必须写「未观察到」，且必须写「不能据此认定两者相同」' },
};

const PRESETS: { label: string; level: Level; text: string }[] = [
  { label: '合规的 SIGNIFICANT', level: 'SIGNIFICANT', text: '在 n=100 的配对样本上，assisted 臂的 reward_sum 显著高于 policy_only（Welch t = −3.4735, p = 6.36e-04，Holm 校正后仍显著）。' },
  { label: '违规：用了禁词', level: 'NOT_SIGNIFICANT', text: 'success 在 n=100 下两者相同，可以断定加不加滤波没有任何差别。' },
  { label: '违规：漏了免责声明', level: 'EXPLORATORY', text: '探索性对比：assisted 的 minimum_clearance_m 略高于 policy_only，属于待验证信号。' },
  { label: '合规的 NOT_SIGNIFICANT', level: 'NOT_SIGNIFICANT', text: 'reward_sum 上未观察到显著差异（p = 0.1358）；不能据此认定两者相同，只能说明本次 n=100 的观测不足以支持差异结论。' },
];

function check(text: string, level: Level) {
  const missing = RULES[level].need.filter((n) => !text.includes(n));
  const forbidden = FORBIDDEN_L1.filter((f) => text.includes(f));
  return { ok: missing.length === 0 && forbidden.length === 0, missing, forbidden };
}

export function WordingPanel({ llm }: { llm: { live: boolean; mode: LlmMode; keyDraft: string } }) {
  const [text, setText] = useState(PRESETS[0].text);
  const [level, setLevel] = useState<Level>('SIGNIFICANT');
  const [busy, setBusy] = useState(false);
  const [llmOut, setLlmOut] = useState('');
  const [llmErr, setLlmErr] = useState<{ title: string; detail: string } | null>(null);

  const r = check(text, level);

  const askLlm = async () => {
    if (busy || !llm.live) return;
    setBusy(true); setLlmErr(null); setLlmOut('');
    const sys = '你在一个「LLM 不得参与数值计算与自我判定」的科研分析平台里，只负责把已有结论改写成规范措辞。'
      + '规则：SIGNIFICANT 必须含「显著」；EXPLORATORY 必须含「探索」与「未纳入多重比较校正」；NOT_SIGNIFICANT 必须含「未观察到」与「不能据此认定两者相同」。'
      + '禁止出现：' + FORBIDDEN_L1.join('、') + '。不要新增任何数字，不要解释，只输出一句话。';
    const user = '请把下面这条结论改写为 ' + level + ' 级别的规范措辞：\n' + text;
    try {
      const res = await chatStream([{ role: 'system', content: sys }, { role: 'user', content: user }], { maxTokens: 200, onToken: (c) => setLlmOut((p) => p + c) });
      setLlmOut(res.text.trim());
    } catch (e) { setLlmErr(describeError(e)); }
    setBusy(false);
  };

  const llmVerdict = llmOut ? check(llmOut, level) : null;

  return (
    <Panel
      title="措辞门禁：LLM 生成，代码判定"
      subtitle="这是「不许 LLM 判定自己输出」的落地形式。把措辞规则写成可执行检查器：LLM 写出来的结论必须通过它，通不过就是通不过 —— 页面不会因为「看起来挺像」就放行。"
      right={<ModeBadge mode={llm.mode} />}
    >
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {PRESETS.map((p) => (
          <Chip key={p.label} onClick={() => { setText(p.text); setLevel(p.level); setLlmOut(''); }}>{p.label}</Chip>
        ))}
        {(['SIGNIFICANT', 'EXPLORATORY', 'NOT_SIGNIFICANT'] as Level[]).map((l) => (
          <Chip key={l} active={l === level} onClick={() => setLevel(l)}>{l}</Chip>
        ))}
      </div>

      <textarea
        className="dp-input"
        style={{ minHeight: 88, fontSize: 13, lineHeight: 1.7, resize: 'vertical' }}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="dp-mono" style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--fg-faint)' }}>
        {level} 要求：{RULES[level].hint} ｜ 禁词表（L1 推断禁用）：{FORBIDDEN_L1.join(' / ')}
      </p>

      <div className="dp-panel-tight" style={{ marginTop: 12, padding: 12, borderColor: r.ok ? 'var(--live)' : 'var(--err)' }}>
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: r.ok ? 'var(--live)' : 'var(--err)' }}>
          {r.ok ? '✅ 通过：措辞与判定一致' : '❌ 拒绝：' + (r.missing.length ? '缺少必要声明 ' + r.missing.map((m) => '「' + m + '」').join('、') : '') + (r.missing.length && r.forbidden.length ? '；' : '') + (r.forbidden.length ? '出现禁止表达 ' + r.forbidden.map((m) => '「' + m + '」').join('、') : '')}
        </p>
        <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--fg-dim)', lineHeight: 1.65 }}>
          {r.ok
            ? '对应 eap/compare.py:603-625 的断言：L1 报告在生成后会跑一遍措辞一致性检查，不一致就 raise AssertionError（不是让模型自评）。'
            : '对应 eap/compare.py:607 raise AssertionError("L1 结论措辞与判定不一致：…") 与 :620 raise AssertionError("对比论断出现推断性表达（应仅描述性）")。真实项目里报告会直接生成失败。'}
        </p>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="dp-btn dp-btn-primary" onClick={() => void askLlm()} disabled={!llm.live || busy}>
            {busy ? '模型改写中…' : '让 LLM 试着重写成 ' + level}
          </button>
          <span style={{ fontSize: 11, color: 'var(--fg-faint)' }}>
            {llm.mode === 'byok' ? '会用你填的 key 真调模型，然后立刻用上面的检查器判它。' : llm.mode === 'proxy' ? '走站内代理真调模型（密钥在服务端），然后立刻用上面的检查器判它。' : '需要模型通道：站内代理不可用，请填你自己的 key（本项目没有留下模型日志，所以这一块没有回放素材 —— 如实说明，不伪造）。'}
          </span>
        </div>
        <div style={{ marginTop: 10 }}><QuotaBar mode={llm.mode} /></div>
        {llmErr && <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--err)' }}>{llmErr.title}：{llmErr.detail}</p>}
        {llmOut && (
          <div className="dp-panel-tight" style={{ marginTop: 10, padding: 12, borderColor: llmVerdict?.ok ? 'var(--live)' : 'var(--err)' }}>
            <p style={{ margin: '0 0 6px', fontSize: 11, color: 'var(--fg-faint)' }}>
              模型原始输出（{busy ? '流式中' : '已完成'}）· 判定：{llmVerdict?.ok ? '✅ 通过检查器' : '❌ 被检查器拒绝'}
              {llmVerdict && !llmVerdict.ok ? '（' + [...llmVerdict.missing.map((m) => '缺「' + m + '」'), ...llmVerdict.forbidden.map((f) => '用了「' + f + '」')].join('、') + '）' : ''}
            </p>
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.7, color: 'var(--fg)', whiteSpace: 'pre-wrap' }}>{llmOut}</p>
          </div>
        )}
      </div>
    </Panel>
  );
}
