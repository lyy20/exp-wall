/** 三个 LLM 通道（BYOK 直连 / 站内代理）共用的 HTTP 小工具，避免相互 import 形成环。 */

export function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path;
}

export async function fetchWithTimeout(url: string, init: RequestInit, signal?: AbortSignal, timeoutMs = 60000): Promise<Response> {
  if (signal) return fetch(url, { ...init, signal });
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

/** 读 OpenAI 风格 SSE：逐块 decode，遇 data: [DONE] 结束。不做任何缓冲。 */
export async function readSseData(
  res: Response,
  onData: (data: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const body = res.body;
  if (!body) throw new Error('响应没有可读取的流');
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  for (;;) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => undefined);
      throw Object.assign(new Error('请求已取消'), { name: 'AbortError' });
    }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    for (const raw of parts) {
      const line = raw.trim();
      if (!line || !line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        onData(JSON.parse(payload));
      } catch {
        /* 忽略无法解析的心跳行 */
      }
    }
  }
}
