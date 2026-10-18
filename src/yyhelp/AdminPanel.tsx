// 运营后台：全部订单 + 退款审核（通过 / 驳回）+ 发货 / 签收 + 改地址 + 事件时间线。
// 数据与用户端同一份（localStorage），后台改完广播事件，用户端与助手立刻读到新状态。
import { useEffect, useMemo, useState } from 'react';
import { Badge, Panel } from '../shared/ui/core';
import { nowIso, readShopOrders, shortTime, updateShopOrder, type ShopOrder } from './storeOrders';

const money = (n: number) => '¥' + n.toLocaleString('zh-CN');
const push = (o: ShopOrder, node: string, city = '武汉') => [...o.events, { time: nowIso(), node, city }];
const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'refund_pending', label: '待审核退款' },
  { key: 'paid', label: '已付款' },
  { key: 'shipped', label: '已发货' },
  { key: 'refunded', label: '已退款' },
];

export function AdminPanel({ onLogout }: { onLogout: () => void }) {
  const [orders, setOrders] = useState<ShopOrder[]>(() => readShopOrders());
  const [filter, setFilter] = useState('all');
  const [kw, setKw] = useState('');
  const [toast, setToast] = useState('');
  const [edit, setEdit] = useState<{ no: string; value: string } | null>(null);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const refresh = () => setOrders(readShopOrders());
  useEffect(() => {
    const on = () => refresh();
    window.addEventListener('expwall:orders', on);
    return () => window.removeEventListener('expwall:orders', on);
  }, []);
  useEffect(() => {
    const t = toast ? window.setTimeout(() => setToast(''), 3600) : 0;
    return () => { if (t) window.clearTimeout(t); };
  }, [toast]);

  const commit = (no: string, patch: Partial<ShopOrder>) => {
    updateShopOrder(no, patch);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('expwall:orders'));
    refresh();
  };

  const approve = (o: ShopOrder) => {
    commit(o.order_no, { status: 'refunded', status_cn: '已退款', refund_status: 'approved', refund_note: '', events: push(o, 'refund_approved') });
    setToast('已退款 ' + money(o.total_amount) + '：订单 ' + o.order_no + '（用户端状态同步为「已退款」）');
  };
  const reject = (o: ShopOrder) => {
    const note = reason.trim() || '不符合退款条件';
    commit(o.order_no, { status: 'paid', status_cn: '已付款', refund_status: 'rejected', refund_note: note, events: push(o, 'refund_rejected') });
    setRejectFor(null);
    setReason('');
    setToast('已驳回订单 ' + o.order_no + ' 的退款申请：' + note);
  };
  const ship = (o: ShopOrder) => {
    commit(o.order_no, { status: 'shipped', status_cn: '已发货', events: push(o, 'shipped') });
    setToast('订单 ' + o.order_no + ' 已发货');
  };
  const sign = (o: ShopOrder) => {
    commit(o.order_no, { status: 'signed', status_cn: '已签收', events: push(o, 'signed') });
    setToast('订单 ' + o.order_no + ' 已签收');
  };
  const saveAddr = () => {
    if (!edit) return;
    const v = edit.value.trim();
    if (v.length < 6) { setToast('地址太短了，至少 6 个字'); return; }
    const o = orders.find((x) => x.order_no === edit.no);
    if (!o) return;
    commit(o.order_no, { address: v, events: push(o, 'address_changed_admin') });
    setEdit(null);
    setToast('订单 ' + o.order_no + ' 的收货地址已更新');
  };

  const list = useMemo(() => {
    const k = kw.trim();
    return orders
      .filter((o) => (filter === 'all' ? true : o.status === filter))
      .filter((o) => !k || o.order_no.indexOf(k) >= 0 || (o.phone || '').indexOf(k) >= 0 || (o.receiver || '').indexOf(k) >= 0)
      .sort((a, b) => Number(b.order_no) - Number(a.order_no));
  }, [orders, filter, kw]);

  const pending = orders.filter((o) => o.status === 'refund_pending').length;
  const gmv = orders.reduce((s, o) => s + (o.status === 'refunded' ? 0 : o.total_amount), 0);
  const refunded = orders.filter((o) => o.status === 'refunded');
  const refundSum = refunded.reduce((s, o) => s + o.total_amount, 0);

  return (
    <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: 'var(--fg-dim)' }}>
        <span>运营管理员</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={onLogout}>退出登录</button>
      </div>

      {toast && <div className="dp-panel-tight" style={{ padding: '10px 14px', borderColor: 'var(--live)', fontSize: 12, color: 'var(--live)' }}>{toast}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        {[
          ['待审核退款', String(pending) + ' 笔', pending > 0 ? 'warn' : 'live'],
          ['订单总数', String(orders.length) + ' 笔', 'neutral'],
          ['在售金额', money(gmv), 'live'],
          ['已退款', money(refundSum) + ' / ' + refunded.length + ' 笔', 'neutral'],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className="dp-panel-tight" style={{ padding: 12, display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--fg-faint)' }}>{label}</span>
            <span className="dp-mono" style={{ fontSize: 16, color: tone === 'warn' ? 'var(--warn)' : 'var(--fg)' }}>{value}</span>
          </div>
        ))}
      </div>

      <Panel title="全部订单" subtitle="用户提交的退款申请会进入「待审核退款」；通过后用户端立刻变成「已退款」，驳回则回到「已付款」并带上原因。">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className="dp-btn"
              onClick={() => setFilter(f.key)}
              style={{ fontSize: 10.5, padding: '3px 11px', borderColor: filter === f.key ? 'var(--fg)' : 'var(--line)', color: filter === f.key ? 'var(--fg)' : 'var(--fg-dim)' }}
            >
              {f.label}
            </button>
          ))}
          <input className="dp-input" style={{ flex: '1 1 200px', maxWidth: 260 }} placeholder="搜订单号 / 手机号 / 收货人" value={kw} onChange={(e) => setKw(e.target.value)} />
        </div>

        {!list.length && <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-faint)' }}>没有符合条件的订单。</p>}

        <div style={{ display: 'grid', gap: 8 }}>
          {list.map((o) => (
            <div key={o.order_no} className="dp-panel-tight" style={{ padding: 12, display: 'grid', gap: 8, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
                <span className="dp-mono" style={{ fontSize: 13 }}>订单 {o.order_no}</span>
                <Badge tone={o.status === 'refund_pending' ? 'warn' : o.status === 'refunded' ? 'neutral' : 'live'}>{o.status_cn}</Badge>
                <span style={{ color: 'var(--fg-faint)', fontSize: 11 }}>{o.receiver} · {o.phone}</span>
                <span style={{ color: 'var(--fg-faint)', fontSize: 11 }}>{shortTime(o.created_at)}</span>
                <span style={{ flex: 1 }} />
                <span className="dp-mono">{money(o.total_amount)}</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-dim)', overflowWrap: 'anywhere' }}>
                {o.items.map((i) => i.name + ' × ' + i.qty).join('、') || '（无商品明细）'}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-faint)', overflowWrap: 'anywhere' }}>
                地址：{o.address || '—'}{o.refund_note ? ' · 驳回原因：' + o.refund_note : ''}
              </div>
              {edit && edit.no === o.order_no && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input className="dp-input" style={{ flex: '1 1 220px' }} value={edit.value} onChange={(e) => setEdit({ no: o.order_no, value: e.target.value })} />
                  <button type="button" className="dp-btn dp-btn-primary" style={{ fontSize: 11 }} onClick={saveAddr}>保存地址</button>
                  <button type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={() => setEdit(null)}>取消</button>
                </div>
              )}
              {rejectFor === o.order_no && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input className="dp-input" style={{ flex: '1 1 220px' }} placeholder="驳回原因（用户端可见）" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <button type="button" className="dp-btn dp-btn-primary" style={{ fontSize: 11 }} onClick={() => reject(o)}>确认驳回</button>
                  <button type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={() => { setRejectFor(null); setReason(''); }}>取消</button>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {o.status === 'refund_pending' && (
                  <>
                    <button type="button" className="dp-btn dp-btn-primary" style={{ fontSize: 11 }} onClick={() => approve(o)}>通过退款</button>
                    <button type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={() => { setRejectFor(o.order_no); setReason(''); }}>驳回</button>
                  </>
                )}
                {o.status === 'paid' && <button type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={() => ship(o)}>标记已发货</button>}
                {o.status === 'shipped' && <button type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={() => sign(o)}>标记已签收</button>}
                <button type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={() => setEdit({ no: o.order_no, value: o.address || '' })}>改地址</button>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: 'var(--fg-faint)' }}>
                  {o.refund_status === 'approved' ? '退款已通过' : o.refund_status === 'requested' ? '退款待审核' : o.refund_status === 'rejected' ? '退款已驳回' : ''}
                </span>
              </div>
              <details style={{ fontSize: 11, color: 'var(--fg-faint)' }}>
                <summary style={{ cursor: 'pointer' }}>事件时间线（{o.events.length}）</summary>
                <div style={{ display: 'grid', gap: 3, marginTop: 6 }}>
                  {o.events.map((e, i) => (
                    <div key={i} style={{ fontFamily: 'var(--mono)', fontSize: 10.5 }}>
                      {e.time.slice(0, 19).replace('T', ' ')} · {e.node} · {e.city}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          ))}
        </div>
        {!orders.length && (
          <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--fg-faint)' }}>
            后台只管理商城真实下单的订单（2001 起）。项目 fixture 的 1001–1010 属于演示账号，用户侧仍可查询。
          </p>
        )}
      </Panel>
    </div>
  );
}

export default AdminPanel;
