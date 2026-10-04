// 一条命令把站点发布到自有域名（agent-lyy.top）根路径：
//   node site/deploy.mjs
// 干两件事：
//   1) 在仓库根目录跑一次「根路径 base」的构建（不设 BASE_PATH ⇒ vite base='/'），
//      并把站内代理地址写进构建产物（VITE_PROXY_BASE_URL，默认 'same-origin'：页面调自己域名的 /api/llm/*，
//      由 site/src/index.js 同源转给 expwall-llm —— 不再直连 llm.agent-lyy.top，避免被第三方请求拦截）；
//   2) 在 site/ 目录跑 npx wrangler deploy，把 dist 作为静态资源挂到 agent-lyy.top / www.agent-lyy.top。
// 注意：GitHub Pages 那份构建用 BASE_PATH=/exp-wall/，两份互不干扰（CI 只构建 Pages 那份）。
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const PROXY = process.env.VITE_PROXY_BASE_URL || 'same-origin';

function run(cmd, args, cwd, env) {
  return new Promise((resolve, reject) => {
    console.log('> ' + cmd + ' ' + args.join(' ') + '   (cwd=' + cwd + ')');
    const child = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, ...env },
    });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(cmd + ' 退出码 ' + code))));
  });
}

await run('npm', ['run', 'build'], root, { VITE_PROXY_BASE_URL: PROXY, BASE_PATH: '/' });
await run('npx', ['wrangler', 'deploy'], here, {});
console.log('\n完成：https://agent-lyy.top/   站内代理 = ' + PROXY + '（/api/llm/* 由本站 Worker 同源转发）');
