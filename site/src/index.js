// 站点 Worker 的脚本部分：只接管 /api/llm/*，其余路径全部交给静态资源（assets binding）。
//
// 为什么要有这一段：原来站点的模型接口挂在另一个主机名 llm.agent-lyy.top 上，页面属于「跨站调用」——
// 有的浏览器/隐私插件/网络会直接挡掉第三方 XHR，访客看到的就是「只有回放」。
// 现在页面调自己的域名 /api/llm/*，由这里用 service binding 转给 expwall-llm：同源、无预检、不依赖第二个域名可达。
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/llm/")) return env.ASSETS.fetch(request);

    // service binding：直接打到 expwall-llm 这个 Worker，不经过公网、不需要 CORS
    const upstream = new URL(url.pathname + url.search, "https://llm.agent-lyy.top");
    const forwarded = new Request(upstream, request);

    // 保留真实访客 IP：限流是按 IP 计数的，service binding 之后要显式带过去，
    // 否则所有访客会共用同一个桶（这一点直接决定「额度还剩多少」是否准确）。
    // 这两个头对浏览器是不可伪造的（Cloudflare 边缘会覆盖），所以转出去是安全的。
    const ip = request.headers.get("CF-Connecting-IP");
    if (ip) {
      forwarded.headers.set("CF-Connecting-IP", ip);
      forwarded.headers.set("x-forwarded-for", ip);
    }

    // 同源 GET 浏览器不发 Origin（只有跨源请求才发），而代理是 fail-closed 的：没有 Origin 直接 403。
    // 于是同一台机器上「跨源直连 llm.agent-lyy.top」能跑、「同源 /api/llm/*」反而 403 —— 页面就把模式判成回放。
    // 这里只在「确实来自本站页面」时补上 Origin：Sec-Fetch-Site 由浏览器自己写（same-origin / same-site），
    // 非浏览器客户端不带这个头，依旧维持 fail-closed（不会给第三方站点开洞）。
    const sameSite = request.headers.get("Sec-Fetch-Site");
    if (!forwarded.headers.get("origin") && (sameSite === "same-origin" || sameSite === "same-site")) {
      forwarded.headers.set("origin", url.origin);
    }
    return env.LLM.fetch(forwarded);
  },
};
