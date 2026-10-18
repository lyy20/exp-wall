// 访问记录（/api/visit · /api/visits）验收：直接跑真 Worker 代码 + 内存 KV，不起网络。
//
// 为什么必须测这几条而不是「看着对」：这套东西的失效方式全是静默的 ——
//   · 打点被来源白名单挡掉 → 页面不报错，统计永远是 0；
//   · pv 与明细混在一起算 → 超过明细上限的日子，pv 会跟着变小，看起来「那天没人来」；
//   · 读接口忘了鉴权 → 数据泄露，而且没有任何报错。
//
// 用法：
//   node test/visits.test.mjs            跑断言，退出码 0/1
//   node test/visits.test.mjs serve 8899 起一个本地 HTTP 壳（给 scripts/visits.mjs 联调用）

import http from 'node:http';
import worker from '../src/index.ts';
import { DAY_RECORD_LIMIT } from '../src/visits.ts';

const MODE = process.argv[2] || 'test';
const PORT = Number(process.argv[3] || (MODE === 'serve' ? 8899 : 8898));
const ORIGIN = 'https://agent-lyy.top';
const TOKEN = 'test-token';

function kvShim() {
  const map = new Map();
  const shim = {
    _map: map,
    _puts: 0,
    _gets: 0,
    async get(key) {
      shim._gets += 1;
      return map.has(key) ? map.get(key) : null;
    },
    async put(key, value) {
      shim._puts += 1;
      map.set(key, value);
    },
  };
  return shim;
}

function makeEnv(over = {}) {
  return {
    RATE_KV: kvShim(),
    ALLOWED_ORIGINS: 'https://agent-lyy.top,https://lyy20.github.io',
    VISITS_TOKEN: TOKEN,
    ...over,
  };
}

function build(path, init) {
  return new Request('https://llm.agent-lyy.top' + path, init);
}

async function call(env, path, init) {
  return worker.fetch(build(path, init), env, { waitUntil() {} });
}

function post(env, body, { origin = ORIGIN, ip = '203.0.113.7', ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0', headers = {} } = {}) {
  const h = { 'Content-Type': 'text/plain;charset=UTF-8', 'user-agent': ua, 'cf-connecting-ip': ip, ...headers };
  if (origin !== null) h.origin = origin;
  return call(env, '/api/visit', {
    method: 'POST',
    headers: h,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra });
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond || extra === undefined ? '' : '   → ' + JSON.stringify(extra)));
}

async function runTests() {
  // ---- 写入口：来源白名单 ----
  {
    const env = makeEnv();
    const r = await post(env, { p: '/learn/' }, { origin: null });
    check('POST 不带 Origin 被拒 403', r.status === 403, r.status);
    check('  被拒时不写 KV', env.RATE_KV._puts === 0, env.RATE_KV._puts);
  }
  {
    const env = makeEnv();
    const r = await post(env, { p: '/learn/' }, { origin: 'https://evil.example' });
    check('POST 非白名单来源被拒 403', r.status === 403, r.status);
  }
  {
    const env = makeEnv();
    const r = await post(env, { p: '/learn/' });
    check('POST 白名单来源 + text/plain → 204', r.status === 204, r.status);
    check('  一次浏览只写 1 个键', env.RATE_KV._puts === 1, env.RATE_KV._puts);
    const keys = [...env.RATE_KV._map.keys()];
    check('  键名是 V:<YYYY-MM-DD>', keys.length === 1 && /^V:\d{4}-\d{2}-\d{2}$/.test(keys[0]), keys);
    const bucket = JSON.parse(env.RATE_KV._map.get(keys[0]));
    check('  桶里 n=1 且留了 1 条明细', bucket.n === 1 && bucket.recs.length === 1, bucket);
    check('  明细不含 IP 字段', !('ip' in bucket.recs[0]) && Object.keys(bucket.recs[0]).join(',').indexOf('ip') < 0, bucket.recs[0]);
    check('  UA 解析出 Chrome/Windows/desktop', bucket.recs[0].br === 'Chrome' && bucket.recs[0].os === 'Windows' && bucket.recs[0].dv === 'desktop', bucket.recs[0]);
  }

  // ---- 写入口：入参校验 ----
  {
    const env = makeEnv();
    const r = await post(env, 'not json at all');
    check('POST 非法 JSON → 400', r.status === 400, r.status);
  }
  {
    const env = makeEnv();
    const r = await post(env, { p: 'relative/path' });
    check('POST p 不是站内路径 → 400', r.status === 400, r.status);
  }
  {
    const env = makeEnv();
    const r = await post(env, { p: '/x?q=' + 'a'.repeat(1000) });
    check('POST 超长路径被截断但仍然接受', r.status === 204, r.status);
    const bucket = JSON.parse([...env.RATE_KV._map.values()][0]);
    check('  落库路径不含 query', bucket.recs[0].p === '/x', bucket.recs[0].p);
  }
  {
    const env = makeEnv({ RATE_KV: undefined });
    const r = await post(env, { p: '/learn/' });
    check('POST 没绑 KV → 503（fail-closed）', r.status === 503, r.status);
  }

  // ---- 读入口：鉴权 ----
  {
    const env = makeEnv();
    await post(env, { p: '/learn/' });
    const r1 = await call(env, '/api/visits', { method: 'GET' });
    check('GET 不带 token → 401', r1.status === 401, r1.status);
    const r2 = await call(env, '/api/visits?token=wrong', { method: 'GET' });
    check('GET token 错 → 401', r2.status === 401, r2.status);
    // 命令行（没有 Origin）也必须能读：这条正是「读接口不套来源闸门」的理由
    const r3 = await call(env, '/api/visits?token=' + TOKEN, { method: 'GET' });
    check('GET 正确 token、无 Origin → 200', r3.status === 200, r3.status);
  }
  {
    const env = makeEnv({ VISITS_TOKEN: undefined });
    const r = await call(env, '/api/visits?token=anything', { method: 'GET' });
    check('没配 VISITS_TOKEN → 503（不裸奔）', r.status === 503, r.status);
  }

  // ---- 读入口：聚合口径 ----
  {
    const env = makeEnv();
    await post(env, { p: '/learn/' });
    await post(env, { p: '/learn/projects/yyhelp/12-flywheel.html' });
    await post(env, { p: '/learn/' }, { ip: '198.51.100.9', ua: 'Mozilla/5.0 (iPhone) Safari/604.1' });

    const r = await call(env, '/api/visits?token=' + TOKEN + '&days=1', { method: 'GET' });
    const j = await r.json();
    check('pv = 3', j.totals.pv === 3, j.totals);
    check('uv = 2（两台机器）', j.totals.visitors === 2, j.totals);
    const d = j.days[0];
    check('day 里 pv=3 / uv=2', d.pv === 3 && d.uv === 2, { pv: d.pv, uv: d.uv });
    check('topPages 按次数排序', d.topPages[0].key === '/learn/' && d.topPages[0].n === 2, d.topPages);
    check('设备分布含 mobile 与 desktop', d.devices.length === 2, d.devices);
    check('默认来源记成 (direct)', d.topRefs[0].key === '(direct)', d.topRefs);
    check('recent 里带了时间/页面/地区/浏览器', d.recent[0] && d.recent[0].path && d.recent[0].browser, d.recent && d.recent[0]);
    check('响应里写明了 uv 的口径限制', typeof j.note === 'string' && j.note.indexOf('uv') >= 0, j.note);
  }

  // ---- 同站 referrer 不算来源 ----
  {
    const env = makeEnv();
    await post(env, { p: '/learn/kb/', r: 'https://agent-lyy.top/learn/' });
    await post(env, { p: '/learn/kb/', r: 'https://www.google.com/search?q=xxx' });
    const j = await (await call(env, '/api/visits?token=' + TOKEN + '&days=1', { method: 'GET' })).json();
    const keys = j.days[0].topRefs.map((x) => x.key);
    check('同站 referrer 归到 (direct)', keys.indexOf('(direct)') >= 0, keys);
    check('外部 referrer 只留主机名、不带 query', keys.indexOf('www.google.com') >= 0 && keys.indexOf('www.google.com/search?q=xxx') < 0, keys);
  }

  // ---- 明细上限：pv 不受影响，drop 会计数 ----
  {
    const env = makeEnv();
    const total = DAY_RECORD_LIMIT + 5;
    for (let i = 0; i < total; i += 1) {
      // 每条换一个 IP，避免 uv 去重把它们合成一个
      await post(env, { p: '/bulk/' }, { ip: '10.0.' + Math.floor(i / 250) + '.' + (i % 250) });
    }
    const j = await (await call(env, '/api/visits?token=' + TOKEN + '&days=1', { method: 'GET' })).json();
    const d = j.days[0];
    check('超过上限后 pv 仍然准确', d.pv === total, d.pv);
    check('明细只留 ' + DAY_RECORD_LIMIT + ' 条', d.sampled === DAY_RECORD_LIMIT, d.sampled);
    check('被省略的条数记在 dropped', d.dropped === 5, d.dropped);
    check('KV 里仍然只有 1 个键（不会按条爆键）', env.RATE_KV._map.size === 1, env.RATE_KV._map.size);
  }

  // ---- 没被碰坏的既有路由 ----
  {
    const env = makeEnv({ DEEPSEEK_API_KEY: 'sk-test' });
    const r = await call(env, '/api/llm/status', { method: 'GET', headers: { origin: ORIGIN } });
    check('既有路由 /api/llm/status 仍然工作', r.status === 200, r.status);
    const r2 = await call(env, '/api/llm/status', { method: 'GET', headers: { origin: 'https://evil.example' } });
    check('既有来源闸门仍然生效 403', r2.status === 403, r2.status);
    const r3 = await call(env, '/api/nope', { method: 'GET', headers: { origin: ORIGIN } });
    check('未知路由仍然 404', r3.status === 404, r3.status);
  }

  const failed = results.filter((x) => !x.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' 通过');
  if (failed.length) {
    console.log('失败项：' + failed.map((x) => x.name.trim()).join(' · '));
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// serve：起一个 HTTP 壳，把真 Worker 挂上去（给 D:\AI-Learning\scripts\visits.mjs 联调）
// ---------------------------------------------------------------------------
async function serve() {
  const env = makeEnv();
  const kv = env.RATE_KV;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
    const request = new Request('http://127.0.0.1:' + PORT + req.url, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    });
    try {
      const out = await worker.fetch(request, env, { waitUntil() {} });
      const text = await out.text();
      const outHeaders = {};
      out.headers.forEach((v, k) => (outHeaders[k] = v));
      res.writeHead(out.status, outHeaders);
      res.end(text);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

  // 先塞几条样例，否则读出来是空的、看不出格式对不对
  const day = new Date().toISOString().slice(0, 10);
  const seed = [
    { p: '/learn/', r: '', ip: '203.0.113.7', ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0' },
    { p: '/learn/projects/yyhelp/12-flywheel.html', r: 'https://www.google.com/search?q=data+flywheel', ip: '203.0.113.7', ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0' },
    { p: '/learn/kb/', r: '', ip: '198.51.100.9', ua: 'Mozilla/5.0 (iPhone) Safari/604.1' },
  ];
  for (const s of seed) await post(env, { p: s.p, r: s.r }, { ip: s.ip, ua: s.ua });

  console.log('[visits] 本地壳已启动：http://127.0.0.1:' + PORT);
  console.log('        读统计： node D:/AI-Learning/scripts/visits.mjs --base http://127.0.0.1:' + PORT + ' --token ' + TOKEN);
  console.log('        已预置 ' + seed.length + ' 条样例（' + day + '），KV 键：' + [...kv._map.keys()].join(', '));
}

if (MODE === 'serve') await serve();
else await runTests();
