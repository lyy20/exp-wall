// 首页迷你演示：两块项目卡片，滚进视口就自动在浏览器里跑一遍（零配置、无按钮），结果当场出来。
// 数据全部来自项目里的真实产物（public/data/**），与完整页用的是同一份资产。
import { useEffect, useRef, useState } from 'react';
import FadeIn from './FadeIn';

type Row = { k: string; v: string; ok?: boolean };
type St = { busy: boolean; err: string | null; rows: Row[]; note: string; ms: number | null };

const EMPTY: St = { busy: false, err: null, rows: [], note: '', ms: null };
const ms2 = (ms: number) => (ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : Math.round(ms) + ' ms');
const short = (s: string, n = 74) => (s.length > n ? s.slice(0, n) + '…' : s);

function useAutoRun(fn: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const fired = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (fired.current) return;
        if (entries.some((e) => e.isIntersecting)) {
          fired.current = true;
          io.disconnect();
          fnRef.current();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

function Rows({ s }: { s: St }) {
  if (s.err) {
    return (
      <p className="mt-3 rounded-xl border border-[#FF6B6B]/40 bg-[#FF6B6B]/[0.06] px-3 py-2 text-[10.5px] leading-relaxed text-[#FF6B6B]">
        这一步没跑通：{s.err}
      </p>
    );
  }
  return (
    <div>
      {s.busy && <p className="mt-3 text-[10.5px] uppercase tracking-[0.14em] text-[#D7E2EA]/45">浏览器里真跑中…</p>}
      {s.rows.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {s.rows.map((r, i) => (
            <li key={i} className="flex gap-2 text-[10.5px] leading-[1.55] md:text-[11.5px]">
              <span className={r.ok === false ? 'text-[#FF6B6B]' : 'text-[#3DDC97]'}>{r.ok === false ? '✗' : '✓'}</span>
              <span className="min-w-0 flex-1">
                <span className="text-[#D7E2EA]/55">{r.k}</span>
                <span className="mx-1.5 text-[#D7E2EA]/25">/</span>
                <span className="text-[#D7E2EA]">{r.v}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {(s.rows.length > 0 || s.ms !== null) && (
        <p className="mt-3 text-[10px] leading-relaxed text-[#D7E2EA]/45">
          {s.note}
          {s.ms !== null ? ' · 浏览器内 ' + ms2(s.ms) : ''}
        </p>
      )}
    </div>
  );
}

function Chips({ list, active, onPick }: { list: string[]; active: string; onPick: (v: string) => void }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
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
          {c.length > 26 ? c.slice(0, 26) + '…' : c}
        </button>
      ))}
    </div>
  );
}

const YY_Q = ['订单 1003 现在到哪了？', '运费是怎么算的？', '我要退货，能退吗？'];

function YyMini() {
  const [q, setQ] = useState(YY_Q[0]);
  const [s, setS] = useState<St>(EMPTY);

  const run = async (text: string) => {
    setQ(text);
    setS({ ...EMPTY, busy: true });
    const t0 = performance.now();
    try {
      const [ya, eng] = await Promise.all([import('../yyhelp/assets'), import('../yyhelp/engine')]);
      const a = await ya.loadYyAssets();
      const rows: Row[] = [];
      const d = eng.decide(text, a.intents, { hasLlm: false });
      rows.push({
        k: '意图路由',
        v:
          d.intent +
          ' → ' +
          d.exit +
          (d.hits.length ? '（' + d.hits.length + ' 条规则命中，置信度 ' + d.confidence + '）' : '（无规则命中 → ' + d.method + '）'),
        ok: true,
      });
      const rt = new eng.ToolRuntime(a, 'home_' + Date.now().toString(36));
      const orderNo = (/(\d{4,})/.exec(text) || [''])[0];
      const o = orderNo ? (a.orders as any[]).find((x) => x.order_no === orderNo) : undefined;
      const tool = o ? 'query_order' : 'search_kb';
      const args: Record<string, unknown> = o ? { order_no: o.order_no, user_id: o.user_id } : { query: text, top_k: 3 };
      const env = await rt.call(tool, args);
      rows.push({ k: '工具 ' + tool, v: env.ok ? 'ok · ' + short(JSON.stringify(env.data)) : '拒绝 ' + env.error?.kind, ok: env.ok });
      const wo = o ?? (a.orders as any[])[0];
      const wargs = { order_no: wo.order_no, reason: '用户反馈：' + text.trim().slice(0, 16), amount: 0, confirmed: false };
      const e1 = await rt.call('create_ticket', wargs);
      const e2 = await rt.call('create_ticket', { ...wargs, confirmed: true });
      const e3 = await rt.call('create_ticket', { ...wargs, confirmed: true });
      rows.push({ k: '未确认就写', v: e1.ok && e1.data?.need_confirmation ? '被挡下：need_confirmation=true，不落库、不登记幂等' : '未拦住', ok: !!(e1.ok && e1.data?.need_confirmation) });
      rows.push({ k: '确认后建单', v: e2.data?.ticket_id ? '建单 ' + String(e2.data.ticket_id) : '未建单', ok: !!e2.ok });
      rows.push({ k: '同参重放', v: e3.duplicate ? 'duplicate=true · 命中幂等键，不会重复建单' : 'duplicate=false', ok: !!e3.duplicate });
      setS({ busy: false, err: null, rows, note: '规则路由、参数校验、工具信封与幂等键都在你浏览器里真执行', ms: performance.now() - t0 });
    } catch (e) {
      setS({ ...EMPTY, err: (e as Error).message });
    }
  };

  const ref = useAutoRun(() => void run(YY_Q[0]));
  return (
    <div ref={ref}>
      <Chips list={YY_Q} active={q} onPick={(v) => void run(v)} />
      <Rows s={s} />
    </div>
  );
}

const RAG_Q = ['CTRIP-SAC 的安全距离区间是多少？', '可观测范围与越界距离的阈值分别是多少？', '观测空间最多记录多少个障碍物？采用什么策略？'];

function RagMini() {
  const [q, setQ] = useState(RAG_Q[0]);
  const [s, setS] = useState<St>(EMPTY);

  const run = async (text: string) => {
    setQ(text);
    setS({ ...EMPTY, busy: true });
    const t0 = performance.now();
    try {
      const [ra, rr] = await Promise.all([import('../rag/assets'), import('../rag/retrieve')]);
      const a = await ra.loadRagAssets();
      const hit = ra.findQueryVector(a, text);
      if (!hit) throw new Error('这句不在离线预置的 24 个真实问题里，换个示例试试');
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
      const ev = a.evalFile.questions.find((x) => x.q === hit.item.q);
      const goldIds = new Set<string>(((ev && ev.gt) || []).map((g) => g.id));
      const goldIdx = new Set<number>();
      goldIds.forEach((id) => { const i = map.get(id); if (i !== undefined) goldIdx.add(i); });
      const rows: Row[] = [];
      for (let i = 0; i < Math.min(3, stages.final.length); i++) {
        const c = a.chunks[stages.final[i].idx];
        rows.push({
          k: '#' + (i + 1) + ' ' + c.doc + ' · p' + c.page,
          v: 'RRF ' + stages.final[i].score.toFixed(4) + (goldIds.has(c.id) ? ' · 命中标准答案 chunk' : '') + ' · ' + short(c.text.replace(/\s+/g, ' ')),
          ok: goldIds.has(c.id) ? true : undefined,
        });
      }
      if (ev) {
        const sc = rr.scoreOne(stages.final.map((f) => f.idx), goldIdx);
        const pyRank = typeof ev.py_rank === 'number' ? ev.py_rank : -1;
        rows.push({
          k: '与 Python 同口径',
          v: 'Python rank ' + (pyRank > 0 ? pyRank : '未进前 5') + ' / 浏览器 rank ' + (sc.rank > 0 ? sc.rank : '未进前 5') + '（Recall@5 ' + sc.recall5 + '）',
          ok: pyRank === sc.rank,
        });
      }
      setS({ busy: false, err: null, rows, note: '分词 / BM25 / 去量化向量内积 / RRF 全在你浏览器里真算，数字来自 55 篇论文的真实语料', ms: performance.now() - t0 });
    } catch (e) {
      setS({ ...EMPTY, err: (e as Error).message });
    }
  };

  const ref = useAutoRun(() => void run(RAG_Q[0]));
  return (
    <div ref={ref}>
      <Chips list={RAG_Q} active={q} onPick={(v) => void run(v)} />
      <Rows s={s} />
    </div>
  );
}

function MiniCard({ n, name, claim, children }: { n: string; name: string; claim: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col rounded-3xl border border-[#D7E2EA]/15 bg-[#D7E2EA]/[0.03] p-4 md:p-5">
      <div className="flex items-baseline gap-3">
        <span className="hero-heading text-3xl font-black leading-none">{n}</span>
        <h3 className="text-[13px] font-bold uppercase leading-snug text-[#D7E2EA] md:text-[15px]">{name}</h3>
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-[#D7E2EA]/50 md:text-[11px]">{claim}</p>
      <div className="mt-3 border-t border-[#D7E2EA]/10 pt-3">{children}</div>
    </div>
  );
}

export default function DemoPanels() {
  return (
    <section id="demos" className="relative z-10 bg-[#0C0C0C] px-4 pb-24 pt-2 md:px-8">
      <div className="mx-auto max-w-5xl">
        <FadeIn>
          <h2 className="hero-heading text-center font-black" style={{ fontSize: 'clamp(1.75rem, 5vw, 3.25rem)', lineHeight: 1 }}>
            Interactive
          </h2>
        </FadeIn>
        <FadeIn delay={0.1}>
          <p className="mx-auto mt-5 max-w-[560px] text-center text-xs leading-relaxed text-[#D7E2EA]/70 md:text-sm">
            滚到这里，两块面板会自动在你浏览器里跑一遍：不用填 key、不用点按钮，结果就地出来。
          </p>
        </FadeIn>
        <div className="mt-9 grid grid-cols-1 gap-4 md:grid-cols-2">
          <FadeIn delay={0.05} className="h-full">
            <MiniCard n="01" name="YYHelp 电商智能客服平台" claim="多轮对话要能把事办完：路由、工具、确认、幂等">
              <YyMini />
            </MiniCard>
          </FadeIn>
          <FadeIn delay={0.12} className="h-full">
            <MiniCard n="02" name="科研文献 RAG 问答平台" claim="检索链路与排名都能对着 Python 结果核对">
              <RagMini />
            </MiniCard>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}
