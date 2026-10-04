import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 多入口站点：
 *   /        作品集首页（Hero + Marquee + About + Project 堆叠卡）
 *   /rag/    科研文献 RAG 问答平台
 *   /yyhelp/ YYHelp 电商智能客服平台
 *   /eap/    科研实验分析助手 Agent
 *
 * base 说明：多入口 + 相对 base（'./'）会让 rag/ 这类子目录里的 HTML 把 assets 解析到
 * /rag/assets/... 从而 404。因此改为「绝对 base + 环境变量注入」：
 *   本地开发/预览  -> '/'（默认）
 *   GitHub Pages   -> '/<仓库名>/'（由 workflow 注入 BASE_PATH）
 */
const basePath = process.env.BASE_PATH || '/';

export default defineConfig({
  base: basePath,
  plugins: [react()],
  server: {
    // 两条忽略规则都是为了 dev server 不被写盘工具搞死：
    //   1) proxy/ 是独立的 Cloudflare Worker 包，站点不 import 它，但默认会被整个仓库 watch；
    //   2) 编辑任何源文件时，写盘工具会先建 `.<文件名>.<pid>.<uuid>.tmpdir/<文件名>.tmp` 再原子替换，
    //      这些临时目录在 Windows 上会被 vite 的 FSWatcher 抢到并抛 EBUSY 直接崩进程（踩过两次：
    //      proxy/src/limits.ts 与 src/shared/ui/llm-ui.tsx）。
    watch: { ignored: ['**/proxy/**', '**/.*.tmpdir/**', '**/.*.tmp'] },
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        rag: 'rag/index.html',
        yyhelp: 'yyhelp/index.html',
        eap: 'eap/index.html',
      },
    },
    chunkSizeWarningLimit: 1200,
  },
});
