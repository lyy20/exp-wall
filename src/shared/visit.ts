/**
 * 访问打点（首页 / /rag/ / /yyhelp/）。
 *
 * 与学习工作台那份（`D:\AI-Learning\docs\.vitepress\theme\visits.ts`）是同一条规则的第二个实现 ——
 * 两个工程分属不同仓库、不同构建链，共享不了一份模块，所以两边都各留一份，改动时**两处一起改**。
 * 规则只有五条，每一条都对应一种静默失效：
 *
 * 1. **本机一律跳过**（localhost / 127.0.0.1 / ::1 / *.local / file:）。自己点站不该进统计。
 * 2. **必须用 `text/plain` 传 JSON**。`sendBeacon` 不做 CORS 预检；`application/json` 会先发 OPTIONS
 *    而 beacon 不等预检 → 请求被丢弃，控制台一声不响。
 * 3. **同一会话同一路径只打一次**（sessionStorage）。刷新一次算一次会很吵；而首页的锚点滚动
 *    压根不是新页面，更不该重复计。
 * 4. **失败完全静默**。统计是附属品，不能因为它抛错影响页面。
 * 5. **不阻塞渲染**：用 `sendBeacon`，浏览器负责把请求发完，不给主线程添活。
 *
 * 隐私：不发 IP（服务端只对 IP 做一次当日不可逆哈希）、不发 cookie、referrer 由服务端截成主机名、
 * 路径在这里先去掉 query。
 */

const ENDPOINT = 'https://llm.agent-lyy.top/api/visit';
const SEEN_KEY = 'expwall-visit-seen';

interface VisitWindow extends Window {
  /** 仅验收脚本用：在页面加载前改掉打点地址（见 D:\AI-Learning\scripts\_test-visit-beacon.mjs） */
  __LEARN_VISIT_ENDPOINT__?: string;
}

function isLocalHost(): boolean {
  if (location.protocol === 'file:') return true;
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.local');
}

function alreadySent(path: string): boolean {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    const seen: string[] = raw ? JSON.parse(raw) : [];
    if (seen.indexOf(path) >= 0) return true;
    seen.push(path);
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(seen.slice(-50)));
    return false;
  } catch {
    // 隐私模式下 sessionStorage 可能抛异常；宁可多打一次，也别漏掉整站
    return false;
  }
}

/** 打一次点。在三个入口的 main.tsx 里各调一次（每页一次，本站没有客户端路由）。 */
export function trackVisit(): void {
  try {
    const override = (window as VisitWindow).__LEARN_VISIT_ENDPOINT__;
    if (!override && isLocalHost()) return;
    // 预渲染阶段不该计一次浏览。`DocumentVisibilityState` 的类型里没有 'prerender'，但运行时会有。
    if ((document.visibilityState as string) === 'prerender') return;

    const path = location.pathname.split('#')[0].split('?')[0] || '/';
    if (alreadySent(path)) return;

    const endpoint = override || ENDPOINT;
    const payload = JSON.stringify({ p: path, r: document.referrer || '', v: window.innerWidth || 0 });
    const blob = new Blob([payload], { type: 'text/plain;charset=UTF-8' });
    if (navigator.sendBeacon && navigator.sendBeacon(endpoint, blob)) return;
    void fetch(endpoint, {
      method: 'POST',
      body: payload,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      keepalive: true,
      mode: 'cors',
    }).catch(() => {
      /* 统计失败不外泄 */
    });
  } catch {
    /* 统计失败不外泄 */
  }
}
