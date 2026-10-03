// P4：首页迷你交互面板 —— 三个项目各一块，零配置即可在浏览器里真跑一小步。
// EAP：重算真实序列的统计量并与 Python golden 逐项对照；
// YYHelp：真跑 13 条正则路由 + 工具信封锁（参数校验 / 幂等键 / 写操作确认）；
// RAG：真加载 800 条子集资产，跑 dense(int8 去量化) + BM25 + RRF，并与 Python 排序对照。
// 资产与三个完整页完全同一份 public/data/**，面板里不预置任何答案。
import { useState, type ReactNode } from 'react';
import FadeIn from './FadeIn';
import { asset, page } from '../shared/asset';

type Row = { k: string; v: string; ok?: boolean };
type Mini = { busy: boolean; err: string | null; rows: Row[]; note: string; ms: number | null };
type St = { busy: boolean; err: unknown; rows: Row[]; note: string; ms: number | null };

const EMPTY: Mini = { busy: false, err: null, rows: [], note: '', ms: null };

async function getJson(p: string): Promise<any> {
  const r = await fetch(asset(p));
  if (!r.ok) throw new Error(p + ' → HTTP ' + r.status);
  return r.json();
}
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-9, Math.abs(b));
const sci = (x: number) => (x === 0 ? '0' : x.toExponential(1));
const short = (s: string, n = 96) => (s.length > n ? s.slice(0, n) + '…' : s);
const ms2 = (ms: number) => (ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : Math.round(ms) + ' ms');

function RowList({ rows }: { rows: Row[] }) {
  return (
    <ul className="mt-3 space-y-1.5">
      {rows.map((r, i) => (
        <li key={i} className="flex gap-2 text-[10.5px] leading-[1.5] md:text-[11.5px]">
          <span className={r.ok === undefined ? 'text-[#D7E2EA]/35' : r.ok ? 'text-[#3DDC97]' : 'text-[#FF6B6B]'}>
            {r.ok === undefined ? '·' : r.ok ? '✓' : '✗'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="text-[#D7E2EA]/55">{r.k}</span>
            <span className="mx-1.5 text-[#D7E2EA]/25">/</span>
            <span className="text-[#D7E2EA]">{r.v}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Out({ s }: { s: Mini }) {
  return (
    <div>
      {s.err && (
        <p className="mt-3 rounded-xl border border-[#FF6B6B]/40 bg-[#FF6B6B]/[0.06] px-3 py-2 text-[10.5px] leading-relaxed text-[#FF6B6B]">
          真跑失败：{s.err}
        </p>
      )}
      {s.rows.length > 0 && <RowList rows={s.rows} />}
      {s.note && <p className="mt-3 text-[10px] leading-relaxed text-[#D7E2EA]/50">{s.note}</p>}
      {s.ms !== null && <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-[#D7E2EA]/35">浏览器内耗时 {ms2(s.ms)}</p>}
    </div>
  );
}

function chips(list: string[], active: string, onPick: (v: string) => void) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {list.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onPick(c)}
          className={
            'rounded-full border px-2.5 py-1 text-[10px] transition duration-200 ' +
            (c === active
              ? 'border-[#D7E2EA]/60 bg-[#D7E2EA]/10 text-[#D7E2EA]'
              : 'border-[#D7E2EA]/20 text-[#D7E2EA]/60 hover:border-[#D7E2EA]/40 hover:text-[#D7E2EA]')
          }
        >
          {c}
        </button>
      ))}
    </div>
  );
}

function Go({ busy, label, onClick }: { busy: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="mt-3 w-full rounded-full bg-[#D7E2EA]/10 px-3 py-2 text-[10.5px] uppercase tracking-[0.18em] text-[#D7E2EA] transition duration-200 hover:bg-[#D7E2EA]/20 disabled:cursor-wait disabled:opacity-50 md:text-[11px]"
    >
      {busy ? '真跑中…' : label}
    </button>
  );
}

// golden.json 里的数字只有 6~7 位有效数字，仅「存储舍入」本身就带来 ~1e-6 量级的相对偏差
// （已逐项核对：观测到的最大偏差与 golden 的小数位舍入量级一致，纯属文件精度，不是算法差异）。
// 所以判据取 1e-5 相对误差 —— 真算错会差好几个数量级，这个阈值挡得住。
const EAP_TOL = 1e-5;

function EapMini() {
  const [s, setS] = useState<Mini>(EMPTY);
  const run = async () => {
    if (s.busy) return;
    setS({ ...EMPTY, busy: true });
    const t0 = performance.now();
    try {
      const [series, golden, st] = await Promise.all([
        getJson('data/eap/series.json'),
        getJson('data/eap/golden.json'),
        import('../shared/compute/stats') as Promise<any>,
      ]);
      const gmap = new Map<string, any>();
      for (const g of golden.series) gmap.set(g.run_id + '|' + g.metric, g);
      const rows: Row[] = [];
      let worst = 0;
      let worstKey = '';
      let done = 0;
      for (const r0 of series.runs) {
        const g = gmap.get(r0.run_id + '|' + r0.metric);
        if (!g) continue;
        const ys: number[] = r0.ys;
        const xs: number[] = r0.xs;
        const checks: [string, number, number][] = [
          ['mean', st.mean(ys), g.mean],
          ['std', st.std(ys, 1), g.std],
          ['sem', st.sem(ys), g.sem],
          ['median', st.median(ys), g.median],
          ['p95', st.quantile(ys, 0.95), g.p95],
          ['OLS 斜率×100', st.linreg(xs, ys).slope * 100, g.slope_per_100],
        ];
        let e = 0;
        let which = '';
        for (const c of checks) {
          const d = rel(c[1], c[2]);
          if (d > e) {
            e = d;
            which = c[0];
          }
        }
        done++;
        if (e > worst) {
          worst = e;
          worstKey = r0.run_id + ' · ' + r0.metric + '（' + which + '）';
        }
        if (rows.length < 3) rows.push({ k: r0.run_id + ' · ' + r0.metric, v: 'n=' + ys.length + ' · 6 个统计量最大相对误差 ' + sci(e), ok: e < EAP_TOL });
      }
      const rmap = new Map<string, number[]>();
      for (const r0 of series.runs) rmap.set(r0.run_id + '|' + r0.metric, r0.ys);
      let wdone = 0;
      let wworst = 0;
      for (const w of golden.welch_tests) {
        const A = rmap.get(w.a);
        const B = rmap.get(w.b);
        if (!A || !B) continue;
        const out = st.welchT(A, B);
        const e = Math.max(rel(out.t, w.t), rel(out.df, w.df), rel(out.p, w.p));
        wdone++;
        if (e > wworst) wworst = e;
        if (wdone <= 2) {
          rows.push({
            k: 'Welch t · ' + String(w.a).split('|')[1],
            v: 't=' + out.t.toFixed(6) + ' · df=' + out.df.toFixed(3) + ' · p=' + out.p.toExponential(3) + ' · 误差 ' + sci(e),
            ok: e < EAP_TOL,
          });
        }
      }
      const notes =
        done +
        ' 条真实 episode 序列 × 6 个统计量（mean / std / sem / median / p95 / OLS 斜率）与 Python numpy+scipy 的 golden 值逐项对比，最大相对误差 ' +
        sci(worst) +
        '（' + worstKey + '）；' +
        wdone +
        ' 组 Welch t 检验（equal_var=False、Welch–Satterthwaite 自由度）最大相对误差 ' +
        sci(wworst) +
        '（判据 1e-5：golden 值落到文件里只剩 6~7 位有效数字，这一量级的偏差就是它自己的舍入）。全部在浏览器内确定性计算：这个项目的设计就是不许 LLM 碰这些数字。';
      setS({ busy: false, err: null, rows, note: notes, ms: performance.now() - t0 });
    } catch (e) {
      setS({ busy: false, err: (e as Error).message, rows: [], note: '', ms: null });
    }
  };
  return (
    <div>
      <p className="text-[10.5px] leading-relaxed text-[#D7E2EA]/70 md:text-[11.5px]">
        点一下：把 <span className="text-[#D7E2EA]">10 条真实 episode 序列</span>的 mean / std / sem / median / p95 / OLS
        斜率在浏览器里重算一遍，再与 Python 侧 numpy+scipy 冻结的 golden 值逐项比对；顺带重算 4 组 Welch t 检验。
      </p>
      <Go busy={s.busy} label="重算统计量并对比 golden" onClick={run} />
      <Out s={s} />
    </div>
  );
}

const YY_CHIPS = ['订单 1003 现在到哪了？', '运费是怎么算的？', '我要退货，能退吗？'];

function YyMini() {
  const [text, setText] = useState(YY_CHIPS[0]);
  const [s, setS] = useState<Mini>(EMPTY);
  const run = async () => {
    if (s.busy || !text.trim()) return;
    setS({ ...EMPTY, busy: true });
    const t0 = performance.now();
    try {
      const [ya, eng] = await Promise.all([import('../yyhelp/assets'), import('../yyhelp/engine')]);
      const a = await ya.loadYyAssets();
      const rows: Row[] = [];
      const d = eng.decide(text, a.intents, { hasLlm: false });
      rows.push({
        k: 'triage · 13 条正则真匹配',
        v: '意图 ' + d.intent + ' → 出口 ' + d.exit + ' → 节点 ' + d.node + ' · ' + d.method + ' · 置信度 ' + d.confidence,
        ok: d.hits.length > 0,
      });
      rows.push({
        k: '命中规则',
        v: d.hits.length
          ? d.hits.map((h) => '#' + h.index + ' ' + h.intent + '(w' + h.weight + ') 匹配「' + h.matched + '」').join('  +  ')
          : '本次无规则命中（权重和未过阈值 2）→ 走 ' + d.method,
      });
      const rt = new eng.ToolRuntime(a, 'home_mini_' + Date.now().toString(36));
      const orderNo = (/(\d{4,})/.exec(text) || [''])[0];
      const o = orderNo ? (a.orders as any[]).find((x) => x.order_no === orderNo) : undefined;
      let tool = 'search_kb';
      let args: Record<string, unknown> = { query: text, top_k: 3 };
      if (o) {
        tool = 'query_order';
        args = { order_no: o.order_no, user_id: o.user_id };
      }
      const env = await rt.call(tool, args);
      rows.push({
        k: '读工具 ' + tool,
        v: env.ok ? 'ok · ' + short(JSON.stringify(env.data), 130) : '拒绝 ' + env.error?.kind + ' · ' + env.error?.message,
        ok: env.ok,
      });
      const wo = o ?? (a.orders as any[])[0];
      const wargs = { order_no: wo.order_no, reason: '用户反馈：' + text.trim().slice(0, 18), amount: 0, confirmed: false };
      const e1 = await rt.call('create_ticket', wargs);
      const e2 = await rt.call('create_ticket', { ...wargs, confirmed: true });
      const e3 = await rt.call('create_ticket', { ...wargs, confirmed: true });
      rows.push({
        k: '写工具① 未确认',
        v: e1.ok
          ? 'need_confirmation=' + String(e1.data?.need_confirmation) + ' · 不计副作用、不登记幂等'
          : '拒绝 ' + e1.error?.kind + ' · ' + e1.error?.message,
        ok: e1.ok,
      });
      rows.push({
        k: '写工具② confirmed=true',
        v: e2.ok ? '建单 ' + String(e2.data?.ticket_id) + ' · 幂等键 ' + e2.idempotency_key.slice(0, 12) + '…' : '拒绝 ' + e2.error?.kind,
        ok: e2.ok,
      });
      rows.push({
        k: '写工具③ 同参重放',
        v: e3.duplicate ? 'duplicate=true · 命中幂等键，回放同一结果，不会重复建单' : 'duplicate=false（幂等登记未生效）',
        ok: !!e3.duplicate,
      });
      setS({
        busy: false,
        err: null,
        rows,
        note:
          '规则路由、参数校验、统一信封、幂等键全在浏览器里执行；知识库检索是项目默认的 stub 逐字复刻（真 Milvus 需要后端）。完整 ReAct 循环（LLM 逐步决策 + 步数/时限/重复调用三重终止）与 17 组真实对话回放在完整页。',
        ms: performance.now() - t0,
      });
    } catch (e) {
      setS({ busy: false, err: (e as Error).message, rows: [], note: '', ms: null });
    }
  };
  return (
    <div>
      <p className="text-[10.5px] leading-relaxed text-[#D7E2EA]/70 md:text-[11.5px]">
        挑一句用户原话（或自己写一句，含 4 位订单号会走订单工具），真跑一轮：
        <span className="text-[#D7E2EA]">规则路由 → 工具信封锁 → 写操作确认 → 幂等重放</span>。
      </p>
      {chips(YY_CHIPS, text, setText)}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="也可以自己写一句…"
        className="mt-2 w-full rounded-xl border border-[#D7E2EA]/20 bg-[#0C0C0C] px-3 py-2 text-[11px] text-[#D7E2EA] outline-none transition duration-200 placeholder:text-[#D7E2EA]/30 focus:border-[#D7E2EA]/50"
      />
      <Go busy={s.busy} label="真跑一轮" onClick={run} />
      <Out s={s} />
    </div>
  );
}

const RAG_CHIPS = [
  'CTRIP-SAC 的安全距离区间是多少？',
  '可观测范围与越界距离的阈值分别是多少？',
  '观测空间最多记录多少个障碍物？采用什么策略？',
];

function RagMini() {
  const [text, setText] = useState(RAG_CHIPS[0]);
  const [s, setS] = useState<Mini>(EMPTY);
  const run = async () => {
    if (s.busy || !text.trim()) return;
    setS({ ...EMPTY, busy: true });
    const t0 = performance.now();
    try {
      const [ra, rr] = await Promise.all([import('../rag/assets'), import('../rag/retrieve')]);
      const a = await ra.loadRagAssets();
      const hit = ra.findQueryVector(a, text);
      if (!hit) throw new Error('离线只预置了 24 个真实问题的查询向量，请从上面的 chip 里选一个（或去完整页填入 key 实时提问）');
      const qv = ra.f32FromBase64(hit.item.vec);
      const cfg = {
        denseTopK: a.config.dense_top_k,
        sparseTopK: a.config.sparse_top_k,
        rrfK: a.config.rrf_k,
        fusedTopK: a.config.fused_top_k,
        finalK: a.config.top_k,
      };
      const stages = rr.retrieve(qv, text, a.vecs, a.rowScale, a.meta.dim, a.bm25, cfg);
      const map = new Map<string, number>();
      a.meta.ids.forEach((id, i) => map.set(id, i));
      const ev = a.evalFile.questions.find((q) => q.q === hit.item.q);
      const goldIds = new Set<string>(((ev && ev.gt) || []).map((g) => g.id));
      const goldIdx = new Set<number>();
      goldIds.forEach((id) => {
        const i = map.get(id);
        if (i !== undefined) goldIdx.add(i);
      });
      const rows: Row[] = [];
      rows.push({
        k: '查询向量',
        v: '离线预计算 bge-m3 float32（相似度 ' + hit.sim.toFixed(3) + ' 命中「' + hit.item.q + '」）',
        ok: hit.sim > 0.6,
      });
      rows.push({
        k: '链路',
        v:
          stages.tokens.length +
          ' 个 CJK bigram / 拉丁词 → dense(int8 去量化内积) ' +
          stages.dense.length +
          ' 条 + BM25 ' +
          stages.sparse.length +
          ' 条 → RRF(k=' +
          cfg.rrfK +
          ') 取 ' +
          cfg.fusedTopK +
          ' 截前 ' +
          cfg.finalK,
      });
      for (let i = 0; i < stages.final.length; i++) {
        const c = a.chunks[stages.final[i].idx];
        rows.push({
          k: '#' + (i + 1) + ' ' + c.doc + ' · p' + c.page,
          v: 'rrf ' + stages.final[i].score.toFixed(5) + (goldIds.has(c.id) ? ' · 命中 gt' : '') + ' · ' + short(c.text.replace(/\s+/g, ' '), 64),
          ok: goldIds.has(c.id) ? true : undefined,
        });
      }
      if (ev) {
        const sc = rr.scoreOne(stages.final.map((f) => f.idx), goldIdx);
        const pyRank = typeof ev.py_rank === 'number' ? ev.py_rank : -1;
        rows.push({
          k: '与 Python 同口径对照',
          v:
            'Python rank ' +
            (pyRank > 0 ? pyRank : '未命中前 5') +
            ' / recall@5 ' +
            (ev.py_recall5 ?? '—') +
            '　—　浏览器 rank ' +
            (sc.rank > 0 ? sc.rank : '未命中前 5') +
            ' / recall@5 ' +
            sc.recall5,
          ok: pyRank === sc.rank,
        });
      }
      setS({
        busy: false,
        err: null,
        rows,
        note:
          '首次点击会加载 data/rag/ 下约 1.9 MB 真资产（800 条 chunk 子集 + int8 向量 + BM25 倒排 + 24 条离线查询向量），随后在同一会话里复用。20 题 Recall@5 / MRR 的浏览器重算与 Python 数字并列在完整页。',
        ms: performance.now() - t0,
      });
    } catch (e) {
      setS({ busy: false, err: (e as Error).message, rows: [], note: '', ms: null });
    }
  };
  return (
    <div>
      <p className="text-[10.5px] leading-relaxed text-[#D7E2EA]/70 md:text-[11.5px]">
        选一个评测集里的真实问题，在浏览器里跑完整检索链路，并把排名与
        <span className="text-[#D7E2EA]"> Python 侧同口径结果</span>逐题对照（含未命中的题）。
      </p>
      {chips(RAG_CHIPS, text, setText)}
      <Go busy={s.busy} label="加载资产并真检索" onClick={run} />
      <Out s={s} />
    </div>
  );
}

function MiniCard({
  n,
  name,
  claim,
  href,
  hrefLabel,
  children,
}: {
  n: string;
  name: string;
  claim: string;
  href: string;
  hrefLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col rounded-3xl border border-[#D7E2EA]/15 bg-[#D7E2EA]/[0.03] p-4 md:p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="hero-heading text-3xl font-black leading-none">{n}</span>
        <a
          href={href}
          className="shrink-0 rounded-full border border-[#D7E2EA]/40 px-2.5 py-1 text-[9px] uppercase tracking-[0.16em] text-[#D7E2EA] transition duration-200 hover:bg-[#D7E2EA]/10 md:text-[10px]"
        >
          {hrefLabel} →
        </a>
      </div>
      <h3 className="mt-3 text-[13px] font-bold uppercase leading-snug text-[#D7E2EA] md:text-[15px]">{name}</h3>
      <p className="mt-1.5 text-[10px] leading-relaxed text-[#D7E2EA]/50 md:text-[11px]">{claim}</p>
      <div className="mt-3 border-t border-[#D7E2EA]/10 pt-3">{children}</div>
    </div>
  );
}

export default function DemoPanels() {
  return (
    <section id="demos" className="relative z-10 bg-[#0C0C0C] px-4 pb-24 pt-2 md:px-8">
      <div className="mx-auto max-w-6xl">
        <FadeIn>
          <h2
            className="hero-heading text-center font-black"
            style={{ fontSize: 'clamp(1.75rem, 5vw, 3.25rem)', lineHeight: 1 }}
          >
            Interactive
          </h2>
        </FadeIn>
        <FadeIn delay={0.1}>
          <p className="mx-auto mt-5 max-w-[640px] text-center text-xs leading-relaxed text-[#D7E2EA]/70 md:text-sm">
            这三块面板不用填任何 key：点一下就在你的浏览器里真跑一小步 —— 重算统计量、跑规则路由与工具信封锁、真检索。
            数据全部来自项目里的真实产物，每个项目还有完整版页面，把「真跑 / 未做」的边界写得更细。
          </p>
        </FadeIn>
        <div className="mt-9 grid grid-cols-1 gap-4 md:grid-cols-3">
          <FadeIn delay={0.05} className="h-full">
            <MiniCard
              n="01"
              name="科研实验分析助手 Agent"
              claim="平台层 · 数值只许在确定性代码里算"
              href={page('eap')}
              hrefLabel="完整页"
            >
              <EapMini />
            </MiniCard>
          </FadeIn>
          <FadeIn delay={0.12} className="h-full">
            <MiniCard
              n="02"
              name="YYHelp 电商智能客服平台"
              claim="应用层 · 多轮对话要能可靠地把事办完"
              href={page('yyhelp')}
              hrefLabel="完整页"
            >
              <YyMini />
            </MiniCard>
          </FadeIn>
          <FadeIn delay={0.19} className="h-full">
            <MiniCard
              n="03"
              name="科研文献 RAG 问答平台"
              claim="应用层 · 检索链路与评测都摆在桌面上"
              href={page('rag')}
              hrefLabel="完整页"
            >
              <RagMini />
            </MiniCard>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}
