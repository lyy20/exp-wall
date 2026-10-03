import { useCallback, useEffect, useState } from 'react';
import { verifyKey } from './client';
import { clearCred, getCred, loadPreferred, saveCred, savePreferred, type Cred } from './keys';
import { DEFAULT_PROVIDER_ID, getProvider } from './providers';

export interface LlmController {
  providerId: string;
  setProviderId: (id: string) => void;
  keyDraft: string;
  setKeyDraft: (v: string) => void;
  modelDraft: string;
  setModelDraft: (v: string) => void;
  cred: Cred | null;
  /** true = 已配置 key，可以实时调用；false = 只能走回放 */
  live: boolean;
  testing: boolean;
  testResult: { ok: boolean; detail: string } | null;
  save: () => void;
  clear: () => void;
  test: () => Promise<void>;
  providerLabel: string;
  modelName: string;
}

/** 统一的 BYOK 状态机：key 只存本机 localStorage。 */
export function useLlm(initialProvider?: string): LlmController {
  const [providerId, setProviderIdState] = useState(initialProvider || loadPreferred() || DEFAULT_PROVIDER_ID);
  const [cred, setCred] = useState<Cred | null>(() => getCred(initialProvider || loadPreferred()));
  const [keyDraft, setKeyDraft] = useState('');
  const [modelDraft, setModelDraft] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);

  useEffect(() => {
    const current = getCred(providerId);
    setCred(current);
    setKeyDraft(current?.apiKey ?? '');
    setModelDraft(current?.model ?? '');
    setTestResult(null);
  }, [providerId]);

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

  const provider = getProvider(providerId);
  return {
    providerId,
    setProviderId,
    keyDraft,
    setKeyDraft,
    modelDraft,
    setModelDraft,
    cred,
    live: Boolean(cred?.apiKey),
    testing,
    testResult,
    save,
    clear,
    test,
    providerLabel: provider?.label ?? providerId,
    modelName: (modelDraft || cred?.model || provider?.chatModel || '').trim(),
  };
}
