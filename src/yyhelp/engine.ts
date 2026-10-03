// P2 引擎：意图路由（规则优先 + LLM 兜底）+ 5 个工具的真实实现（浏览器内跑，逐字复刻项目行为）。
import type { IntentsFile, YyAssets, YyExit, YyKbChunk, YyKbMeta, YyOrder, YyRule } from './assets';
import { cnum } from './assets';

export const STATUS_CN: Record<string, string> = {
  created: '已创建', paid: '已付款', shipped: '已发货', signed: '已签收', closed: '已关闭',
};
const KEYWORDS = ['运费', '退款', '退货', '包邮', '时效', '无理由'];
const RETRYABLE: Record<string, boolean> = {
  INVALID_ARGS: false, NOT_FOUND: false, AUTH_FAILED: false, UPSTREAM_5XX: true, TIMEOUT: true, INTERNAL: false,
};

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}';
}

export async function idemKey(tool: string, args: Record<string, unknown>, threadId = ''): Promise<string> {
  const h = await sha256Hex(stableStringify(args) + '|' + threadId);
  return 'idem_' + tool + '_' + h.slice(0, 16);
}

// ---------------------------------------------------------------- 意图路由
export interface RuleHit { index: number; intent: string; pattern: string; weight: number; matched: string }
export interface RouteDecision {
  text: string; hits: RuleHit[]; totalWeight: number; best: RuleHit | null; abstained: boolean;
  intent: string; confidence: number; exit: string; needsKb: boolean; node: string;
  method: 'rule' | 'llm' | 'fallback-llm' | 'fallback-no-llm';
}

export function ruleClassify(text: string, rules: YyRule[], threshold = 2) {
  let best: RuleHit | null = null;
  let total = 0;
  const hits: RuleHit[] = [];
  for (let index = 0; index < rules.length; index++) {
    const r = rules[index];
    let m: RegExpMatchArray | null = null;
    try { m = new RegExp(r.pattern).exec(text); } catch { m = null; }
    if (!m) continue;
    const hit: RuleHit = { index: index + 1, intent: r.intent, pattern: r.pattern, weight: r.weight, matched: m[0] };
    hits.push(hit);
    total += r.weight;
    if (best === null || r.weight > best.weight) best = hit;
  }
  return { best, total, hits, pass: best !== null && best.weight >= threshold };
}

export function ruleByExit(exitId: string | undefined, exits: YyExit[]): string {
  const map = new Map(exits.map((e) => [e.id, e.node] as const));
  const ex = exitId || 'kb_faq';
  return map.has(ex) ? ex : 'agent_free';
}

export function decide(text: string, file: IntentsFile, opts: { llmIntent?: string | null; hasLlm: boolean }): RouteDecision {
  const threshold = file.router_impl.rule_threshold ?? 2;
  const { best, total, hits, pass } = ruleClassify(text, file.router_impl.rules, threshold);
  const exits = file.exits;
  const nodeOf = (e: string) => (exits.find((x) => x.id === e)?.node ?? 'agent_memory');
  const kbOf = (e: string) => !!(file.router_impl.exit_needs_kb?.[e] ?? exits.find((x) => x.id === e)?.needs_kb);
  if (pass && best) {
    const ex = ruleByExit(file.intents.find((i) => i.name === best.intent)?.exit, exits);
    return { text, hits, totalWeight: total, best, abstained: false, intent: best.intent, confidence: 0.95, exit: ex, needsKb: kbOf(ex), node: nodeOf(ex), method: 'rule' };
  }
  if (opts.llmIntent && file.intents.some((i) => i.name === opts.llmIntent)) {
    const ex = ruleByExit(file.intents.find((i) => i.name === opts.llmIntent)?.exit, exits);
    return { text, hits, totalWeight: total, best, abstained: true, intent: opts.llmIntent, confidence: 0.9, exit: ex, needsKb: kbOf(ex), node: nodeOf(ex), method: 'llm' };
  }
  const fb = opts.hasLlm
    ? { intent: 'chitchat', confidence: 0.0, exit: ruleByExit('agent_free', exits), method: 'fallback-llm' as const }
    : { intent: 'faq_kb', confidence: 0.3, exit: ruleByExit('kb_faq', exits), method: 'fallback-no-llm' as const };
  return { text, hits, totalWeight: total, best, abstained: !pass, intent: fb.intent, confidence: fb.confidence, exit: fb.exit, needsKb: kbOf(fb.exit), node: nodeOf(fb.exit), method: fb.method };
}

// ---------------------------------------------------------------- 工具层
export interface ToolErrorShape { kind: string; message: string; detail?: string; retryable: boolean }
export interface ToolEnvelope {
  tool: string; ok: boolean; data?: any; error?: ToolErrorShape | null;
  idempotency_key: string; duplicate?: boolean; truncated?: boolean;
  elapsed_ms: number; meta?: Record<string, unknown>;
}
export interface ToolLogRow { tool: string; args: Record<string, unknown>; ok: boolean; kind?: string; key: string; duplicate: boolean; ms: number; side: string }

class ToolError extends Error {
  kind: string; detail?: string;
  constructor(kind: string, message: string, detail?: string) { super(message); this.kind = kind; this.detail = detail; }
}

export function toObservation(env: ToolEnvelope, maxChars = 4000): string {
  const notice = env.ok ? '' : '\n[notice] 本次工具调用失败：' + env.error?.kind + ' —— ' + (env.error?.message ?? '');
  let body = JSON.stringify(env);
  let cut = false;
  if (body.length > maxChars) { body = body.slice(0, maxChars); cut = true; }
  return '<untrusted_data>\n' + body + (cut ? '\n...[已截断，原始长度 ' + JSON.stringify(env).length + ' 字符]' : '') + '\n</untrusted_data>' + notice;
}

export class ToolRuntime {
  store = new Map<string, ToolEnvelope>();
  log: ToolLogRow[] = [];
  constructor(private a: YyAssets, public threadId = 't_demo') {}

  private kbHay(c: YyKbChunk): string { return (c.title ?? '') + (c.text ?? ''); }

  /** stub 检索：逐字复刻 code/yyhelp/graph/tools.py:644-667（无语义能力，是项目默认路径）。 */
  stubSearchKb(query: string, topK = 3) {
    const q = (query || '').trim();
    if (!q) throw new ToolError('INVALID_ARGS', 'query 不能为空');
    const k = Math.max(1, Math.min(Math.trunc(topK || 3) || 3, 5));
    const qs = new Set(q);
    const scored: { score: number; c: YyKbChunk }[] = [];
    for (const c of this.a.kb) {
      const hay = this.kbHay(c);
      let score = 0;
      for (const ch of qs) if (hay.includes(ch)) score += 1;
      score = score / Math.max(1, qs.size);
      for (const kw of KEYWORDS) if (q.includes(kw) && hay.includes(kw)) score += 0.5;
      if (score > 0) scored.push({ score, c });
    }
    scored.sort((x, y) => y.score - x.score);
    const hits = scored.slice(0, k).map(({ score, c }) => ({ chunk_id: c.id, heading: c.title, text: c.text, score: Math.round(score * 1000) / 1000 }));
    if (!hits.length) throw new ToolError('NOT_FOUND', '知识库中没有与 ' + JSON.stringify(q) + ' 相关的内容', '这是『检索不到』而非系统故障；应走拒答或澄清');
    return { query: q, top_k: k, hits, index_version: 'stub-keyword-v1' };
  }

  private doQueryOrder(order_no: string, user_id: string) {
    const on = String(order_no ?? '').trim();
    if (!/^\d{3,}$/.test(on)) throw new ToolError('INVALID_ARGS', 'order_no 格式不合法', '通常是 4 位以上数字，例如 1001');
    const o = this.a.orders.find((x) => x.order_no === on);
    if (!o) throw new ToolError('NOT_FOUND', '未找到订单 ' + on, '请向用户核对订单号；不要用同一订单号重试');
    if (user_id && o.user_id !== user_id) throw new ToolError('AUTH_FAILED', '订单 ' + on + ' 不属于用户 ' + user_id, '订单归属校验失败：不暴露该订单的任何字段');
    return {
      order_no: o.order_no, status: o.status, status_cn: STATUS_CN[o.status] ?? o.status,
      total_amount: o.total_amount, created_at: o.created_at, tracking_no: o.tracking_no || '',
      refundable: o.refundable, items: o.items,
    };
  }

  private doQueryLogistics(order_no: string, tracking_no: string) {
    const on0 = String(order_no ?? '').trim();
    let tn = String(tracking_no ?? '').trim();
    if (!on0 && !tn) throw new ToolError('INVALID_ARGS', 'order_no 与 tracking_no 至少要给一个');
    let o: YyOrder | undefined;
    if (!tn) {
      if (!/^\d{3,}$/.test(on0)) throw new ToolError('INVALID_ARGS', 'order_no 格式不合法', '通常是 4 位以上数字，例如 1001');
      o = this.a.orders.find((x) => x.order_no === on0);
      if (!o) throw new ToolError('NOT_FOUND', '未找到订单 ' + on0);
      tn = o.tracking_no || '';
      if (!tn) throw new ToolError('NOT_FOUND', '订单 ' + on0 + ' 尚未发货，暂无物流信息', '这不是错误，请如实告知用户『还没发货』');
    }
    const nodes = (o?.events ?? this.a.orders.find((x) => x.tracking_no === tn)?.events ?? []);
    if (!nodes.length) throw new ToolError('NOT_FOUND', '运单号 ' + tn + ' 查询无轨迹', '可能刚揽收，建议稍后再查');
    const latest = nodes.slice(-6);
    return {
      tracking_no: tn, node_count: nodes.length, latest: latest[latest.length - 1].node,
      latest_time: latest[latest.length - 1].time, trace: latest, truncated_nodes: Math.max(0, nodes.length - latest.length),
    };
  }

  private doQueryRefundPolicy(order_no: string, aspect: string) {
    const out: Record<string, unknown> = { aspect: aspect || '全部' };
    const on = String(order_no ?? '').trim();
    if (on) {
      if (!/^\d{3,}$/.test(on)) throw new ToolError('INVALID_ARGS', 'order_no 格式不合法');
      const o = this.a.orders.find((x) => x.order_no === on);
      if (!o) throw new ToolError('NOT_FOUND', '未找到订单 ' + on);
      out.order_no = on;
      out.refundable = o.refundable;
      out.reason = o.refundable ? '在 7 天无理由期内，可申请退货' : '已签收超过 7 天，不适用无理由退货；质量问题仍可申请';
    }
    out.policy = this.a.policy
      .filter((p) => p.source.includes('退换货'))
      .map((p) => ({ chunk_id: p.topic, heading: p.source, text: p.rule }));
    return out;
  }

  private async doCreateTicket(order_no: string, reason: string, amount: number, confirmed: boolean) {
    const on = String(order_no ?? '').trim();
    if (!/^\d{3,}$/.test(on)) throw new ToolError('INVALID_ARGS', 'order_no 格式不合法');
    const o = this.a.orders.find((x) => x.order_no === on);
    if (!o) throw new ToolError('NOT_FOUND', '未找到订单 ' + on + '，无法创建工单');
    if (!String(reason ?? '').trim()) throw new ToolError('INVALID_ARGS', 'reason 不能为空');
    if (!confirmed) {
      return {
        need_confirmation: true, order_no: on,
        will_do: '为订单 ' + on + ' 创建售后工单，原因：' + String(reason).trim(),
        amount: Number(amount || 0), hint: '请用户确认后带 confirmed=true 重新调用',
      };
    }
    const hex = await sha256Hex(String(reason));
    const ticket_id = 'TK-' + on + '-' + hex.slice(0, 6).toUpperCase();
    return {
      need_confirmation: false, ticket_id, order_no: on, status: 'created',
      reason: String(reason).trim(), amount: Number(amount || 0),
    };
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolEnvelope> {
    const tool = this.a.tools.find((t) => t.name === name);
    const side = tool?.side_effect === 'write' ? 'write' : 'read';
    const t0 = performance.now();
    const key = await idemKey(name, args, this.threadId);
    const finish = (env: ToolEnvelope): ToolEnvelope => {
      env.elapsed_ms = performance.now() - t0;
      this.log.push({ tool: name, args, ok: env.ok, kind: env.error?.kind, key, duplicate: !!env.duplicate, ms: env.elapsed_ms, side });
      return env;
    };
    if (side === 'write') {
      const first = this.store.get(key);
      if (first) {
        return finish({ ...first, duplicate: true, data: first.data, meta: { ...first.meta, replayed_from: 'idempotency_store' } });
      }
    }
    try {
      let data: any;
      if (name === 'query_order') data = this.doQueryOrder(String(args.order_no ?? ''), String(args.user_id ?? 'u_001'));
      else if (name === 'query_logistics') data = this.doQueryLogistics(String(args.order_no ?? ''), String(args.tracking_no ?? ''));
      else if (name === 'search_kb') data = this.stubSearchKb(String(args.query ?? ''), Number(args.top_k ?? 3));
      else if (name === 'query_refund_policy') data = this.doQueryRefundPolicy(String(args.order_no ?? ''), String(args.aspect ?? ''));
      else if (name === 'create_ticket') data = await this.doCreateTicket(String(args.order_no ?? ''), String(args.reason ?? ''), Number(args.amount ?? 0), args.confirmed === true);
      else throw new ToolError('INTERNAL', '未实现的工具 ' + name);
      const env: ToolEnvelope = { tool: name, ok: true, data, error: null, idempotency_key: key, elapsed_ms: 0, meta: { side_effect: side } };
      if (side === 'write' && data && data.need_confirmation) {
        env.meta = { ...env.meta, note: 'need_confirmation 时不计副作用、不登记幂等（登记会让确认后的调用被吞掉）' };
      } else if (side === 'write') {
        this.store.set(key, env);
      }
      return finish(env);
    } catch (e) {
      const err = e instanceof ToolError ? e : new ToolError('INTERNAL', (e as Error).name + ': ' + (e as Error).message);
      return finish({
        tool: name, ok: false, error: { kind: err.kind, message: err.message, detail: err.detail, retryable: RETRYABLE[err.kind] ?? false },
        idempotency_key: key, elapsed_ms: 0, meta: { side_effect: side },
      });
    }
  }
}

/** 语义检索（真 embedding 路径）：查询向量 vs int8 去量化库向量的余弦（库向量已 L2 归一化）。 */
export function semanticSearchKb(qv: Float32Array, a: YyAssets, topK = 3) {
  const dim = cnum(a.kbMeta.dim, 1024);
  const n = a.kbMeta.count;
  const qn = Math.sqrt(qv.reduce((s, x) => s + x * x, 0)) || 1;
  const rows: { i: number; score: number }[] = [];
  for (let i = 0; i < n; i++) {
    let dot = 0;
    const off = i * dim;
    for (let j = 0; j < dim; j++) dot += qv[j] * a.kbVecs[off + j];
    rows.push({ i, score: (dot * a.kbScale[i]) / qn });
  }
  rows.sort((x, y) => y.score - x.score);
  const k = Math.max(1, Math.min(Math.trunc(topK || 3) || 3, 5));
  return {
    hits: rows.slice(0, k).map(({ i, score }) => ({ chunk_id: a.kb[i].id, heading: a.kb[i].title, text: a.kb[i].text, score: Math.round(score * 1000) / 1000 })),
    all: rows.slice(0, 20).map(({ i, score }) => ({ i, score })),
  };
}

export function exitById(exits: YyExit[], id: string): YyExit | undefined { return exits.find((e) => e.id === id); }
export function fmtMs2(ms: number): string { return ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : Math.round(ms) + ' ms'; }
export type { YyKbMeta };