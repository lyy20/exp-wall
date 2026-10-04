// 入口守门：CORS 白名单 + 请求体校验（模型白名单 / 长度 / 角色）。所有拒绝都 fail closed。

import type { Limits } from './limits.ts';

export interface ChatPayload {
  model: string;
  messages: { role: string; content: string }[];
  temperature: number;
  maxTokens: number;
}

export interface EmbedPayload {
  model: string;
  input: string[];
}

export interface RerankPayload {
  model: string;
  query: string;
  documents: string[];
  topN: number;
}

export type Checked<T> = { ok: true; payload: T } | { ok: false; message: string };

export function parseOrigins(raw: string | undefined): string[] {
  return (raw || 'https://lyy20.github.io')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 白名单之外：只额外放行本机开发端口（http://localhost:* / http://127.0.0.1:*）。 */
export function originAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin) return false;
  if (allowed.indexOf(origin) >= 0) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/**
 * 自定义响应头必须显式 expose 出去：跨源请求里 JS 只能读到 CORS 白名单里的头，
 * 少了这一行，`res.headers.get('X-Proxy-Remaining-Minute')` 在浏览器里恒为 null ——
 * 页面上的「站内额度」就永远停在进页面时那一次 /status 的快照上，
 * 用户问完一句看到额度没掉（本地 harness 是在 Node 里跑的，不受 CORS 限制，所以测不出来，
 * 这条是浏览器验收 ui-accept.mjs 抓出来的）。
 */
export const EXPOSED_HEADERS = 'X-Proxy-Remaining-Minute, X-Proxy-Remaining-Day, X-Proxy-Remaining-Global';

export function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Expose-Headers': EXPOSED_HEADERS,
    'Access-Control-Max-Age': '3600',
    Vary: 'Origin',
  };
}

export function jsonResponse(data: unknown, status: number, origin?: string | null): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  if (origin) Object.assign(headers, corsHeaders(origin));
  return new Response(JSON.stringify(data), { status, headers });
}

export function fail(status: number, code: string, message: string, origin?: string | null, extra?: Record<string, unknown>): Response {
  const body: Record<string, unknown> = { error: { code, message } };
  if (extra) body.error = Object.assign(body.error as Record<string, unknown>, extra);
  return jsonResponse(body, status, origin);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateChat(body: unknown, limits: Limits, models: string[]): Checked<ChatPayload> {
  if (!isObject(body)) return { ok: false, message: '请求体必须是 JSON 对象' };
  const rawMessages = body.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) return { ok: false, message: 'messages 必须是非空数组' };
  if (rawMessages.length > limits.maxMessages) {
    return { ok: false, message: 'messages 最多 ' + limits.maxMessages + ' 条，收到 ' + rawMessages.length + ' 条' };
  }
  const messages: { role: string; content: string }[] = [];
  let totalChars = 0;
  for (let i = 0; i < rawMessages.length; i += 1) {
    const m = rawMessages[i];
    if (!isObject(m)) return { ok: false, message: 'messages[' + i + '] 不是对象' };
    const role = typeof m.role === 'string' ? m.role : '';
    if (role !== 'system' && role !== 'user' && role !== 'assistant') {
      return { ok: false, message: 'messages[' + i + '].role 只能是 system / user / assistant' };
    }
    const content = typeof m.content === 'string' ? m.content : '';
    if (!content) return { ok: false, message: 'messages[' + i + '].content 不能为空' };
    if (content.length > limits.maxInputChars) {
      return { ok: false, message: 'messages[' + i + '].content 超过 ' + limits.maxInputChars + ' 字符，请缩短后再问' };
    }
    totalChars += content.length;
    messages.push({ role, content });
  }
  if (totalChars > limits.maxTotalChars) {
    return { ok: false, message: '整段对话合计超过 ' + limits.maxTotalChars + ' 字符，请缩短后再问' };
  }
  const model = typeof body.model === 'string' && body.model ? body.model : models[0];
  if (models.indexOf(model) < 0) {
    return { ok: false, message: '站内代理只开放这些模型：' + models.join(' / ') + '（收到 ' + model + '）' };
  }
  const rawTemp = typeof body.temperature === 'number' ? body.temperature : 0.2;
  const temperature = Math.min(1, Math.max(0, rawTemp));
  const rawMax = typeof body.max_tokens === 'number' ? body.max_tokens : limits.maxOutputTokens;
  const maxTokens = Math.min(limits.maxOutputTokens, Math.max(1, Math.floor(rawMax)));
  return { ok: true, payload: { model, messages, temperature, maxTokens } };
}

export function validateEmbeddings(body: unknown, limits: Limits, models: string[]): Checked<EmbedPayload> {
  if (!isObject(body)) return { ok: false, message: '请求体必须是 JSON 对象' };
  const input = body.input;
  const list = typeof input === 'string' ? [input] : Array.isArray(input) ? input : null;
  if (!list || list.length === 0) return { ok: false, message: 'input 必须是非空字符串数组' };
  if (list.length > 8) return { ok: false, message: '一次最多向量化 8 条' };
  const out: string[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const s = list[i];
    if (typeof s !== 'string' || !s) return { ok: false, message: 'input[' + i + '] 必须是非空字符串' };
    if (s.length > 2000) return { ok: false, message: 'input[' + i + '] 超过 2000 字符' };
    out.push(s);
  }
  const model = typeof body.model === 'string' && body.model ? body.model : models[0];
  if (models.indexOf(model) < 0) return { ok: false, message: '向量模型只开放：' + models.join(' / ') };
  return { ok: true, payload: { model, input: out } };
}

export function validateRerank(body: unknown, limits: Limits, models: string[]): Checked<RerankPayload> {
  if (!isObject(body)) return { ok: false, message: '请求体必须是 JSON 对象' };
  const query = typeof body.query === 'string' ? body.query : '';
  if (!query) return { ok: false, message: 'query 不能为空' };
  if (query.length > 2000) return { ok: false, message: 'query 超过 2000 字符' };
  const docs = Array.isArray(body.documents) ? body.documents : null;
  if (!docs || docs.length === 0) return { ok: false, message: 'documents 必须是非空数组' };
  if (docs.length > 32) return { ok: false, message: '一次最多精排 32 条' };
  const documents: string[] = [];
  for (let i = 0; i < docs.length; i += 1) {
    const s = docs[i];
    if (typeof s !== 'string' || !s) return { ok: false, message: 'documents[' + i + '] 必须是非空字符串' };
    if (s.length > 4000) return { ok: false, message: 'documents[' + i + '] 超过 4000 字符' };
    documents.push(s);
  }
  const model = typeof body.model === 'string' && body.model ? body.model : models[0];
  if (models.indexOf(model) < 0) return { ok: false, message: '精排模型只开放：' + models.join(' / ') };
  const topN = typeof body.top_n === 'number' ? Math.min(documents.length, Math.max(1, Math.floor(body.top_n))) : documents.length;
  return { ok: true, payload: { model, query, documents, topN } };
}
