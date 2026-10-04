import { useCallback, useEffect, useState } from 'react';
import { verifyKey } from './client';
import { clearCred, getCred, loadPreferred, saveCred, savePreferred, type Cred } from './keys';
import type { LlmMode } from './mode';
import { probeProxy, proxyConfigured, proxyFailureDetail, proxyStatus, type ProxyStatus } from './proxy';
import { DEFAULT_PROVIDER_ID, getProvider } from './providers';

export interface LlmController {
  providerId: string;
  setProviderId: (id: string) => void;
  keyDraft: string;
  setKeyDraft: (v: string) => void;
  modelDraft: string;
  setModelDraft: (v: string) => void;
  cred: Cred | null;
  /**
   * 当前处于哪种模式，必须在界面上显式写出：
   *   byok   自己填了 key，浏览器直连服务商
   *   proxy  没填 key，走站内代理（本站 Worker 转发，key 在服务端）
   *   replay 两者都没有，只能回放录制日志
   */
  mode: LlmMode;
  /** true = 能真实调用模型（byok 或 proxy），false = 只能回放 */
  live: boolean;
  /** 站内代理的探活结果（null = 没配代理或探活失败） */
  proxyStatus: ProxyStatus | null;
  proxyChecking: boolean;
  /** 配了代理但连不上时的原因，界面上要如实显示 */
  proxyDetail: string | null;
  refreshProxy: () => void;
  testing: boolean;
  testResult: { ok: boolean; detail: string } | null;
  save: () => void;
  clear: () => void;
  test: () => Promise<void>;
  providerLabel: string;
  modelName: string;
}

/** 统一的 BYOK 状态机：key 只存本机 localStorage；没 key 时看站内代理是否可用。 */
export function useLlm(initialProvider?: string): LlmController {
  const [providerId, setProviderIdState] = useState(initialProvider || loadPreferred() || DEFAULT_PROVIDER_ID);
  const [cred, setCred] = useState<Cred | null>(() => getCred(initialProvider || loadPreferred()));
  const [keyDraft, setKeyDraft] = useState('');
  const [modelDraft, setModelDraft] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  // 不把 ProxyStatus 存进 state：proxy.ts 里的 cache 是模块级可变对象（applyRemaining 原地更新它），
  // 存快照的话，第一次带 X-Proxy-Remaining-* 的请求之后 state 里的额度就永久过期了。
  // 这里只在探活结束后 bump 一次 epoch 触发重渲染，值本身每次渲染现读。
  const [proxyEpoch, setProxyEpoch] = useState(0);
  const proxy = proxyStatus();
  const [proxyChecking, setProxyChecking] = useState(false);
  const [proxyDetail, setProxyDetail] = useState<string | null>(null);
  const [proxyTick, setProxyTick] = useState(0);

  useEffect(() => {
    const current = getCred(providerId);
    setCred(current);
    setKeyDraft(current?.apiKey ?? '');
    setModelDraft(current?.model ?? '');
    setTestResult(null);
  }, [providerId]);

  // 页面加载时探一次站内代理：配了地址才探，探不通会在 KeyBar 上写明原因
  useEffect(() => {
    let alive = true;
    if (proxyConfigured()) {
      setProxyChecking(true);
      void probeProxy().then((st) => {
        if (!alive) return;
        setProxyEpoch((e) => e + 1);
        setProxyDetail(st ? null : proxyFailureDetail());
        setProxyChecking(false);
      });
    }
    return () => {
      alive = false;
    };
  }, [proxyTick]);

  const setProviderId = useCallback((id: string) => {
    setProviderIdState(id);
    savePreferred(id);
  }, []);

  const save = useCallback(() => {
    saveCred(providerId, { apiKey: keyDraft, model: modelDraft });
    setCred(getCred(providerId));
    setTestResult(null);
  }, [providerId, keyDraft, modelDraft]);

  const clear = useCallback(() => {
    clearCred(providerId);
    setCred(null);
    setKeyDraft('');
    setModelDraft('');
    setTestResult(null);
  }, [providerId]);

  const test = useCallback(async () => {
    saveCred(providerId, { apiKey: keyDraft, model: modelDraft });
    setCred(getCred(providerId));
    setTesting(true);
    try {
      const res = await verifyKey(providerId);
      setTestResult(res.ok ? { ok: true, detail: 'key 可用：' + res.model } : { ok: false, detail: res.detail });
    } finally {
      setTesting(false);
    }
  }, [providerId, keyDraft, modelDraft]);

  const refreshProxy = useCallback(() => {
    setProxyTick((t) => t + 1);
  }, []);

  const provider = getProvider(providerId);
  // 代理模式成立 = 探活成功 + 服务端真的开了 chat 通道。
  // 刻意 **不** 把「还有没有额度」算进模式判定：额度用完时若把徽标翻成「回放」，
  // 用户会以为站点偷偷退回了演示模式。正确做法是模式照旧写着「站内代理」，
  // 下一次提问真的发出去、拿到服务端 429，再把「站内额度用完，请填自己的 key」写在面板上。
  const proxyUsable = Boolean(proxy && proxy.caps.indexOf('chat') >= 0);
  const mode: LlmMode = cred?.apiKey ? 'byok' : proxyUsable ? 'proxy' : 'replay';
  return {
    providerId,
    setProviderId,
    keyDraft,
    setKeyDraft,
    modelDraft,
    setModelDraft,
    cred,
    mode,
    live: mode !== 'replay',
    proxyStatus: proxy,
    proxyChecking,
    proxyDetail,
    refreshProxy,
    testing,
    testResult,
    save,
    clear,
    test,
    providerLabel: provider?.label ?? providerId,
    modelName: (modelDraft || cred?.model || provider?.chatModel || '').trim(),
  };
}
