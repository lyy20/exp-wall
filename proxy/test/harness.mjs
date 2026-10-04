// exp-wall 代理验收：直接跑 src/index.ts 这份「真 Worker 代码」（Node 24 原生剥离类型即可 import .ts），
// 配一个假上游 + 内存 KV，把限流/预算/校验/CORS/SSE 透传逐条打出来。
// 用法：
//   node test/harness.mjs test            跑断言，退出码 0/1
//   node test/harness.mjs serve 8822      当本地代理用（前端联调用，上游仍是假上游）

import http from 'node:http';

const MODE = process.argv[2] || 'test';
// test 与 serve 用不同的默认端口：serve（浏览器联调）常驻 8822，若 test 也从 8822 起，
// 两个进程会抢端口（Windows 上还可能是静默的 SO_REUSEADDR 双绑，请求随机落到其中一个）。
const PORT = Number(process.argv[3] || (MODE === 'serve' ? 8822 : 8801));
let upstreamPort = 0;
const ORIGIN = 'https://lyy20.github.io';

let captured = [];

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeUpstream() {
  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const url = req.url || '';
    if (url.indexOf('/chat/completions') >= 0) {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { parsed = null; }
      captured.push(parsed);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const pieces = ['（本地假上游）', '收到 ', String(parsed && parsed.messages ? parsed.messages.length : 0), ' 条消息；',
        'temperature=', String(parsed ? parsed.temperature : '?'), ' max_tokens=', String(parsed ? parsed.max_tokens : '?'),
        ' stream_options=', JSON.stringify(parsed ? parsed.stream_options : null), '。',
        '这是验收用的假上游，生产环境由 DeepSeek 真实返回。'];
      for (const p of pieces) {
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: p } }] }) + '\n\n');
        await sleep(60);
      }
      res.write('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 34 } }) + '\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    if (url.indexOf('/embeddings') >= 0) {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { parsed = null; }
      const n = parsed && Array.isArray(parsed.input) ? parsed.input.length : 1;
      const data = [];
      for (let i = 0; i < n; i += 1) {
        const vec = [];
        // 1024 维：与 bge-m3 一致，前端 RAG 的相似度路径要求维度对齐（embed_dim=1024）
        const dim = url.indexOf('/embeddings') >= 0 ? 1024 : 8;
        for (let d = 0; d < dim; d += 1) vec.push(Math.sin(i + 1) * 0.5 + Math.cos(d * 0.01) * 0.5);
        data.push({ index: i, embedding: vec });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: parsed ? parsed.model : '?', data }));
      return;
    }
    if (url.indexOf('/rerank') >= 0) {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { parsed = null; }
      const docs = parsed && Array.isArray(parsed.documents) ? parsed.documents : [];
      const results = docs.map((d, i) => ({ index: i, relevance_score: 1 - i * 0.1 }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: parsed ? parsed.model : '?', results }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'fake upstream has no route ' + url }));
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      upstreamPort = server.address().port;
      resolve(server);
    });
  });
}

function kvShim() {
  const map = new Map();
  const shim = {
    _map: map,
    // 免费档 KV 每天只有 1000 次写，所以「一次提问写几个键」是要被断言的产品指标，不是实现细节。
    _puts: 0,
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async put(key, value) { shim._puts += 1; map.set(key, value); },
  };
  return shim;
}

/**
 * 假 Workers AI 绑定：形状照 Cloudflare 的真返回抄。
 * bge-m3 → { data: number[][] }；bge-reranker → { response: [{ id, score }] }。
 * 记录每次调用，用来断言「确实走了兜底」而不是「碰巧没报错」。
 */
function fakeAi() {
  const calls = [];
  return {
    _calls: calls,
    async run(model, inputs) {
      calls.push({ model, inputs });
      if (model === '@cf/baai/bge-m3') {
        const texts = (inputs && inputs.text) || [];
        return { shape: [texts.length, 1024], data: texts.map((t) => Array.from({ length: 1024 }, (_, d) => Math.sin(t.length + d * 0.01))) };
      }
      const contexts = (inputs && inputs.contexts) || [];
      return { response: contexts.map((c, i) => ({ id: i, score: 1 - i * 0.1 })) };
    },
  };
}

/** 永远回 401 的假上游：模拟「SiliconFlow key 无效」这个线上真实故障（只有 embeddings/rerank 会打它）。 */
function unauthorizedUpstream() {
  const server = http.createServer(async (req, res) => {
    await readBody(req);
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 30014, data: null, message: 'Token is invalid.' }));
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function adapter(worker, env, port, control) {
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(Promise.resolve(p)); } };
  const server = http.createServer(async (req, res) => {
    // /__test/* 是适配器层的测试控制面，不是 Worker 的路由（生产代码里没有它）。
    // serve 模式靠它在每次浏览器验收前把内存 KV 清零，否则计数会跨轮累加，
    // 「刚好第 4 次被拒」这类断言就会因为上一轮的残留而失败。
    if (control && String(req.url || '').indexOf('/__test/') === 0) {
      const out = control(String(req.url || ''), req.method || 'GET') || {};
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(out));
      return;
    }
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(',') : v;
    const method = req.method || 'GET';
    const bodyBuf = method === 'POST' || method === 'PUT' ? Buffer.from(await readBody(req), 'utf-8') : undefined;
    const request = new Request('http://127.0.0.1:' + port + (req.url || '/'), { method, headers, body: bodyBuf });
    let response;
    try {
      response = await worker.fetch(request, env, ctx);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('worker threw: ' + String(err && err.stack ? err.stack : err));
      return;
    }
    const outHeaders = {};
    response.headers.forEach((v, k) => { outHeaders[k] = v; });
    res.writeHead(response.status, outHeaders);
    if (!response.body) { res.end(); return; }
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
    await Promise.all(pending.splice(0));
  });
  return new Promise((resolve, reject) => {
    // 关键：用传入的 port。Windows 的 SO_REUSEADDR 允许两个 socket 绑同一端口，
    // 绑错了不会报错，只会把请求送给另一个服务（这里曾把 /status 送到假上游）。
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function makeEnv(overrides) {
  const base = {
    RATE_KV: kvShim(),
    DEEPSEEK_API_KEY: 'sk-test-not-real',
    ALLOWED_ORIGINS: ORIGIN,
    UPSTREAM_BASE: 'http://127.0.0.1:' + upstreamPort,
  };
  return Object.assign(base, overrides || {});
}

let portCursor = PORT;
let curPort = PORT;

async function start(overrides) {
  const mod = await import('../src/index.ts');
  const env = makeEnv(overrides);
  // 每组用独立端口：undici 的 fetch 按 origin 复用 keep-alive 连接，
  // 而 Node 19+ 的 server.close() 会掐掉空闲连接，复用同一端口会拿到 ECONNRESET。
  curPort = portCursor;
  portCursor += 1;
  const server = await adapter(mod.default, env, curPort);
  return { env, server, port: curPort, close: () => new Promise((r) => server.close(r)) };
}

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('  [ok  ] ' + name); }
  else { fail += 1; console.log('  [FAIL] ' + name + (extra ? ' -> ' + extra : '')); }
}

async function post(path, body, opts) {
  const o = opts || {};
  const res = await fetch('http://127.0.0.1:' + curPort + path, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', Connection: 'close', Origin: o.origin === undefined ? ORIGIN : o.origin, 'CF-Connecting-IP': o.ip || '203.0.113.7' }, o.headers || {}),
    body: JSON.stringify(body),
  });
  return res;
}

async function getStatus(opts) {
  const o = opts || {};
  const res = await fetch('http://127.0.0.1:' + curPort + '/api/llm/status', {
    headers: { Connection: 'close', Origin: o.origin === undefined ? ORIGIN : o.origin, 'CF-Connecting-IP': o.ip || '203.0.113.7' },
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json, headers: res.headers };
}

async function readSseWithTiming(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let text = '';
  const arrivals = [];
  const t0 = Date.now();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    arrivals.push(Date.now() - t0);
    text += decoder.decode(value, { stream: true });
  }
  return { text, arrivals, totalMs: Date.now() - t0 };
}

async function runTests() {
  const upstream = await fakeUpstream();
  const chatBody = { model: 'deepseek-chat', messages: [{ role: 'user', content: '你好，介绍一下你自己' }], temperature: 0.2, max_tokens: 512 };

  console.log('== 1. CORS 与预检');
  {
    const ctx = await start();
    const pre = await fetch('http://127.0.0.1:' + curPort + '/api/llm/chat', { method: 'OPTIONS', headers: { Connection: 'close', Origin: ORIGIN } });
    check('允许来源的 OPTIONS 返回 204 + ACAO', pre.status === 204 && pre.headers.get('access-control-allow-origin') === ORIGIN, String(pre.status) + ' ' + String(pre.headers.get('access-control-allow-origin')));
    const evil = await post('/api/llm/chat', chatBody, { origin: 'https://evil.example' });
    check('非白名单来源被 403 拒绝', evil.status === 403, String(evil.status));
    const local = await getStatus({ origin: 'http://127.0.0.1:8944' });
    check('本机开发端口被放行', local.status === 200, String(local.status));
    await ctx.close();
  }

  console.log('== 2. /status 与配置缺失时 fail closed');
  {
    const ctx = await start();
    const st = await getStatus();
    check('status ok + caps 只有 chat', st.status === 200 && st.json && st.json.ok === true && JSON.stringify(st.json.caps) === '["chat"]', JSON.stringify(st.json && st.json.caps));
    check('status 带限流与剩余额度', st.json && st.json.remaining && st.json.remaining.minute === 3 && st.json.limits.perMinute === 3, JSON.stringify(st.json && st.json.remaining));
    check('status 带模型白名单', st.json && st.json.models.indexOf('deepseek-chat') >= 0, JSON.stringify(st.json && st.json.models));
    await ctx.close();
  }
  {
    const ctx = await start({ RATE_KV: undefined });
    const st = await getStatus();
    const ch = await post('/api/llm/chat', chatBody);
    check('未绑 KV：status 503 config-missing-kv', st.status === 503 && st.json && st.json.error.code === 'config-missing-kv', String(st.status));
    check('未绑 KV：chat 503（fail closed）', ch.status === 503, String(ch.status));
    await ctx.close();
  }
  {
    const ctx = await start({ DEEPSEEK_API_KEY: undefined });
    const st = await getStatus();
    check('未配 key：status 503 config-missing-key', st.status === 503 && st.json && st.json.error.code === 'config-missing-key', String(st.status));
    await ctx.close();
  }
  {
    const ctx = await start();
    const em = await post('/api/llm/embeddings', { model: 'BAAI/bge-m3', input: ['x'] });
    const rr = await post('/api/llm/rerank', { model: 'BAAI/bge-reranker-v2-m3', query: 'q', documents: ['d'] });
    check('未配 SILICONFLOW：embedding 503 且说明清楚', em.status === 503, String(em.status));
    check('未配 SILICONFLOW：rerank 503', rr.status === 503, String(rr.status));
    await ctx.close();
  }

  console.log('== 3. 参数校验（模型白名单 / 长度 / 条数）');
  {
    const ctx = await start();
    const badModel = await post('/api/llm/chat', Object.assign({}, chatBody, { model: 'gpt-4o' }));
    check('未知模型 400', badModel.status === 400, String(badModel.status));
    const many = [];
    for (let i = 0; i < 13; i += 1) many.push({ role: 'user', content: 'hi' });
    const tooMany = await post('/api/llm/chat', Object.assign({}, chatBody, { messages: many }));
    check('消息条数超限 400', tooMany.status === 400, String(tooMany.status));
    const longMsg = await post('/api/llm/chat', Object.assign({}, chatBody, { messages: [{ role: 'user', content: 'x'.repeat(7000) }] }));
    check('单条超 6000 字符 400', longMsg.status === 400, String(longMsg.status));
    const badRole = await post('/api/llm/chat', Object.assign({}, chatBody, { messages: [{ role: 'tool', content: 'hi' }] }));
    check('非法 role 400', badRole.status === 400, String(badRole.status));
    await ctx.close();
  }

  console.log('== 4. 真实流式透传 + 服务端覆盖参数');
  {
    const ctx = await start();
    captured = [];
    const res = await post('/api/llm/chat', Object.assign({}, chatBody, { temperature: 5, max_tokens: 5000 }));
    const sse = await readSseWithTiming(res);
    check('200 + text/event-stream', res.status === 200 && String(res.headers.get('content-type')).indexOf('text/event-stream') === 0, String(res.status) + ' ' + String(res.headers.get('content-type')));
    check('拿到上游内容', sse.text.indexOf('本地假上游') >= 0, sse.text.slice(0, 80));
    check('分多次到达（无缓冲，真逐字）', sse.arrivals.length >= 4 && sse.arrivals[0] < sse.totalMs, JSON.stringify(sse.arrivals));
    check('temperature 被夹到 [0,1]', captured[0] && captured[0].temperature === 1, JSON.stringify(captured[0] && captured[0].temperature));
    check('max_tokens 被夹到 512', captured[0] && captured[0].max_tokens === 512, JSON.stringify(captured[0] && captured[0].max_tokens));
    check('服务端强制 stream + include_usage', captured[0] && captured[0].stream === true && captured[0].stream_options && captured[0].stream_options.include_usage === true, JSON.stringify(captured[0] && captured[0].stream_options));
    check('响应头带剩余额度', res.headers.get('x-proxy-remaining-minute') === '2', String(res.headers.get('x-proxy-remaining-minute')));
    // 浏览器验收（ui-accept.mjs）抓出来的真缺陷：跨源响应里 JS 只能读 Access-Control-Expose-Headers 列出的头。
    // 少了这一行，前端 applyRemaining 恒读不到 null，页面上的「站内额度」就永远停在进页面时的快照。
    check(
      'CORS 把额度响应头 expose 出去（跨源时浏览器才读得到）',
      String(res.headers.get('access-control-expose-headers')).indexOf('X-Proxy-Remaining-Minute') >= 0 &&
        String(res.headers.get('access-control-expose-headers')).indexOf('X-Proxy-Remaining-Day') >= 0,
      String(res.headers.get('access-control-expose-headers')),
    );
    await sleep(50);
    const st = await getStatus();
    check('token 用量已记账', st.json && st.json.usage && st.json.usage.calls >= 1 && st.json.usage.completionTokens === 34, JSON.stringify(st.json && st.json.usage));
    await ctx.close();
  }

  console.log('== 5. 每 IP 每分钟 3 次：第 4 次 429');
  {
    const ctx = await start();
    const codes = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await post('/api/llm/chat', chatBody, { ip: '198.51.100.9' });
      codes.push(res.status);
      if (res.status === 200) await res.text();
      else {
        const j = await res.json();
        if (i === 3) check('第 4 次报错码是 per-minute 且带 retryAfterMs', j.error.code === 'per-minute' && typeof j.error.retryAfterMs === 'number' && j.error.retryAfterMs > 0, JSON.stringify(j.error));
      }
    }
    check('前三放行第四拒绝', JSON.stringify(codes) === '[200,200,200,429]', JSON.stringify(codes));
    const other = await post('/api/llm/chat', chatBody, { ip: '198.51.100.10' });
    check('换一个 IP 不受影响（限额是按 IP 的）', other.status === 200, String(other.status));
    if (other.body) await other.text();
    await ctx.close();
  }

  console.log('== 6. 全局日预算闸门');
  {
    const ctx = await start({ LIMITS_JSON: JSON.stringify({ perMinute: 50, perDay: 50, globalPerDay: 2 }) });
    const a = await post('/api/llm/chat', chatBody, { ip: '192.0.2.1' });
    const b = await post('/api/llm/chat', chatBody, { ip: '192.0.2.2' });
    const c = await post('/api/llm/chat', chatBody, { ip: '192.0.2.3' });
    const j = await c.json();
    check('前两次放行（不同 IP）', a.status === 200 && b.status === 200, String(a.status) + '/' + String(b.status));
    check('第三次撞全局预算 429 code=global-day', c.status === 429 && j.error.code === 'global-day', String(c.status) + ' ' + JSON.stringify(j.error && j.error.code));
    if (a.body) await a.text();
    if (b.body) await b.text();
    await ctx.close();
  }

  console.log('== 7. 每 IP 每日 30 次');
  {
    const ctx = await start({ LIMITS_JSON: JSON.stringify({ perMinute: 100, perDay: 3, globalPerDay: 100 }) });
    const codes = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await post('/api/llm/chat', chatBody, { ip: '192.0.2.50' });
      codes.push(res.status);
      if (res.body) await res.text();
    }
    check('每 IP 日限额生效（3 次后 429）', JSON.stringify(codes) === '[200,200,200,429]', JSON.stringify(codes));
    await ctx.close();
  }

  console.log('== 8. embedding / rerank 走代理（配了 SILICONFLOW key 时）');
  {
    const ctx = await start({ SILICONFLOW_API_KEY: 'sk-test-sf', SILICONFLOW_BASE: 'http://127.0.0.1:' + upstreamPort });
    const st = await getStatus();
    check('caps 变成 chat/embed/rerank', JSON.stringify(st.json.caps) === '["chat","embed","rerank"]', JSON.stringify(st.json.caps));
    const em = await post('/api/llm/embeddings', { model: 'BAAI/bge-m3', input: ['a', 'b'] });
    const emj = await em.json();
    check('embedding 透传成功', em.status === 200 && emj.data && emj.data.length === 2, String(em.status));
    const rr = await post('/api/llm/rerank', { model: 'BAAI/bge-reranker-v2-m3', query: 'q', documents: ['d1', 'd2'], top_n: 2 });
    const rrj = await rr.json();
    check('rerank 透传成功', rr.status === 200 && rrj.results && rrj.results.length === 2, String(rr.status));
    const bad = await post('/api/llm/embeddings', { model: 'text-embedding-v3', input: ['a'] });
    check('embedding 模型白名单生效', bad.status === 400, String(bad.status));
    check('向量维度是 1024（bge-m3，前端相似度路径要对齐）', emj.data && emj.data[0] && emj.data[0].embedding.length === 1024, String(emj.data && emj.data[0] && emj.data[0].embedding.length));
    await ctx.close();
  }

  console.log('== 8b. 额度按通道分账：embedding/rerank 不吃 chat 的那份额度');
  {
    const ctx = await start({ SILICONFLOW_API_KEY: 'sk-test-sf', SILICONFLOW_BASE: 'http://127.0.0.1:' + upstreamPort });
    const q = { model: 'BAAI/bge-m3', input: ['问题'] };
    const em = await post('/api/llm/embeddings', q);
    await em.text();
    const rr = await post('/api/llm/rerank', { model: 'BAAI/bge-reranker-v2-m3', query: 'q', documents: ['d1'], top_n: 1 });
    await rr.text();
    check('embedding 响应头报的是 chat 那份剩余额度', em.headers.get('x-proxy-remaining-minute') === '3', String(em.headers.get('x-proxy-remaining-minute')));
    const st = await getStatus();
    check('只发 embedding/rerank 时 chat 额度未被动用', st.json.counters.minute === 0 && st.json.remaining.minute === 3, JSON.stringify(st.json.counters));

    // 一次真实提问 = embedding + rerank + chat；连问 3 次都应该成功，第 4 次提问的 chat 才 429
    const codes = [];
    for (let i = 0; i < 3; i += 1) {
      const a = await post('/api/llm/embeddings', q);
      codes.push(a.status);
      await a.text();
      const b = await post('/api/llm/rerank', { model: 'BAAI/bge-reranker-v2-m3', query: 'q', documents: ['d1'], top_n: 1 });
      codes.push(b.status);
      await b.text();
      const c = await post('/api/llm/chat', chatBody);
      codes.push(c.status);
      await c.text();
    }
    check('3 次完整提问（各 3 个请求）全部放行', JSON.stringify(codes) === JSON.stringify([200, 200, 200, 200, 200, 200, 200, 200, 200]), JSON.stringify(codes));
    const st2 = await getStatus();
    check('chat 额度记了 3 次（embedding/rerank 记在 aux 那份）', st2.json.counters.minute === 3 && st2.json.counters.day === 3, JSON.stringify(st2.json.counters));
    const fourth = await post('/api/llm/chat', chatBody);
    const fj = await fourth.json();
    check('第 4 次提问的 chat 才 429（per-minute）', fourth.status === 429 && fj.error.code === 'per-minute', String(fourth.status) + ' ' + JSON.stringify(fj.error && fj.error.code));
    await ctx.close();
  }

  console.log('== 8c. Workers AI 兜底（没有 SiliconFlow key 也能真算向量 / 真精排）');
  {
    const ai = fakeAi();
    const ctx = await start({ AI: ai });
    const st = await getStatus();
    check('status：没有 SiliconFlow key 也报 embed/rerank 能力', st.json && JSON.stringify(st.json.caps) === '["chat","embed","rerank"]', JSON.stringify(st.json && st.json.caps));
    check('status：模型清单切成 Workers AI 的 @cf 模型', st.json && JSON.stringify(st.json.embedModels) === '["@cf/baai/bge-m3"]' && JSON.stringify(st.json.rerankModels) === '["@cf/baai/bge-reranker-base"]', JSON.stringify(st.json && st.json.embedModels) + ' / ' + JSON.stringify(st.json && st.json.rerankModels));
    const em = await post('/api/llm/embeddings', { model: '@cf/baai/bge-m3', input: ['甲', '乙'] });
    const emJson = await em.json().catch(() => null);
    check('兜底 embedding 200 且是 1024 维两行', em.status === 200 && emJson && emJson.data.length === 2 && emJson.data[0].embedding.length === 1024, String(em.status) + ' ' + JSON.stringify(emJson && emJson.data && emJson.data[0].embedding.length));
    check('兜底 embedding 响应体回真实模型名（供前端如实显示）', emJson && emJson.model === '@cf/baai/bge-m3', String(emJson && emJson.model));
    const rr = await post('/api/llm/rerank', { model: '@cf/baai/bge-reranker-base', query: 'q', documents: ['a', 'b', 'c'], top_n: 2 });
    const rrJson = await rr.json().catch(() => null);
    check('兜底 rerank 200 且按分降序取 top_n', rr.status === 200 && rrJson && rrJson.results.length === 2 && rrJson.results[0].relevance_score >= rrJson.results[1].relevance_score, String(rr.status) + ' ' + JSON.stringify(rrJson && rrJson.results));
    check('兜底 rerank 响应体回真实模型名', rrJson && rrJson.model === '@cf/baai/bge-reranker-base', String(rrJson && rrJson.model));
    check('确实调用了 Workers AI 绑定', ai._calls.length === 2 && ai._calls[0].model === '@cf/baai/bge-m3' && ai._calls[1].model === '@cf/baai/bge-reranker-base', JSON.stringify(ai._calls.map((c) => c.model)));
    await ctx.close();
  }

  console.log('== 8d. SiliconFlow key 无效（上游 401）→ 自动降级到 Workers AI；没有 AI 则如实报错');
  {
    const bad = await unauthorizedUpstream();
    const ai = fakeAi();
    const ctx = await start({ AI: ai, SILICONFLOW_API_KEY: 'sk-bad', SILICONFLOW_BASE: 'http://127.0.0.1:' + bad.port });
    const em = await post('/api/llm/embeddings', { model: 'BAAI/bge-m3', input: ['甲'] });
    const emJson = await em.json().catch(() => null);
    check('SiliconFlow 401 → embedding 走兜底 200', em.status === 200 && emJson && emJson.model === '@cf/baai/bge-m3', String(em.status) + ' ' + String(emJson && emJson.model));
    const rr = await post('/api/llm/rerank', { model: 'BAAI/bge-reranker-v2-m3', query: 'q', documents: ['a', 'b'], top_n: 2 });
    const rrJson = await rr.json().catch(() => null);
    check('SiliconFlow 401 → rerank 走兜底 200', rr.status === 200 && rrJson && rrJson.model === '@cf/baai/bge-reranker-base', String(rr.status) + ' ' + String(rrJson && rrJson.model));
    await ctx.close();

    const ctx2 = await start({ SILICONFLOW_API_KEY: 'sk-bad', SILICONFLOW_BASE: 'http://127.0.0.1:' + bad.port });
    const em2 = await post('/api/llm/embeddings', { model: 'BAAI/bge-m3', input: ['甲'] });
    const em2Json = await em2.json().catch(() => null);
    check('没有 AI 绑定时如实 502 upstream-401（不假装成功）', em2.status === 502 && em2Json && em2Json.error.code === 'upstream-401', String(em2.status) + ' ' + String(em2Json && em2Json.error && em2Json.error.code));
    await ctx2.close();
    await new Promise((r) => bad.server.close(r));
  }

  console.log('== 8e. KV 故障不再裸 500，而是 503 proxy-degraded');
  {
    const brokenKv = {
      async get() { throw new Error('KV read failed'); },
      async put() { throw new Error('KV write failed: daily limit exceeded'); },
    };
    const ctx = await start({ RATE_KV: brokenKv });
    const ch = await post('/api/llm/chat', chatBody);
    const j = await ch.json().catch(() => null);
    check('KV 写失败 → 503 proxy-degraded（不是 500）', ch.status === 503 && j && j.error.code === 'proxy-degraded', String(ch.status) + ' ' + String(j && j.error && j.error.code));
    check('错误信息是人话且带原始错误', !!(j && j.error.message && j.error.message.indexOf('proxy-degraded') < 0 && j.error.message.indexOf('KV') >= 0), String(j && j.error && j.error.message).slice(0, 120));
    await ctx.close();
  }

  console.log('== 8f. KV 写次数：一次成功 chat 只写 2 个键（1000 写/天 不再压低全局闸门）');
  {
    const ctx = await start();
    ctx.env.RATE_KV._puts = 0;
    const res = await post('/api/llm/chat', chatBody);
    await readSseWithTiming(res);
    await sleep(150); // 等 ctx.waitUntil 里的记账落地（适配器在响应结束后才结算）
    const st = await getStatus();
    check('一次成功 chat 恰好 2 次 put（额度 1 + 记账 1）', ctx.env.RATE_KV._puts === 2, String(ctx.env.RATE_KV._puts));
    check('只存在一个日账本键（L:c: 前缀）', Array.from(ctx.env.RATE_KV._map.keys()).filter((k) => k.indexOf('L:c:') === 0).length === 1, JSON.stringify(Array.from(ctx.env.RATE_KV._map.keys())));
    check('当日计数与 usage 都从账本读出来', st.json && st.json.counters.day === 1 && st.json.counters.global === 1 && st.json.usage.calls === 1 && st.json.usage.completionTokens === 34, JSON.stringify({ c: st.json && st.json.counters, u: st.json && st.json.usage }));
    await ctx.close();
  }

  console.log('== 9. 未知路由');
  {
    const ctx = await start();
    const res = await fetch('http://127.0.0.1:' + curPort + '/api/llm/nope', { headers: { Connection: 'close', Origin: ORIGIN } });
    check('未知路由 404 并列出可用路由', res.status === 404, String(res.status));
    await ctx.close();
  }

  console.log('');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  upstream.close();
  process.exit(fail ? 1 : 0);
}

async function runServe() {
  const upstream = await fakeUpstream();
  const mod = await import('../src/index.ts');
  const env = makeEnv({ SILICONFLOW_API_KEY: 'sk-test-sf', SILICONFLOW_BASE: 'http://127.0.0.1:' + upstreamPort });
  await adapter(mod.default, env, PORT, (url) => {
    if (url.indexOf('/__test/reset') === 0) {
      // 计数与 usage 记账都落在同一份内存 KV 里，清掉就是干净起点
      env.RATE_KV._map.clear();
      return { ok: true, reset: true, keys: env.RATE_KV._map.size };
    }
    if (url.indexOf('/__test/state') === 0) {
      return { ok: true, entries: Array.from(env.RATE_KV._map.entries()) };
    }
    return { ok: false, message: 'unknown control route ' + url };
  });
  console.log('[mock-proxy] listening on http://127.0.0.1:' + PORT + '（假上游 :' + upstreamPort + '，内存 KV）');
  console.log('[mock-proxy] 这是本地验收通道，不是生产代理；生产部署见 proxy/README.md');
  void upstream;
}

if (MODE === 'serve') await runServe();
else await runTests();
