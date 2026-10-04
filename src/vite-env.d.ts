/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * 站内 LLM 代理（Cloudflare Worker）的基地址，例如 https://expwall-llm.xxx.workers.dev。
   * 构建期由 GitHub Actions 的 vars.VITE_PROXY_BASE_URL 注入；未设置时前端判定为「没有代理」，
   * 行为与纯静态站完全一致（有 key 直连，没 key 回放）。也支持运行时用 ?proxy=… 临时指定。
   */
  readonly VITE_PROXY_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
