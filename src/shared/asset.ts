/** 站点根（含子路径），例如 '/exp-wall/' 或 '/' */
export const BASE: string = import.meta.env.BASE_URL;

/** 把 public/ 下的相对路径拼成部署后可用的绝对路径 */
export function asset(path: string): string {
  return BASE + path.replace(/^\/+/, '');
}

/** 子页 / 首页的绝对链接 */
export function page(name: 'home' | 'rag' | 'yyhelp' | 'eap'): string {
  return name === 'home' ? BASE : BASE + name + '/';
}
