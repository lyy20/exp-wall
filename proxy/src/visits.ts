// 访问记录（第一方计数）—— 「谁看过这个站」的最小实现。
//
// 为什么放在这个 Worker 里，而不是接第三方统计：
//   · 站点是纯静态的（GitHub Pages + Cloudflare 静态资源），没有任何后端；想留下访问记录就必须有一个
//     能写存储的地方。这个 Worker 已经绑了 KV（RATE_KV，原本给 LLM 预算记账用），再开一个键前缀就够。
//   · 两家部署域名（lyy20.github.io / agent-lyy.top）要能一起统计 —— 第三方统计只能覆盖其中一边。
//   · 数据留在自己的账号里，不引第三方脚本，也不用在页面上做 cookie 同意。
//
// ⚠️ 能统计到什么，先说清楚（这条比实现更重要）：
//   匿名访客**永远无法知道「是谁」**。能拿到的是：什么时间、看了哪一页、从哪个站跳来的、
//   大概哪个国家/城市、什么浏览器/系统/手机还是电脑、以及「同一天同一个人的第几次」。
//   跨天、跨设备的同一个人是认不出来的。要真认人只能加登录，那是另一件事。
//
// 隐私口径：
//   · **不存 IP**。IP 只在内存里参与一次不可逆哈希（`u` 字段），用来数当日独立访客，当天过后无法还原。
//   · 不写 cookie，不存完整 referrer，只存来源主机名（`www.google.com` 这个粒度）。
//   · 页面路径也不带 query（避免把搜索词之类的东西记进来）。
//
// 存储形态（KV 只有 get/put，没有原子自增，也没有 list）：
//   一天一个键 `V:<YYYY-MM-DD>`，值是 { n, drop, recs: [...] }。
//   · `n` 是当天页面浏览数 —— 即使 recs 到了上限也照样加，所以 pv 永远准；
//   · `recs` 只留最近的上限条明细 —— 独立访客数与聚合分布是在**读的时候**按这块明细算的，
//     所以它们只覆盖「有明细的那部分」，响应里会把这件事写进 note，不假装是全量。
//   · 读改写没有锁，并发下可能丢一条 —— 和 limits.ts 的日账本同一个取舍，访问统计这种量级可以接受。
//
// 免费档配额：KV 每天 1000 次写。一次浏览 = 1 次写，所以单日上限设 400，剩下的留给 LLM 预算账本。

import type { KVLike } from './limits.ts';
import { corsHeaders, jsonResponse, originAllowed } from './guards.ts';

export interface VisitsEnv {
  RATE_KV?: KVLike;
  /** 读接口的口令。未配置时读接口 fail-closed（503），写接口不受影响。 */
  VISITS_TOKEN?: string;
}

/** 单日最多留多少条明细（pv 不受这个限制）。 */
export const DAY_RECORD_LIMIT = 400;

const PATH_MAX = 300;
const REF_MAX = 200;

export interface VisitRecord {
  /** 毫秒时间戳 */
  t: number;
  /** 页面路径（不含 query） */
  p: string;
  /** 来源主机名，直接访问为空串 */
  r: string;
  /** 国家/地区代码（Cloudflare 提供） */
  cc: string;
  /** 城市（Cloudflare 提供时） */
  ct: string;
  /** 浏览器族 */
  br: string;
  /** 系统族 */
  os: string;
  /** mobile | desktop */
  dv: string;
  /** 当日访客哈希（IP+日期+盐，不可逆，只用来数独立访客） */
  u: string;
}

interface DayBucket {
  /** 当天页面浏览数（准，不受 recs 上限影响） */
  n: number;
  /** 因为超过上限而没有留明细的条数 */
  drop: number;
  recs: VisitRecord[];
}

function emptyBucket(): DayBucket {
  return { n: 0, drop: 0, recs: [] };
}

export function utcDayOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function dayKey(day: string): string {
  return 'V:' + day;
}

function shiftDay(day: string, deltaDays: number): string {
  const t = Date.parse(day + 'T00:00:00Z');
  return new Date(t + deltaDays * 86400000).toISOString().slice(0, 10);
}

/** UA → 三个粗粒度标签。不做版本号，越细越像指纹。 */
export function uaFamily(ua: string): { br: string; os: string; dv: string } {
  const s = (ua || '').toLowerCase();
  const dv = /iphone|ipad|ipod|android|mobile|harmonyos/.test(s) ? 'mobile' : 'desktop';
  let os = 'Other';
  if (s.indexOf('windows') >= 0) os = 'Windows';
  else if (s.indexOf('iphone') >= 0 || s.indexOf('ipad') >= 0) os = 'iOS';
  else if (s.indexOf('android') >= 0) os = 'Android';
  else if (s.indexOf('mac os x') >= 0 || s.indexOf('macintosh') >= 0) os = 'macOS';
  else if (s.indexOf('linux') >= 0) os = 'Linux';
  let br = 'Other';
  if (s.indexOf('edg/') >= 0) br = 'Edge';
  else if (s.indexOf('firefox/') >= 0) br = 'Firefox';
  else if (s.indexOf('chrome/') >= 0 || s.indexOf('crios/') >= 0) br = 'Chrome';
  else if (s.indexOf('safari/') >= 0) br = 'Safari';
  return { br, os, dv };
}

/** 只留来源主机名；同站跳转（含空）返回空串，免得把站内导航也算成「来源」。 */
export function referrerHost(referrer: string, selfHost: string): string {
  if (!referrer) return '';
  try {
    const u = new URL(referrer);
    if (selfHost && u.hostname === selfHost) return '';
    return (u.hostname || '').slice(0, REF_MAX);
  } catch {
    return '';
  }
}

/**
 * 「自己是谁」取的是 **Origin 头**（= 打点那个页面的源），不是本 Worker 的主机名。
 * 页面在 agent-lyy.top、接口在 llm.agent-lyy.top，拿请求主机名去比永远不等于站内跳转的 referrer ——
 * 这条一开始写错了，症状是站内导航被记成来源 `agent-lyy.top`，把真实来源挤出了 top 列表。
 */
function originHostOf(origin: string | null, req: Request): string {
  if (origin) {
    try {
      return new URL(origin).hostname;
    } catch {
      /* 落到请求主机名 */
    }
  }
  try {
    return new URL(req.url).hostname;
  } catch {
    return '';
  }
}

/** 去掉 query 与 hash：统计要的是「哪一页」，不是「搜了什么」。 */
export function cleanPath(raw: string): string {
  const s = String(raw || '').split('#')[0].split('?')[0];
  return (s || '/').slice(0, PATH_MAX);
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 当日访客哈希。加盐（用读接口口令当盐）+ 带日期：
 * 同一个人第二天得到的是另一串值，所以跨天无法串联；而**当天**能数出「是不是同一个人」。
 */
async function visitorHash(ip: string, day: string, salt: string): Promise<string> {
  return (await sha256Hex(ip + '|' + day + '|' + salt)).slice(0, 12);
}

interface CfProps {
  country?: string;
  city?: string;
}

/** 204 空响应。只在确实有 Origin 时才回 CORS 头 —— 空字符串会写出一个非法的 Allow-Origin。 */
function noContent(origin: string | null): Response {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (origin) Object.assign(headers, corsHeaders(origin));
  return new Response(null, { status: 204, headers });
}

function clientIp(req: Request): string {
  const direct = req.headers.get('cf-connecting-ip');
  if (direct) return direct;
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return 'unknown';
}

async function readBucket(kv: KVLike, day: string): Promise<DayBucket> {
  const raw = await kv.get(dayKey(day));
  if (!raw) return emptyBucket();
  try {
    const parsed = JSON.parse(raw) as Partial<DayBucket>;
    return {
      n: typeof parsed.n === 'number' ? parsed.n : 0,
      drop: typeof parsed.drop === 'number' ? parsed.drop : 0,
      recs: Array.isArray(parsed.recs) ? (parsed.recs as VisitRecord[]) : [],
    };
  } catch {
    // 账本坏了不能连累页面：当成空桶继续写，坏数据被这一条覆盖掉。
    return emptyBucket();
  }
}

/**
 * POST /api/visit —— 页面打点。
 * 请求体是 `text/plain` 的 JSON：`sendBeacon` 不支持预检，`application/json` 会先发 OPTIONS 再被丢，
 * 所以客户端必须用 CORS 安全清单里的 text/plain，服务端这边照常 JSON.parse。
 */
export async function handleVisitPost(
  req: Request,
  env: VisitsEnv,
  now: number,
  origin: string | null,
): Promise<Response> {
  const kv = env.RATE_KV;
  if (!kv) return jsonResponse({ error: { code: 'config-missing-kv', message: '没有绑定 RATE_KV。' } }, 503, origin);

  const text = await req.text().catch(() => '');
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = null;
  }
  if (!body || typeof body !== 'object') {
    return jsonResponse({ error: { code: 'bad-request', message: '请求体必须是 JSON。' } }, 400, origin);
  }

  const path = cleanPath(typeof body.p === 'string' ? body.p : '');
  if (!path.startsWith('/')) {
    return jsonResponse({ error: { code: 'bad-request', message: 'p 必须是站内路径。' } }, 400, origin);
  }

  const day = utcDayOf(now);
  const salt = env.VISITS_TOKEN || 'expwall';
  const cf = (req as unknown as { cf?: CfProps }).cf || {};
  const ua = req.headers.get('user-agent') || '';
  const fam = uaFamily(ua);

  const record: VisitRecord = {
    t: now,
    p: path,
    r: referrerHost(typeof body.r === 'string' ? body.r : '', originHostOf(origin, req)),
    cc: (cf.country || '').slice(0, 8),
    ct: (cf.city || '').slice(0, 40),
    br: fam.br,
    os: fam.os,
    dv: fam.dv,
    u: await visitorHash(clientIp(req), day, salt),
  };

  const bucket = await readBucket(kv, day);
  bucket.n += 1;
  if (bucket.recs.length >= DAY_RECORD_LIMIT) bucket.drop += 1;
  else bucket.recs.push(record);
  await kv.put(dayKey(day), JSON.stringify(bucket));

  // 204：sendBeacon 不看响应体，少传几字节。
  return noContent(origin);
}

interface Counted {
  [key: string]: number;
}

function bump(map: Counted, key: string): void {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function topOf(map: Counted, n = 8): { key: string; n: number }[] {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, n: count }));
}

/**
 * GET /api/visits?token=…&days=N —— 读统计。
 * 鉴权是口令而不是来源白名单：命令行（没有 Origin 头）也要能读，而且这份数据的敏感度也就到「口令」这一级。
 */
export async function handleVisitsGet(
  req: Request,
  env: VisitsEnv,
  now: number,
  origin: string | null,
): Promise<Response> {
  const kv = env.RATE_KV;
  if (!kv) return jsonResponse({ error: { code: 'config-missing-kv', message: '没有绑定 RATE_KV。' } }, 503, origin);
  if (!env.VISITS_TOKEN) {
    return jsonResponse(
      { error: { code: 'config-missing-token', message: '服务端没有配置 VISITS_TOKEN，读接口按 fail-closed 拒绝。' } },
      503,
      origin,
    );
  }

  const url = new URL(req.url);
  const token = url.searchParams.get('token') || '';
  if (token !== env.VISITS_TOKEN) {
    return jsonResponse({ error: { code: 'unauthorized', message: 'token 不对。' } }, 401, origin);
  }

  const wantDays = Math.max(1, Math.min(30, Number(url.searchParams.get('days') || 7) || 7));
  const today = utcDayOf(now);

  let totalPv = 0;
  const totalVisitors = new Set<string>();
  const days: unknown[] = [];

  for (let i = 0; i < wantDays; i += 1) {
    const day = shiftDay(today, -i);
    const bucket = await readBucket(kv, day);
    if (bucket.n === 0) continue;

    const visitors = new Set<string>();
    const pages: Counted = {};
    const refs: Counted = {};
    const countries: Counted = {};
    const browsers: Counted = {};
    const devices: Counted = {};

    for (const rec of bucket.recs) {
      visitors.add(rec.u);
      totalVisitors.add(day + ':' + rec.u);
      bump(pages, rec.p);
      bump(refs, rec.r || '(direct)');
      bump(countries, rec.cc || '(unknown)');
      bump(browsers, rec.br);
      bump(devices, rec.dv);
    }

    totalPv += bucket.n;
    days.push({
      day,
      pv: bucket.n,
      uv: visitors.size,
      // 明细只留了 DAY_RECORD_LIMIT 条，超出部分只进了 pv
      sampled: bucket.recs.length,
      dropped: bucket.drop,
      topPages: topOf(pages),
      topRefs: topOf(refs),
      topCountries: topOf(countries),
      browsers: topOf(browsers),
      devices: topOf(devices),
      // 最近 20 条原始记录：这才是「谁在什么时候看了什么」能落到的粒度
      recent: bucket.recs.slice(-20).reverse().map((rec) => ({
        at: new Date(rec.t).toISOString(),
        path: rec.p,
        from: rec.r || '(direct)',
        where: [rec.cc, rec.ct].filter(Boolean).join(' / ') || '(unknown)',
        browser: rec.br,
        os: rec.os,
        device: rec.dv,
      })),
    });
  }

  return jsonResponse(
    {
      ok: true,
      generatedAt: new Date(now).toISOString(),
      range: { days: wantDays, until: today },
      totals: { pv: totalPv, visitors: totalVisitors.size },
      days,
      note:
        'pv 是准的（每次浏览都计入）；uv 与各项分布只按「当天的明细」统计，明细上限 ' +
        DAY_RECORD_LIMIT +
        ' 条/天，所以访问量极大的日子这两项会偏小（响应里的 dropped 就是被省略的条数）。不存 IP，uv 靠当日不可逆哈希去重，跨天不可串联。',
    },
    200,
    origin,
  );
}

/** 路由分发。放在 index.ts 的来源闸门之前：GET 用口令鉴权，命令行没有 Origin 头。 */
export async function routeVisits(
  req: Request,
  env: VisitsEnv,
  now: number,
  origin: string | null,
  allowed: string[],
): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === '/api/visits' && req.method === 'GET') {
    return handleVisitsGet(req, env, now, origin);
  }

  if (url.pathname === '/api/visit') {
    if (req.method === 'OPTIONS') {
      return noContent(origin);
    }
    if (req.method === 'POST') {
      // 写接口沿用站点那套 fail-closed 的来源白名单：浏览器 POST 一定带 Origin。
      if (!originAllowed(origin, allowed)) {
        return jsonResponse(
          { error: { code: 'origin-not-allowed', message: '只允许白名单来源打点：' + allowed.join(', ') } },
          403,
          null,
        );
      }
      return handleVisitPost(req, env, now, origin);
    }
  }

  return jsonResponse({ error: { code: 'not-found', message: '可用：POST /api/visit · GET /api/visits' } }, 404, origin);
}
