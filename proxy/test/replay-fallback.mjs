// 回归检查（第三条验收命令，见 README §4）：**没配 VITE_PROXY_BASE_URL 的构建**必须退化成「回放」。
// 这是 P5-lite 改动的关键回归面：ModeBadge 的 mode 变必填、AskPanel 加了 streaming 分支、
// KeyBar/QuotaBar 加了额度 ticker —— 都必须保证「没有站内代理」时的行为与改动前一致：
//   徽标是「回放」且不出现「站内代理」徽标 / 不出现「站内额度：」/ 点「提问」按真实节奏逐字回放
//   （采样到递增的中间态 + 流式光标）/ 页面明写「零配置：按真实节奏回放录制的模型输出…」/ 无未捕获 JS 异常。
//
// 前提（dist 产物 + 静态预览；不需要 key、不需要联网）：
//   npm run build
//   npx vite preview --port 5188 --strictPort      # 服务 dist，与 CI 产物同一份
// 用法：node proxy/test/replay-fallback.mjs        环境变量：URL（默认 http://localhost:5188/rag/）、CDP_PORT（默认 9335）
//
// 选材说明：题目用 replay_rag.json 里**最长**的录制答案（USV 那题 520 字符）。
// 换成 33 字符的答案时，60 字符/秒几毫秒就播完了，采样抓不到「逐字」——那是选材问题，不是产品缺陷。

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ = process.env.URL || "http://localhost:5188/rag/";
const CDP_PORT = Number(process.env.CDP_PORT || 9335);
const QUESTION = "USV 的速度设定是多少？动作空间包含哪些维度？";

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log("  [ok] " + n); } else { fail++; console.log("  [FAIL] " + n + (extra === undefined ? "" : "  -> " + String(extra))); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const cands = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"];
  for (const p of cands) if (p && existsSync(p)) return p;
  throw new Error("找不到 Chrome/Edge");
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.pageErrors = [];
    ws.addEventListener("message", (ev) => {
      let m = null; try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); return; }
      if (m.method === "Runtime.exceptionThrown") { const d = m.params && m.params.exceptionDetails; this.pageErrors.push((d && d.text) || "unknown"); }
      if (m.method === "Runtime.consoleAPICalled" && m.params && m.params.type === "error") this.pageErrors.push("console.error: " + (m.params.args || []).map((a) => a.value).join(" "));
    });
  }
  static async attach(port, timeoutMs) {
    const t0 = Date.now();
    for (;;) {
      try {
        const res = await fetch("http://127.0.0.1:" + port + "/json/list");
        const targets = await res.json();
        const page = targets.filter((t) => t.type === "page")[0];
        if (!page || !page.webSocketDebuggerUrl) throw new Error("还没有可用的页面目标");
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", () => reject(new Error("CDP websocket 连接失败")), { once: true }); });
        return new Cdp(ws);
      } catch (err) { if (Date.now() - t0 > (timeoutMs || 25000)) throw err; await sleep(300); }
    }
  }
  send(method, params) {
    const id = (this.id += 1);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error("CDP 超时：" + method)); } }, 60000);
    });
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) throw new Error("页面里执行失败：" + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r && r.result ? r.result.value : undefined;
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

const HELPERS = [
  "window.__acc = {",
  "  caretSeen: false,",
  "  badges: function () { return Array.prototype.map.call(document.querySelectorAll('span.dp-badge'), function (b) { return b.textContent.trim(); }); },",
  "  badgeColors: function () { return Array.prototype.map.call(document.querySelectorAll('span.dp-badge'), function (b) { return [b.textContent.trim(), b.style.color]; }); },",
  "  countBadge: function (t) { return this.badges().filter(function (x) { return x === t; }).length; },",
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

async function waitFor(cdp, expr, label, timeoutMs, intervalMs) {
  const t0 = Date.now();
  for (;;) {
    let v = null; try { v = await cdp.eval(expr); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > (timeoutMs || 30000)) throw new Error("等待超时：" + label);
    await sleep(intervalMs || 200);
  }
}

async function main() {
  const browser = findBrowser();
  const profile = mkdtempSync(join(tmpdir(), "expwall-replay-"));
  const proc = spawn(browser, ["--headless=new", "--remote-debugging-port=" + CDP_PORT, "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions", "--window-size=1440,1000", URL_], { stdio: "ignore" });
  let cdp = null;
  try {
    cdp = await Cdp.attach(CDP_PORT, 30000);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", { url: URL_ });
    await waitFor(cdp, 'document.readyState === "complete"', "页面加载完成", 40000);
    await cdp.eval(HELPERS);
    await waitFor(cdp, "!!__acc.qInput()", "提问输入框出现", 60000);
    await sleep(1500);

    check("无 key 访客：localStorage 里没有凭据", (await cdp.eval("__acc.creds()")) === null);
    const badges = await cdp.eval("JSON.stringify(__acc.badges())");
    const colors = await cdp.eval("JSON.stringify(__acc.badgeColors())");
    console.log("  徽标：" + badges + "  颜色：" + colors);
    check("页面里必须出现「回放」徽标（没有代理时不允许冒充实时）", (await cdp.eval("__acc.countBadge('回放')")) >= 1);
    check("没有代理时页面上不得出现「站内代理」徽标", (await cdp.eval("__acc.countBadge('站内代理')")) === 0, badges);
    check("没有代理时页面上不得出现「站内额度：」", (await cdp.eval("__acc.bodyText().indexOf('站内额度：') >= 0")) === false);

    check("把问题写进输入框", (await cdp.eval("__acc.setQ(" + JSON.stringify(QUESTION) + ")")) === "ok");
    await sleep(60);
    check("点中「提问」按钮", (await cdp.eval("__acc.click()")) === "clicked");

    const t0 = Date.now();
    // 回放路径**不做**「面板先清空」的断言：零配置下查询向量取本地预计算那份，整段是同步的，
    // React 会把 setResult(null) 与 setResult(streaming) 批到同一帧 —— 面板压根不会消失。
    // （有代理/有 key 时中间夹着真网络 await，才看得见「先清空再出现」；这是路径差异，不是缺陷。）
    await waitFor(cdp, "!!__acc.ansEl()", "回答面板出现", 30000);
    const lens = [];
    let last = "", stable = 0, stageSeen = false;
    for (;;) {
      const s = JSON.parse(await cdp.eval("JSON.stringify({ a: __acc.sample(), b: !__acc.askBtn(), c: __acc.hasCaret(), d: __acc.bodyText().indexOf('零配置：按真实节奏回放') >= 0 })"));
      if (s.d) stageSeen = true;
      if (s.a !== last) { lens.push(s.a.length); last = s.a; stable = 0; } else if (!s.b) { stable += 1; if (stable >= 3) break; }
      if (Date.now() - t0 > 180000) break;
      await sleep(60);
    }
    const increasing = lens.filter((n, i) => i > 0 && n > lens[i - 1]).length;
    console.log("  采样长度序列（前 12 个）：" + JSON.stringify(lens.slice(0, 12)) + " … 共 " + lens.length + " 个样本，终值 " + last.length + " 字符");
    check("回放确实是逐字流式（≥3 次长度递增）", increasing >= 3, JSON.stringify(lens.slice(0, 10)));
    check("回放播到了完整录制答案（≥400 字符，该题录制答案是 520 字符）", last.length >= 400, last.length);
    check("回放期间页面上出现过流式光标", (await cdp.eval("__acc.caretSeen")) === true);
    check("页面上明写了「零配置：按真实节奏回放录制的模型输出…」（不拿回放冒充实时）", stageSeen);

    const errs = cdp.pageErrors.filter((e) => e.indexOf("console.error") !== 0);
    if (cdp.pageErrors.length) { console.log("  页面控制台错误："); for (const e of cdp.pageErrors.slice(0, 8)) console.log("    - " + e); }
    check("页面没有未捕获的 JS 异常", errs.length === 0, errs.join(" | ").slice(0, 300));
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

main().catch((err) => { console.log("[FAIL] 检查中断：" + (err && err.stack ? err.stack : String(err))); process.exit(1); });
