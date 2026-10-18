// 演示商城：登录 → 加购 → 结算（填收货信息）→ 订单（申请退款 / 改地址）。
// 订单写进 localStorage（见 src/yyhelp/storeOrders.ts），/yyhelp/ 的客服助手读同一份数据。
import { useEffect, useMemo, useState } from 'react';
import { page } from '../shared/asset';
import { Badge, Footer, PageShell, Panel, SubHeader } from '../shared/ui/core';
import { ACCOUNTS, PRODUCTS } from './catalog';
import {
  SHOP_CART_PREFIX, SHOP_SESSION_KEY, appendShopOrder, nextOrderNo, nowIso, shortTime, updateShopOrder, userOrders, type ShopOrder,
} from '../yyhelp/storeOrders';

interface Session { phone: string; name: string }

function loadSession(): Session | null {
  try { const raw = localStorage.getItem(SHOP_SESSION_KEY); return raw ? (JSON.parse(raw) as Session) : null; } catch { return null; }
}
function saveSession(s: Session | null): void {
  try { if (s) localStorage.setItem(SHOP_SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SHOP_SESSION_KEY); } catch { /* ignore */ }
}
function loadCart(phone: string): Record<string, number> {
  try { const raw = localStorage.getItem(SHOP_CART_PREFIX + phone); const o = raw ? JSON.parse(raw) : {}; return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}
function saveCart(phone: string, cart: Record<string, number>): void {
  try { localStorage.setItem(SHOP_CART_PREFIX + phone, JSON.stringify(cart)); } catch { /* ignore */ }
}
const money = (n: number) => '¥' + n.toLocaleString('zh-CN');
const field: React.CSSProperties = { display: 'grid', gap: 4, fontSize: 11.5, color: 'var(--fg-dim)' };

export function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [tab, setTab] = useState<'goods' | 'orders'>('goods');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [toast, setToast] = useState('');
  const [checkout, setCheckout] = useState(false);
  const [form, setForm] = useState({ receiver: '', phone: '', address: '', note: '' });
  const [err, setErr] = useState('');
  const [editAddr, setEditAddr] = useState<{ no: string; value: string } | null>(null);
  const [login, setLogin] = useState({ phone: '13800000001', password: '123456' });
  const [loginErr, setLoginErr] = useState('');

  useEffect(() => {
    if (!session) { setCart({}); setOrders([]); return; }
    setCart(loadCart(session.phone));
    setOrders(userOrders(session.phone));
    setForm((f) => ({ ...f, receiver: f.receiver || session.name, phone: f.phone || session.phone }));
  }, [session]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const lines = useMemo(
    () => PRODUCTS.filter((p) => (cart[p.sku] ?? 0) > 0).map((p) => ({ p, qty: cart[p.sku] })),
    [cart],
  );
  const total = lines.reduce((s, l) => s + l.p.price * l.qty, 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);

  const setQty = (sku: string, qty: number) => {
    if (!session) return;
    const next = { ...cart };
    if (qty <= 0) delete next[sku]; else next[sku] = Math.min(qty, 9);
    setCart(next);
    saveCart(session.phone, next);
  };

  const doLogin = (phone = login.phone, password = login.password) => {
    const acc = ACCOUNTS.find((a) => a.phone === phone.trim() && a.password === password);
    if (!acc) { setLoginErr('账号或密码不对（演示账号见下方）'); return; }
    const s: Session = { phone: acc.phone, name: acc.name };
    saveSession(s);
    setSession(s);
    setLoginErr('');
    setToast('已登录：' + acc.name);
  };

  const logout = () => { saveSession(null); setSession(null); setTab('goods'); setCheckout(false); setToast('已退出登录'); };

  const submit = () => {
    if (!session) return;
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
    setToast('下单成功：订单 ' + no + '（去客服助手问它试试）');
  };

  const refund = (o: ShopOrder) => {
    updateShopOrder(o.order_no, {
      status: 'refund_pending',
      status_cn: '退款审核中',
      refund_status: 'requested',
      events: [...o.events, { time: nowIso(), node: 'refund_requested', city: '武汉' }],
    });
    setOrders(userOrders(session!.phone));
    setToast('已提交退款申请：订单 ' + o.order_no + '（可去客服助手追问进度）');
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
    setOrders(userOrders(session!.phone));
    setEditAddr(null);
    setToast('收货地址已更新：订单 ' + editAddr.no);
  };

  return (
    <PageShell>
      <SubHeader
        kicker="Demo 01 · 配套商城"
        title="YY 商城（演示）"
        subtitle="先在这里下一个单、改一次地址或申请退款，再去客服助手问同一个订单号 —— 助手读到的就是你刚操作过的数据。"
        right={<a className="dp-btn" style={{ fontSize: 11 }} href={page('yyhelp')}>去问客服助手 →</a>}
      />

      <div className="dp-wrap" style={{ paddingBottom: 60, display: 'grid', gap: 16 }}>
        {toast && (
          <div className="dp-panel-tight" style={{ padding: '10px 14px', borderColor: 'var(--live)', fontSize: 12, color: 'var(--live)' }}>{toast}</div>
        )}

        {!session && (
          <Panel title="登录（演示账号，不用注册）" subtitle="两个账号都是只存在你浏览器里的假账号，密码 123456。">
            <div style={{ display: 'grid', gap: 10, maxWidth: 420 }}>
              <label style={field}>手机号<input className="dp-input" value={login.phone} onChange={(e) => setLogin({ ...login, phone: e.target.value })} /></label>
              <label style={field}>密码<input className="dp-input" type="password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} /></label>
              {loginErr && <p style={{ margin: 0, fontSize: 11.5, color: 'var(--err)' }}>{loginErr}</p>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="dp-btn dp-btn-primary" onClick={() => doLogin()}>登录</button>
                {ACCOUNTS.map((a) => (
                  <button key={a.phone} type="button" className="dp-btn" onClick={() => { setLogin({ phone: a.phone, password: a.password }); doLogin(a.phone, a.password); }}>
                    一键登录 {a.name}
                  </button>
                ))}
              </div>
            </div>
          </Panel>
        )}

        {session && (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: 'var(--fg-dim)' }}>
              <span>{session.name} · {session.phone}</span>
              <span style={{ color: 'var(--fg-faint)' }}>|</span>
              <button type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={() => setTab('goods')}>商品</button>
              <button type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={() => setTab('orders')}>我的订单（{orders.length}）</button>
              <span style={{ flex: 1 }} />
              <button type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={logout}>退出登录</button>
            </div>

            {tab === 'goods' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
                  {PRODUCTS.map((p) => {
                    const qty = cart[p.sku] ?? 0;
                    return (
                      <div key={p.sku} className="dp-panel-tight" style={{ padding: 14, display: 'grid', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 30, lineHeight: 1 }}>{p.icon}</span>
                          <div style={{ minWidth: 0 }}>
                            <p style={{ margin: 0, fontSize: 13, color: 'var(--fg)', fontWeight: 600 }}>{p.name}</p>
                            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--fg-faint)' }}>{p.spec}</p>
                          </div>
                          {p.tag && <span style={{ marginLeft: 'auto' }}><Badge tone="accent">{p.tag}</Badge></span>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="dp-mono" style={{ fontSize: 15, color: 'var(--fg)' }}>{money(p.price)}</span>
                          <span style={{ flex: 1 }} />
                          {qty === 0 ? (
                            <button type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={() => setQty(p.sku, 1)}>加入购物车</button>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <button type="button" className="dp-btn" style={{ fontSize: 11, padding: '2px 10px' }} onClick={() => setQty(p.sku, qty - 1)}>−</button>
                              <span className="dp-mono" style={{ fontSize: 12, minWidth: 18, textAlign: 'center' }}>{qty}</span>
                              <button type="button" className="dp-btn" style={{ fontSize: 11, padding: '2px 10px' }} onClick={() => setQty(p.sku, qty + 1)}>＋</button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <Panel title={'购物车（' + count + ' 件）'} subtitle="结算时填写收货信息，下单后订单会写进浏览器本地存储，客服助手能直接查到。">
                  {!lines.length && <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-faint)' }}>购物车是空的：上面挑一件加入。</p>}
                  {lines.length > 0 && (
                    <div style={{ display: 'grid', gap: 8 }}>
                      {lines.map((l) => (
                        <div key={l.p.sku} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                          <span style={{ fontSize: 18 }}>{l.p.icon}</span>
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
                  <Panel title="填写收货信息并下单" subtitle="这些都只存在你自己的浏览器里（localStorage），不会上传。">
                    <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
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
                {orders.map((o) => {
                  const tone = o.status === 'refund_pending' ? 'warn' : 'live';
                  return (
                    <div key={o.order_no} className="dp-panel-tight" style={{ padding: 14, display: 'grid', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="dp-mono" style={{ fontSize: 13, color: 'var(--fg)' }}>订单 {o.order_no}</span>
                        <Badge tone={tone}>{o.status_cn}</Badge>
                        <span style={{ fontSize: 11, color: 'var(--fg-faint)' }}>{shortTime(o.created_at)} 下单 · 运单 {o.tracking_no}</span>
                        <span style={{ flex: 1 }} />
                        <span className="dp-mono" style={{ fontSize: 13 }}>{money(o.total_amount)}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--fg-dim)' }}>
                        {o.items.map((i) => i.name + ' × ' + i.qty).join('、')}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--fg-faint)', lineHeight: 1.7 }}>
                        收货：{o.receiver} · {o.phone}<br />地址：{o.address}{o.note ? '（备注：' + o.note + '）' : ''}
                      </div>
                      {editAddr && editAddr.no === o.order_no && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <input className="dp-input" style={{ flex: '1 1 260px' }} value={editAddr.value} onChange={(e) => setEditAddr({ no: o.order_no, value: e.target.value })} />
                          <button type="button" className="dp-btn dp-btn-primary" style={{ fontSize: 11 }} onClick={saveAddress}>保存地址</button>
                          <button type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={() => setEditAddr(null)}>取消</button>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button
                          type="button"
                          className="dp-btn"
                          style={{ fontSize: 11 }}
                          disabled={!o.refundable || o.refund_status === 'requested'}
                          onClick={() => refund(o)}
                        >
                          {o.refund_status === 'requested' ? '退款审核中' : '申请退款'}
                        </button>
                        <button type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={() => setEditAddr({ no: o.order_no, value: o.address ?? '' })}>修改地址</button>
                        <span style={{ flex: 1 }} />
                        <a className="dp-btn" style={{ fontSize: 11 }} href={page('yyhelp')}>去问助手：订单 {o.order_no} 到哪了？</a>
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--fg-faint)' }}>
                        事件：{o.events.slice(-3).map((e) => e.node).join(' → ')}
                      </div>
                    </div>
                  );
                })}
                {!!orders.length && (
                  <p style={{ margin: 0, fontSize: 11.5, color: 'var(--fg-faint)', lineHeight: 1.7 }}>
                    下一步：打开客服助手问「订单 {orders[0].order_no} 到哪了？」或「我要退款」，它会读到这里的同一份订单数据。
                  </p>
                )}
              </>
            )}
          </>
        )}

        <Footer />
      </div>
    </PageShell>
  );
}

export default App;
