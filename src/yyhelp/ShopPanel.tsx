// 商城主区（/yyhelp/ 左侧）：商品 → 购物车 → 结算 → 订单（退款 / 改地址）。
// 登录由上层 App 负责；这里所有操作都以当前账号（session.phone）为基准。
import { useEffect, useMemo, useState } from 'react';
import { Badge, Panel } from '../shared/ui/core';
import { PRODUCTS } from './shopCatalog';
import {
  SHOP_CART_PREFIX, appendShopOrder, nextOrderNo, nowIso, shortTime, updateShopOrder, userOrders, type ShopOrder,
} from './storeOrders';

export interface Session { phone: string; name: string }

export function loadCart(phone: string): Record<string, number> {
  try { const raw = localStorage.getItem(SHOP_CART_PREFIX + phone); const o = raw ? JSON.parse(raw) : {}; return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}
function saveCart(phone: string, cart: Record<string, number>): void {
  try { localStorage.setItem(SHOP_CART_PREFIX + phone, JSON.stringify(cart)); } catch { /* ignore */ }
}
const money = (n: number) => '¥' + n.toLocaleString('zh-CN');
const field: React.CSSProperties = { display: 'grid', gap: 4, fontSize: 11.5, color: 'var(--fg-dim)' };

export function ShopPanel({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [tab, setTab] = useState<'goods' | 'orders'>('goods');
  const [cart, setCart] = useState<Record<string, number>>(() => loadCart(session.phone));
  const [orders, setOrders] = useState<ShopOrder[]>(() => userOrders(session.phone));
  const [toast, setToast] = useState('');
  const [checkout, setCheckout] = useState(false);
  const [form, setForm] = useState({ receiver: session.name, phone: session.phone, address: '', note: '' });
  const [err, setErr] = useState('');
  const [editAddr, setEditAddr] = useState<{ no: string; value: string } | null>(null);

  useEffect(() => {
    const t = toast ? window.setTimeout(() => setToast(''), 3200) : 0;
    return () => { if (t) window.clearTimeout(t); };
  }, [toast]);

  // 助手改了地址/退了款 → 左侧订单列表跟着刷新（不刷新页面）。
  useEffect(() => {
    const on = () => setOrders(userOrders(session.phone));
    window.addEventListener('expwall:orders', on);
    return () => window.removeEventListener('expwall:orders', on);
  }, [session.phone]);

  const lines = useMemo(
    () => PRODUCTS.filter((p) => (cart[p.sku] ?? 0) > 0).map((p) => ({ p, qty: cart[p.sku] })),
    [cart],
  );
  const total = lines.reduce((s, l) => s + l.p.price * l.qty, 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);

  const setQty = (sku: string, qty: number) => {
    const next = { ...cart };
    if (qty <= 0) delete next[sku]; else next[sku] = Math.min(qty, 9);
    setCart(next);
    saveCart(session.phone, next);
  };

  const submit = () => {
    const receiver = form.receiver.trim();
    const addr = form.address.trim();
    if (!receiver) { setErr('请填写收货人'); return; }
    if (!/^1\d{10}$/.test(form.phone.trim())) { setErr('手机号需为 11 位数字'); return; }
    if (addr.length < 6) { setErr('请填写完整收货地址（至少 6 个字）'); return; }
    if (!lines.length) { setErr('购物车是空的'); return; }
    const t = nowIso();
    const no = nextOrderNo();
    const order: ShopOrder = {
      order_no: no,
      user_id: 'u_' + session.phone.slice(-3),
      status: 'paid',
      status_cn: '已付款',
      total_amount: total,
      created_at: t,
      tracking_no: 'SF' + String(100000000 + Number(no) * 137).slice(0, 9),
      refundable: true,
      items: lines.map((l) => ({ sku: l.p.sku, name: l.p.name, qty: l.qty })),
      events: [
        { time: t, node: 'order_created', city: '武汉' },
        { time: t, node: 'paid', city: '武汉' },
        { time: t, node: 'packed', city: '武汉仓' },
      ],
      receiver,
      phone: form.phone.trim(),
      address: addr,
      note: form.note.trim(),
      refund_status: 'none',
      user_phone: session.phone,
    };
    appendShopOrder(order);
    setOrders(userOrders(session.phone));
    setCart({});
    saveCart(session.phone, {});
    setCheckout(false);
    setErr('');
    setTab('orders');
    setToast('下单成功：订单 ' + no + '。右侧助手已经能查到它了。');
  };

  const refund = (o: ShopOrder) => {
    updateShopOrder(o.order_no, {
      status: 'refund_pending',
      status_cn: '退款审核中',
      refund_status: 'requested',
      events: [...o.events, { time: nowIso(), node: 'refund_requested', city: '武汉' }],
    });
    setOrders(userOrders(session.phone));
    setToast('已提交退款申请：订单 ' + o.order_no + '（可以问右侧助手进度）');
  };

  const saveAddress = () => {
    if (!editAddr) return;
    const v = editAddr.value.trim();
    if (v.length < 6) { setToast('地址太短了，至少 6 个字'); return; }
    const o = orders.find((x) => x.order_no === editAddr.no);
    updateShopOrder(editAddr.no, {
      address: v,
      events: [...(o?.events ?? []), { time: nowIso(), node: 'address_changed', city: '武汉' }],
    });
    setOrders(userOrders(session.phone));
    setEditAddr(null);
    setToast('收货地址已更新：订单 ' + editAddr.no);
  };

  return (
    <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: 'var(--fg-dim)' }}>
        <span>{session.name} · {session.phone}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={() => setTab('goods')}>商品</button>
        <button type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={() => setTab('orders')}>我的订单（{orders.length}）</button>
        <button type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={onLogout}>退出登录</button>
      </div>

      {toast && (
        <div className="dp-panel-tight" style={{ padding: '10px 14px', borderColor: 'var(--live)', fontSize: 12, color: 'var(--live)' }}>{toast}</div>
      )}

      {tab === 'goods' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            {PRODUCTS.map((p) => {
              const qty = cart[p.sku] ?? 0;
              return (
                <div key={p.sku} className="dp-panel-tight" style={{ padding: 12, display: 'grid', gap: 8, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 26, lineHeight: 1 }}>{p.icon}</span>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--fg)', fontWeight: 600 }}>{p.name}</p>
                      <p style={{ margin: '2px 0 0', fontSize: 10.5, color: 'var(--fg-faint)' }}>{p.spec}</p>
                    </div>
                    {p.tag && <span style={{ marginLeft: 'auto' }}><Badge tone="accent">{p.tag}</Badge></span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="dp-mono" style={{ fontSize: 14 }}>{money(p.price)}</span>
                    <span style={{ flex: 1 }} />
                    {qty === 0 ? (
                      <button type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={() => setQty(p.sku, 1)}>加入购物车</button>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button type="button" className="dp-btn" style={{ fontSize: 11, padding: '2px 9px' }} onClick={() => setQty(p.sku, qty - 1)}>−</button>
                        <span className="dp-mono" style={{ fontSize: 12, minWidth: 16, textAlign: 'center' }}>{qty}</span>
                        <button type="button" className="dp-btn" style={{ fontSize: 11, padding: '2px 9px' }} onClick={() => setQty(p.sku, qty + 1)}>＋</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <Panel title={'购物车（' + count + ' 件）'} subtitle="结算后订单会写进本地存储，右侧助手立刻能查到。">
            {!lines.length && <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-faint)' }}>购物车是空的：上面挑一件加入。</p>}
            {lines.length > 0 && (
              <div style={{ display: 'grid', gap: 8 }}>
                {lines.map((l) => (
                  <div key={l.p.sku} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, minWidth: 0 }}>
                    <span style={{ fontSize: 16 }}>{l.p.icon}</span>
                    <span style={{ color: 'var(--fg)' }}>{l.p.name}</span>
                    <span style={{ color: 'var(--fg-faint)' }}>× {l.qty}</span>
                    <span style={{ flex: 1 }} />
                    <span className="dp-mono">{money(l.p.price * l.qty)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid var(--line-soft)', paddingTop: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--fg-dim)' }}>合计</span>
                  <span className="dp-mono" style={{ fontSize: 16, color: 'var(--fg)' }}>{money(total)}</span>
                  <span style={{ flex: 1 }} />
                  <button type="button" className="dp-btn dp-btn-primary" onClick={() => { setErr(''); setCheckout(true); }}>去结算</button>
                </div>
              </div>
            )}
          </Panel>

          {checkout && (
            <Panel title="填写收货信息并下单" subtitle="只存在你自己的浏览器里（localStorage），不会上传。">
              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                <label style={field}>收货人<input className="dp-input" value={form.receiver} onChange={(e) => setForm({ ...form, receiver: e.target.value })} /></label>
                <label style={field}>手机号<input className="dp-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
                <label style={{ ...field, gridColumn: '1 / -1' }}>收货地址<input className="dp-input" placeholder="例如：湖北省武汉市洪山区珞喻路 1037 号 6 栋 302" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
                <label style={{ ...field, gridColumn: '1 / -1' }}>备注（可选）<input className="dp-input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
              </div>
              {err && <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--err)' }}>{err}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button type="button" className="dp-btn dp-btn-primary" onClick={submit}>提交订单（{money(total)}）</button>
                <button type="button" className="dp-btn" onClick={() => { setCheckout(false); setErr(''); }}>取消</button>
              </div>
            </Panel>
          )}
        </>
      )}

      {tab === 'orders' && (
        <>
          {!orders.length && (
            <Panel title="还没有订单">
              <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-dim)' }}>去「商品」下第一单，再回来这里申请退款或改地址。</p>
              <button type="button" className="dp-btn dp-btn-primary" style={{ marginTop: 10 }} onClick={() => setTab('goods')}>去挑商品</button>
            </Panel>
          )}
          {orders.map((o) => (
            <div key={o.order_no} className="dp-panel-tight" style={{ padding: 14, display: 'grid', gap: 8, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="dp-mono" style={{ fontSize: 13, color: 'var(--fg)' }}>订单 {o.order_no}</span>
                <Badge tone={o.status === 'refund_pending' ? 'warn' : 'live'}>{o.status_cn}</Badge>
                <span style={{ fontSize: 11, color: 'var(--fg-faint)' }}>{shortTime(o.created_at)} · 运单 {o.tracking_no}</span>
                <span style={{ flex: 1 }} />
                <span className="dp-mono" style={{ fontSize: 13 }}>{money(o.total_amount)}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg-dim)', overflowWrap: 'anywhere' }}>{o.items.map((i) => i.name + ' × ' + i.qty).join('、')}</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-faint)', lineHeight: 1.7, overflowWrap: 'anywhere' }}>
                收货：{o.receiver} · {o.phone}<br />地址：{o.address}{o.note ? '（备注：' + o.note + '）' : ''}
              </div>
              {editAddr && editAddr.no === o.order_no && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input className="dp-input" style={{ flex: '1 1 220px' }} value={editAddr.value} onChange={(e) => setEditAddr({ no: o.order_no, value: e.target.value })} />
                  <button type="button" className="dp-btn dp-btn-primary" style={{ fontSize: 11 }} onClick={saveAddress}>保存地址</button>
                  <button type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={() => setEditAddr(null)}>取消</button>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" className="dp-btn" style={{ fontSize: 11 }} disabled={!o.refundable || o.refund_status === 'requested'} onClick={() => refund(o)}>
                  {o.refund_status === 'requested' ? '退款审核中' : '申请退款'}
                </button>
                <button type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={() => setEditAddr({ no: o.order_no, value: o.address ?? '' })}>修改地址</button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export default ShopPanel;
