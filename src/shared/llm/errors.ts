/** 错误码与文案。单独成文件，是为了让 client（BYOK）与 proxy（站内代理）都能用而不互相 import。 */

export type LlmErrorCode =
  | 'no-key'
  | 'unknown-provider'
  | 'no-capability'
  | 'http'
  | 'network'
  | 'aborted'
  | 'per-minute'
  | 'per-session'
  | 'bad-response'
  | 'proxy-quota'
  | 'proxy-unavailable'
  | 'proxy-error';

export class LlmError extends Error {
  code: LlmErrorCode;
  hint?: string;
  constructor(code: LlmErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.hint = hint;
  }
}

export function describeError(err: unknown): { title: string; detail: string } {
  if (err instanceof LlmError) {
    const title =
      err.code === 'no-key'
        ? '未配置 API key'
        : err.code === 'per-minute' || err.code === 'per-session'
          ? '触发限流'
          : err.code === 'proxy-quota'
            ? '站内额度用完'
            : err.code === 'proxy-unavailable'
              ? '站内代理不可用'
              : err.code === 'proxy-error'
                ? '站内代理报错'
                : err.code === 'aborted'
                  ? '已取消'
                  : err.code === 'network'
                    ? '网络不可达'
                    : err.code.startsWith('http')
                      ? '接口报错'
                      : '调用失败';
    // hint 是「接下来该怎么办」的一句话（例如去填自己的 key），界面上必须显示出来，否则用户只知道失败不知道出路
    return { title, detail: err.hint ? err.message + ' —— ' + err.hint : err.message };
  }
  const e = err as Error;
  return { title: '调用失败', detail: e?.message || String(err) };
}
