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
