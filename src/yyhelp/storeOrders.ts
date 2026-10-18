// 商城的订单存在 localStorage 里，客服助手读的是同一份数据：
// 面试官在 /shop/ 下一单、改地址或申请退款后，回 /yyhelp/ 直接问助手就能查到（订单号 2001 起）。
import type { YyOrder } from './assets';

export const SHOP_ORDERS_KEY = 'expwall.shop.orders.v1';
export const SHOP_SESSION_KEY = 'expwall.shop.session.v1';
export const SHOP_CART_PREFIX = 'expwall.shop.cart.';

export interface ShopOrder extends YyOrder {
  /** 商城侧补充的字段；引擎的 query_order 会在存在时一并返回 */
  receiver?: string;
  phone?: string;
  address?: string;
  note?: string;
  /** none=没申请 · requested=用户已申请待审核 · approved=审核通过（已退款） · rejected=审核驳回 */
  refund_status?: 'none' | 'requested' | 'approved' | 'rejected';
  /** 驳回原因（管理员填写，用户侧可见） */
  refund_note?: string;
  user_phone?: string;
}

export function readShopOrders(): ShopOrder[] {
  try {
    const raw = localStorage.getItem(SHOP_ORDERS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? (arr as ShopOrder[]) : [];
  } catch { return []; }
}

export function writeShopOrders(list: ShopOrder[]): void {
  try { localStorage.setItem(SHOP_ORDERS_KEY, JSON.stringify(list)); } catch { /* 隐私模式等 */ }
}

export function appendShopOrder(o: ShopOrder): void {
  writeShopOrders([o, ...readShopOrders()]);
}

export function updateShopOrder(orderNo: string, patch: Partial<ShopOrder>): ShopOrder | null {
  const list = readShopOrders();
  const i = list.findIndex((o) => o.order_no === orderNo);
  if (i < 0) return null;
  const next = { ...list[i], ...patch };
  list[i] = next;
  writeShopOrders(list);
  return next;
}

/** 订单号从 2001 起递增，和项目 fixture 的 1001-1010 区分开，一眼能看出「这是你刚下的单」。 */
export function nextOrderNo(): string {
  const max = readShopOrders().reduce((m, o) => Math.max(m, Number(o.order_no) || 0), 2000);
  return String(max + 1);
}

/** 商城订单排在前面（最新在前），再接项目自带的 fixture。 */
export function mergeOrders(base: YyOrder[]): YyOrder[] {
  const shop = readShopOrders();
  const seen = new Set(base.map((o) => o.order_no));
  return [...shop.filter((o) => !seen.has(o.order_no)), ...base];
}

export function userOrders(phone: string): ShopOrder[] {
  return readShopOrders().filter((o) => !o.user_phone || o.user_phone === phone);
}

export function nowIso(): string { return new Date().toISOString(); }

export function shortTime(iso: string): string {
  try { return new Date(iso).toLocaleString('zh-CN', { hour12: false }).replace(/:\d\d$/, ''); } catch { return iso; }
}
