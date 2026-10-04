// 浏览器点击级验收：模拟一个「没填 key 的访客」，在真页面（vite dev）上点「提问」，走站内代理真跑一遍。
//
// 前提（两个后台进程）：
//   1) node proxy/test/harness.mjs serve 8822   —— 本地 mock 代理：真 Worker 代码 + 假上游 + 内存 KV
//   2) npm run dev -- --port 5177               —— 真前端（多入口站点，/rag/ 是 RAG 页）
//
// 用法：node proxy/test/ui-accept.mjs
// 环境变量：ACCEPT_URL（默认 http://localhost:5177/rag/?proxy=http://127.0.0.1:8822）、CDP_PORT（默认 9333）、
//          ASK_TIMEOUT_MS（默认 20000）、TRACE=1（逐样本打印，排障用）
//
// 断言口径（P0–P4 的同一套标准：真点击、真断言、结论可复核）：
//   A 页面确实处于「无 key」状态，且徽标必须明写「站内代理」（不能拿回放冒充）
//   B 点一次「提问」→ 回答面板先清空再重新渲染，且文字逐个变长到达（证明没有缓冲）
//   C 回答内容来自上游，且服务端确实注入了 stream_options / 夹取了 max_tokens=512
//   D 站内额度从 3 掉到 2（页面显示 + 服务端 /status 双向复核）
//   E 连问 4 次：第 4 次被服务端 429 拒绝，页面出现「站内额度用完」+「请求过于频繁」+「填自己的 key」，徽标仍是「站内代理」
//   F 服务端计数停在第 3 次，且第 4 次页面上根本没有回答面板（额度必须真的被挡住，而不是前端自己提示）

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ACCEPT_URL = process.env.ACCEPT_URL || "http://localhost:5177/rag/?proxy=http://127.0.0.1:8822";
const STATUS_URL = process.env.STATUS_URL || "http://127.0.0.1:8822/api/llm/status";
const RESET_URL = process.env.RESET_URL || "http://127.0.0.1:8822/__test/reset";
const CDP_PORT = Number(process.env.CDP_PORT || 9333);
const ASK_TIMEOUT_MS = Number(process.env.ASK_TIMEOUT_MS || 20000);
const TRACE = process.env.TRACE === "1";
const QUESTION = "CTRIP-SAC 的安全距离区间是多少？";

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log("  [ok] " + name); }
  else { fail += 1; console.log("  [FAIL] " + name + (extra === undefined ? "" : "  -> " + String(extra))); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const cands = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  for (const p of cands) if (existsSync(p)) return p;
  throw new Error("找不到 Chrome/Edge，可用 CHROME_PATH 指定");
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.pageErrors = [];
    ws.addEventListener("message", (ev) => {
      let msg = null;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
        return;
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params && msg.params.exceptionDetails;
        this.pageErrors.push((d && d.text) || "unknown page error");
      }
      if (msg.method === "Runtime.consoleAPICalled" && msg.params && msg.params.type === "error") {
        this.pageErrors.push("console.error: " + (msg.params.args || []).map((a) => a.value).join(" "));
      }
    });
  }

  static async attach(port, timeoutMs) {
    const t0 = Date.now();
    for (;;) {
      try {
        // 注意：/json/version 给的是 **浏览器级** websocket，上面没有 Runtime/Page 域（会报 "wasn't found"）。
        // 要拿页面级目标，必须走 /json/list 里 type === "page" 的那一条。
        const res = await fetch("http://127.0.0.1:" + port + "/json/list");
        const targets = await res.json();
        const page =
          targets.filter((t) => t.type === "page" && String(t.url).indexOf("5177") >= 0)[0] ||
          targets.filter((t) => t.type === "page")[0];
        if (!page || !page.webSocketDebuggerUrl) throw new Error("还没有可用的页面目标");
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.addEventListener("open", resolve, { once: true });
          ws.addEventListener("error", () => reject(new Error("CDP websocket 连接失败")), { once: true });
        });
        return new Cdp(ws);
      } catch (err) {
        if (Date.now() - t0 > (timeoutMs || 25000)) throw err;
        await sleep(300);
      }
    }
  }

  send(method, params) {
    const id = (this.id += 1);
    const payload = JSON.stringify({ id, method, params: params || {} });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(payload);
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error("CDP 超时：" + method)); }
      }, 30000);
    });
  }

  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error("页面里执行失败：" + ((d.exception && d.exception.description) || d.text));
    }
    return r && r.result ? r.result.value : undefined;
  }

  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

// 页面内的取样助手：一次性装好，后面所有断言都通过它读真实 DOM。
// 答案面板用 p.dp-answer 这个稳定 class 定位（AskPanel 里加的），不再依赖流式光标 .dp-caret ——
// 光标只在 busy 期间存在，无法用来读「最终答案」，只能作为「当时确实在逐字」的旁证。
const HELPERS = [
  "window.__acc = {",
  "  caretSeen: false,",
  "  badges: function () { return Array.prototype.map.call(document.querySelectorAll('span.dp-badge'), function (b) { return b.textContent.trim(); }); },",
  "  badgeColors: function () { return Array.prototype.map.call(document.querySelectorAll('span.dp-badge'), function (b) { return [b.textContent.trim(), b.style.color]; }); },",
  "  countBadge: function (t) { return this.badges().filter(function (x) { return x === t; }).length; },",
  "  lines: function () { return document.body.innerText.split(String.fromCharCode(10)); },",
  "  bar: function () { var t = this.lines(); for (var i = 0; i < t.length; i += 1) { var k = t[i].indexOf('站内额度：'); if (k >= 0) return t[i].slice(k); } return ''; },",
  "  bodyText: function () { return document.body.innerText; },",
  "  qInput: function () { var all = document.querySelectorAll('input.dp-input'); for (var i = 0; i < all.length; i += 1) { if ((all[i].placeholder || '').indexOf('问点关于') === 0) return all[i]; } return null; },",
  "  askBtn: function () { var all = document.querySelectorAll('button'); for (var i = 0; i < all.length; i += 1) { if (all[i].textContent.trim() === '提问') return all[i]; } return null; },",
  "  ansEl: function () { return document.querySelector('p.dp-answer'); },",
  "  answerText: function () { var el = this.ansEl(); return el ? el.innerText : ''; },",
  "  hasCaret: function () { return !!document.querySelector('.dp-caret'); },",
  "  sample: function () { if (this.hasCaret()) this.caretSeen = true; return this.answerText(); },",
  "  setQ: function (q) { var el = this.qInput(); if (!el) return 'no-input'; var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(el, q); el.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; },",
  "  click: function () { var b = this.askBtn(); if (!b) return 'no-button'; if (b.disabled) return 'disabled'; b.click(); return 'clicked'; },",
  "  creds: function () { return localStorage.getItem('expwall.llm.creds.v1'); },",
  "};",
  "'helpers-ready'",
].join(String.fromCharCode(10));

/**
 * 把整轮点击对齐到一个「分钟桶」的开头。
 *
 * 站内限流是 per-IP 3 次/**分钟**，计数落在分钟桶里（proxy/src/limits.ts:47 minuteBucket = floor(now/60000)）。
 * 如果整套点击跨过整分钟边界，第 4 次会落进新桶、被正常放行 —— 「第 4 次必被拒」这条断言就会假失败
 * （曾真实发生过一次：服务端 minute=3 而 day=4，正是「3 次在旧桶 + 1 次在新桶」的指纹）。
 * 桶里剩余时间不够就跑不完，先等到下一个桶开头再开始。
 */
async function alignMinuteStart(minHeadroomMs) {
  const need = minHeadroomMs || 48000;
  for (;;) {
    const left = 60000 - (Date.now() % 60000);
    if (left >= need) return left;
    console.log("  等下一个分钟桶（本桶只剩 " + Math.round(left / 1000) + "s，限流按分钟分桶）…");
    await sleep(left + 1200);
  }
}

async function waitFor(cdp, expr, label, timeoutMs, intervalMs) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await cdp.eval(expr); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > (timeoutMs || 30000)) throw new Error("等待超时：" + label);
    await sleep(intervalMs || 200);
  }
}

async function statusJson() {
  // Worker 是 fail-closed 的：没有 Origin（或不在白名单里）一律 403，所以这里要带上页面同源的 Origin
  const res = await fetch(STATUS_URL, { headers: { Origin: "http://localhost:5177", Connection: "close" } });
  return res.json();
}

/**
 * 点一次「提问」，按 ~60ms 采样页面上的回答文本，直到它稳定下来。
 *
 * 协议（两段式，能区分「同一道题连问两次」）：
 *   1) 点下去后 AskPanel 会先 setResult(null) —— 回答面板必须先消失。这是「新的一轮真的开始了」的确定性信号。
 *      只有同一道题时新答案与上一轮逐字相同，靠比较文字无法区分，所以必须用面板消失来切段。
 *   2) 面板重新出现后逐样本记录文本长度；不忙且连续 3 次不变即收工。
 *      第 4 次（429）时面板再也不会出现 —— 此时不忙 + 面板缺失就是结束条件。
 */
async function askOnce(cdp, question) {
  const typed = await cdp.eval("__acc.setQ(" + JSON.stringify(question) + ")");
  if (typed !== "ok") throw new Error("没能把问题写进输入框：" + typed);
  await sleep(60);
  const clicked = await cdp.eval("__acc.click()");
  if (clicked !== "clicked") throw new Error("没能点中提问按钮：" + clicked);

  const t0 = Date.now();
  let cleared = false;
  while (Date.now() - t0 < 5000) {
    if (!(await cdp.eval("!!__acc.ansEl()"))) { cleared = true; break; }
    await sleep(20);
  }

  const samples = [];
  const trace = [];
  let last = "";
  let stable = 0;
  for (;;) {
    const s = JSON.parse(await cdp.eval("JSON.stringify({ a: __acc.sample(), b: !__acc.askBtn(), c: __acc.hasCaret() })"));
    if (TRACE) trace.push((Date.now() - t0) + "ms a=" + s.a.length + " busy=" + s.b + " caret=" + s.c);
    if (s.a) {
      if (samples.length === 0 || samples[samples.length - 1] !== s.a.length) samples.push(s.a.length);
      if (s.a === last && !s.b) stable += 1; else stable = 0;
      last = s.a;
      if (!s.b && stable >= 3) break;
    } else if (!s.b && cleared) {
      break; // 面板没再出现且不忙：这一轮以失败告终（例如 429），错误面板已经渲染
    }
    if (Date.now() - t0 > ASK_TIMEOUT_MS) break;
    await sleep(60);
  }
  if (TRACE) console.log("    [trace]\n      " + trace.join("\n      "));
  const after = JSON.parse(await cdp.eval("JSON.stringify({ badges: __acc.badges(), bar: __acc.bar(), caretSeen: __acc.caretSeen, hasPanel: !!__acc.ansEl(), body: __acc.bodyText() })"));
  return { samples, text: last, cleared, badges: after.badges, bar: after.bar, sawCaret: after.caretSeen, hasPanel: after.hasPanel, body: after.body, ms: Date.now() - t0 };
}

async function main() {
  console.log("== UI 验收：无 key 访客点「提问」，走站内代理真跑一遍");
  // 先把内存 KV 清零：mock 代理是常驻进程，上一轮验收/探针留下的计数会让
  // 「刚好第 4 次被拒」「usage.calls === 3」这类绝对断言失真。
  const resetRes = await fetch(RESET_URL, { method: "POST", headers: { Connection: "close" } });
  const resetJson = await resetRes.json().catch(() => null);
  check("mock 代理支持测试控制面（每次验收前清零计数）", resetRes.status === 200 && Boolean(resetJson && resetJson.ok), String(resetRes.status) + " " + JSON.stringify(resetJson));
  const st0 = await statusJson();
  check("mock 代理在线且开了 chat 通道", Boolean(st0.ok) && st0.caps.indexOf("chat") >= 0, JSON.stringify(st0.caps));
  check("起点干净：计数 0/0、额度满格 3/30/200", st0.counters.minute === 0 && st0.counters.day === 0 && st0.counters.global === 0 && st0.remaining.minute === 3 && st0.remaining.day === 30, JSON.stringify(st0.counters) + " " + JSON.stringify(st0.remaining));

  const browser = findBrowser();
  const profile = mkdtempSync(join(tmpdir(), "expwall-accept-"));
  const proc = spawn(browser, [
    "--headless=new",
    "--remote-debugging-port=" + CDP_PORT,
    "--user-data-dir=" + profile,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-extensions",
    "--window-size=1440,1000",
    ACCEPT_URL,
  ], { stdio: "ignore" });

  let cdp = null;
  try {
    cdp = await Cdp.attach(CDP_PORT, 30000);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", { url: ACCEPT_URL });
    await waitFor(cdp, "document.readyState === \"complete\"", "页面加载完成", 40000);
    await cdp.eval(HELPERS);
    await waitFor(cdp, "!!__acc.qInput()", "提问输入框出现", 40000);
    await sleep(1200);

    // 对齐分钟桶之后再点第一次：整套「连问 4 次」必须落在同一个桶里（原因见 alignMinuteStart 注释）
    await alignMinuteStart(48000);
    const bucketAtStart = Math.floor(Date.now() / 60000);
    console.log("  （已对齐到分钟桶开头，桶内剩余 " + Math.round((60000 - (Date.now() % 60000)) / 1000) + "s）");

    console.log("== A. 无 key + 徽标必须写「站内代理」");
    const creds = await cdp.eval("__acc.creds()");
    check("localStorage 里没有任何 key（真正的零配置访客）", creds === null, String(creds));
    const colors = JSON.parse(await cdp.eval("JSON.stringify(__acc.badgeColors())"));
    check("页面上有「站内代理」徽标", colors.some((b) => b[0] === "站内代理"), JSON.stringify(colors));
    check("徽标用的是 accent 色（不是回放色）", colors.some((b) => b[0] === "站内代理" && b[1] === "var(--accent)"), JSON.stringify(colors));
    const barBefore = await cdp.eval("__acc.bar()");
    check("详情栏写明站内额度 3 次/分钟", barBefore.indexOf("站内额度：本分钟剩 3/3") >= 0, barBefore);

    console.log("== B/C/D. 真点一次「提问」");
    const r1 = await askOnce(cdp, QUESTION);
    check("点完徽标仍是「站内代理」（没有偷偷退回回放）", r1.badges.filter((b) => b === "站内代理").length >= 1, JSON.stringify(r1.badges));
    check("点击后回答面板先清空再重新渲染（新的一轮真的开始了）", r1.cleared && r1.hasPanel, "cleared=" + r1.cleared + " hasPanel=" + r1.hasPanel);
    check("回答逐字到达（≥3 个长度递增的中间态）", r1.samples.length >= 3, JSON.stringify(r1.samples));
    check("采样期间页面上出现过流式光标", r1.sawCaret === true, String(r1.sawCaret));
    check("回答内容来自上游（假上游的落款）", r1.text.indexOf("本地假上游") >= 0, r1.text.slice(0, 120));
    check("服务端注入了 stream_options.include_usage", r1.text.indexOf("include_usage") >= 0, r1.text.slice(0, 200));
    check("服务端把 max_tokens 夹到 512", r1.text.indexOf("max_tokens=512") >= 0, r1.text.slice(0, 200));
    // 额度数字靠 QuotaBar 的 1.5s ticker 刷新，不能立刻断言，要等它自己掉下来
    let barAfter = "";
    try {
      await waitFor(cdp, "__acc.bar().indexOf(\"站内额度：本分钟剩 2/3\") >= 0", "答案详情栏额度掉到 2", 8000, 250);
      barAfter = await cdp.eval("__acc.bar()");
    } catch (err) { barAfter = await cdp.eval("__acc.bar()"); }
    check("详情栏的站内额度自己掉到 2（不需要重新提问才更新）", barAfter.indexOf("站内额度：本分钟剩 2/3") >= 0, barAfter);
    const st1 = await statusJson();
    check("服务端计数：chat 只记了 1 次", st1.counters.minute === 1 && st1.remaining.minute === 2, JSON.stringify(st1.counters));
    check("服务端 usage 记账：1 次调用 · 12 prompt / 34 completion", st1.usage.calls === 1 && st1.usage.promptTokens === 12 && st1.usage.completionTokens === 34, JSON.stringify(st1.usage));

    console.log("== E/F. 连问 4 次：第 4 次必须被服务端拒绝");
    const r2 = await askOnce(cdp, QUESTION);
    check("第 2 次提问正常出答案", r2.text.indexOf("本地假上游") >= 0, r2.text.slice(0, 80));
    const r3 = await askOnce(cdp, QUESTION);
    check("第 3 次提问正常出答案", r3.text.indexOf("本地假上游") >= 0, r3.text.slice(0, 80));
    const st3 = await statusJson();
    check("服务端计数：3 次（额度刚好用完）", st3.counters.minute === 3 && st3.remaining.minute === 0, JSON.stringify(st3.counters));
    const warn = await cdp.eval("__acc.bodyText()");
    check("界面上出现「站内额度已用完」警示（额度耗尽必须写在页面上）", warn.indexOf("站内额度已用完") >= 0, warn.slice(0, 200));
    check("警示写明「下一次提问会被服务端明确拒绝（429）」", warn.indexOf("下一次提问会被服务端明确拒绝（429）") >= 0, warn.slice(0, 200));

    const r4 = await askOnce(cdp, QUESTION);
    check("第 4 次页面上没有回答面板（没有偷偷回放一段答案）", r4.hasPanel === false && r4.text === "", "hasPanel=" + r4.hasPanel + " text=" + r4.text.slice(0, 60));
    check("第 4 次页面出现「站内额度用完」（describeError 的标题）", r4.body.indexOf("站内额度用完") >= 0, r4.body.slice(0, 300));
    check("第 4 次页面出现服务端原话「请求过于频繁」", r4.body.indexOf("请求过于频繁") >= 0, r4.body.slice(0, 300));
    check("第 4 次页面给出出路「想继续问就填自己的 key」（proxy.ts 的 hint，不是 KeyBar 的隐私文案）", r4.body.indexOf("想继续问就填自己的 key") >= 0, r4.body.slice(0, 400));
    check("第 4 次徽标仍是「站内代理」（额度用完不等于退回回放）", r4.badges.filter((b) => b === "站内代理").length >= 1, JSON.stringify(r4.badges));
    const st4 = await statusJson();
    check("服务端计数停在第 3 次（第 4 次没被放行）", st4.counters.minute === 3 && st4.usage.calls === 3, JSON.stringify(st4.counters) + " " + JSON.stringify(st4.usage));
    // 若是跨了分钟桶，上面 E/F 的失败都是测试自身的假失败（不是产品问题）—— 明确标出来，别让人误读
    const bucketAtEnd = Math.floor(Date.now() / 60000);
    check("整轮点击没有跨分钟桶（跨桶会让第 4 次被误放行，属测试假失败，重跑即可）", bucketAtEnd === bucketAtStart, "bucket " + bucketAtStart + " -> " + bucketAtEnd);

    console.log("== G. 另外两个 demo 页的徽标必须同样明写「站内代理」（不能各页各说各话）");
    const origin = new URL(ACCEPT_URL).origin;
    const proxyQ = new URL(ACCEPT_URL).searchParams.get("proxy");
    const pages = [
      ["YYHelp 电商客服", "/yyhelp/"],
      ["EAP 实验分析", "/eap/"],
    ];
    for (const [name, path] of pages) {
      const url = origin + path + (proxyQ ? "?proxy=" + encodeURIComponent(proxyQ) : "");
      const errsBefore = cdp.pageErrors.length;
      await cdp.send("Page.navigate", { url });
      await waitFor(cdp, "document.readyState === \"complete\"", name + " 页面加载完成", 40000);
      await cdp.eval(HELPERS);
      let badges = [];
      try {
        await waitFor(cdp, "__acc.countBadge('站内代理') >= 1", name + " 出现站内代理徽标", 20000, 300);
        badges = JSON.parse(await cdp.eval("JSON.stringify(__acc.badgeColors())"));
      } catch {
        badges = JSON.parse(await cdp.eval("JSON.stringify(__acc.badgeColors())"));
      }
      check(name + "：页面上出现「站内代理」徽标", badges.some((b) => b[0] === "站内代理"), JSON.stringify(badges));
      check(name + "：徽标必须是 accent 色（不是回放色）", badges.some((b) => b[0] === "站内代理" && b[1] === "var(--accent)"), JSON.stringify(badges));
      check(name + "：没有偷偷退回「回放」徽标", badges.filter((b) => b[0] === "回放").length === 0, JSON.stringify(badges));
      check(name + "：页面没有新的未捕获 JS 异常", cdp.pageErrors.length === errsBefore, cdp.pageErrors.slice(errsBefore).join(" | ").slice(0, 200));
    }

    if (cdp.pageErrors.length) {
      console.log("  页面控制台错误：");
      for (const e of cdp.pageErrors.slice(0, 8)) console.log("    - " + e);
    }
    check("页面没有未捕获的 JS 异常", cdp.pageErrors.filter((e) => e.indexOf("console.error") !== 0).length === 0, cdp.pageErrors.join(" | ").slice(0, 300));
  } finally {
    if (cdp) cdp.close();
    try { proc.kill(); } catch { /* ignore */ }
    await sleep(400);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log("");
  console.log("结果：" + pass + " 通过 / " + fail + " 失败");
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.log("[FAIL] 验收中断：" + (err && err.stack ? err.stack : String(err)));
  process.exit(1);
});
