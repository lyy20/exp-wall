/**
 * rewrite-learn-base.mjs — 把 dist/learn/** 里的 `/learn/` 前缀改写成实际部署前缀。
 *
 * 为什么需要这一步：`public/learn/` 是一份**已经构建好**的 VitePress 快照，里面的资源路径
 * 是构建期写死的绝对路径（`/learn/assets/...`）。它在两种部署下需要不同的前缀：
 *
 *   | 部署目标          | BASE_PATH      | learn 实际地址          | 需要的前缀         |
 *   | ----------------- | -------------- | ----------------------- | ------------------ |
 *   | 本地 preview/dev  | 未设 → '/'     | /learn/                 | /learn/    （原样） |
 *   | GitHub Pages      | /exp-wall/     | /exp-wall/learn/        | /exp-wall/learn/   |
 *   | 自有域名 Cloudflare | '' → '/'     | /learn/                 | /learn/    （原样） |
 *
 * 只有 GitHub Pages 那份要改，而它恰好是最容易忘的 —— 忘了的症状是：首页正常打开、点进
 * `/exp-wall/learn/` 白屏，因为 `/learn/assets/*.js` 被解析到 `lyy20.github.io/learn/…`，
 * 那是另一个仓库的根，404。
 *
 * 改 HTML 不够：VitePress 的客户端路由与本地搜索把 base 也编译进了 JS chunk
 * （`/learn/hashmap.json`），所以这里连 .js / .json / .css 一起改。
 *
 * 单次扫描替换，替换产物不会被再次匹配（`/exp-wall/learn/` 里虽然含 `/learn/`，但 replace
 * 不会回头重扫已经替换出来的文本）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LEARN = path.join(ROOT, 'dist', 'learn')
const FROM = '/learn/'
const BASE = process.env.BASE_PATH || '/'

if (!fs.existsSync(LEARN)) {
  console.error(`[learn-base] 没有 dist/learn —— 先跑 D:\\AI-Learning 的 npm run embed:learn`)
  process.exit(1)
}

if (BASE === '/' || BASE === '') {
  console.log('[learn-base] 站点部署在根路径，/learn/ 前缀无需改写')
  process.exit(0)
}

const TO = `${BASE.replace(/\/+$/, '')}/learn/`
if (TO === FROM) {
  console.log('[learn-base] 前缀本来就是 /learn/，无需改写')
  process.exit(0)
}

const TEXT = new Set(['.html', '.js', '.mjs', '.json', '.css', '.txt', '.xml', '.svg'])

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

let files = 0
let hits = 0
for (const f of walk(LEARN)) {
  if (!TEXT.has(path.extname(f).toLowerCase())) continue
  const src = fs.readFileSync(f, 'utf8')
  if (!src.includes(FROM)) continue
  hits += src.split(FROM).length - 1
  fs.writeFileSync(f, src.split(FROM).join(TO), 'utf8')
  files += 1
}

// 兜底：改写后不该再有**裸**的 /learn/。
// 判据是「前面不是部署前缀」——注意只看前缀（`/exp-wall`），不能连 `/learn/` 一起断言：
// `/exp-wall/learn/` 里那个 `/learn/` 前面是 `/exp-wall`，拿完整目标串做 lookbehind 会一条都匹配不上，
// 于是 21116 处改写全被算成「未改写」（这条自检第一版就踩了这个坑）。
const PREFIX_ONLY = BASE.replace(/\/+$/, '')
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const leftoverRe = new RegExp(`(?<!${esc(PREFIX_ONLY)})${FROM}`, 'g')
let leftover = 0
for (const f of walk(LEARN)) {
  if (!TEXT.has(path.extname(f).toLowerCase())) continue
  const src = fs.readFileSync(f, 'utf8')
  leftover += (src.match(leftoverRe) || []).length
}

console.log(`[learn-base] ${FROM} → ${TO}：改写 ${hits} 处 / ${files} 个文件`)
if (leftover) {
  console.warn(`[learn-base] ⚠ 仍有 ${leftover} 处疑似未改写的 ${FROM}`)
} else {
  console.log('[learn-base] ✓ 无残留')
}
