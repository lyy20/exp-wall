// YYHelp 交互演示：登录（单独一屏）→ 左侧商城 + 右侧 AI 助手。
// 页面不放任何后端细节（checkpoint / 系统提示词 / 工具契约 / 回放日志都已删掉），流程只在助手开关打开时显示。
import { useEffect, useState } from 'react';
import { useLlm } from '../shared/llm/useLlm';
import { Badge, Footer, PageShell, Panel, SubHeader } from '../shared/ui/core';
import { loadYyAssets, type YyAssets } from './assets';
import { ShopPanel, type Session } from './ShopPanel';
import { AssistantSidebar } from './AssistantSidebar';
import { ACCOUNTS } from './shopCatalog';
import { SHOP_SESSION_KEY } from './storeOrders';
import { AdminPanel } from './AdminPanel';

/** 运营后台账号（演示用，写死在前端；真实项目当然要走服务端鉴权） */
const ADMIN = { username: 'admin', password: 'admin123', name: '运营管理员' };
const ADMIN_KEY = 'expwall.shop.admin.v1';

function loadAdmin(): { name: string } | null {
  try { const raw = localStorage.getItem(ADMIN_KEY); return raw ? (JSON.parse(raw) as { name: string }) : null; } catch { return null; }
}

function loadSession(): Session | null {
  try { const raw = localStorage.getItem(SHOP_SESSION_KEY); return raw ? (JSON.parse(raw) as Session) : null; } catch { return null; }
}
function saveSession(s: Session | null): void {
  try { if (s) localStorage.setItem(SHOP_SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SHOP_SESSION_KEY); } catch { /* ignore */ }
}

export function App() {
  const llm = useLlm('deepseek');
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [assets, setAssets] = useState<YyAssets | null>(null);
  const [err, setErr] = useState('');
  const [login, setLogin] = useState({ phone: '13800000001', password: '123456' });
  const [loginErr, setLoginErr] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [admin, setAdmin] = useState<{ name: string } | null>(() => loadAdmin());
  const [adminForm, setAdminForm] = useState({ username: ADMIN.username, password: ADMIN.password });
  const [adminErr, setAdminErr] = useState('');

  useEffect(() => {
    if (!session) { setAssets(null); return; }
    let alive = true;
    loadYyAssets()
      .then((a) => { if (alive) setAssets(a); })
      .catch((e) => { if (alive) setErr(String((e as Error)?.message ?? e)); });
    return () => { alive = false; };
  }, [session]);

  const doLogin = (phone = login.phone, password = login.password) => {
    const acc = ACCOUNTS.find((a) => a.phone === phone.trim() && a.password === password);
    if (!acc) { setLoginErr('账号或密码不对（用下面的演示账号）'); return; }
    const s: Session = { phone: acc.phone, name: acc.name };
    saveSession(s);
    setSession(s);
    setLoginErr('');
  };

  const logout = () => {
    saveSession(null);
    setSession(null);
    setAssets(null);
    setErr('');
  };

  const doAdminLogin = (username = adminForm.username, password = adminForm.password) => {
    if (username.trim() !== ADMIN.username || password !== ADMIN.password) {
      setAdminErr('管理员账号或密码不对（演示：admin / admin123）');
      return;
    }
    try { localStorage.setItem(ADMIN_KEY, JSON.stringify({ name: ADMIN.name })); } catch { /* ignore */ }
    setAdmin({ name: ADMIN.name });
    setAdminErr('');
  };

  const adminLogout = () => {
    try { localStorage.removeItem(ADMIN_KEY); } catch { /* ignore */ }
    setAdmin(null);
    // 退出后台回到「用户登录」页签：管理员一般是想切回用户视角看效果
    setRole('user');
  };

  if (admin) {
    return (
      <PageShell>
        <SubHeader
          kicker="Demo 01 · 运营后台"
          title="YYHelp 运营后台"
          subtitle="审核用户提交的退款申请、查看并直接操作所有订单。改完立刻广播，用户端与 AI 助手读到的是同一份数据。"
          right={<Badge tone="warn">管理员</Badge>}
        />
        <div className="dp-wrap" style={{ paddingBottom: 60 }}>
          <AdminPanel onLogout={adminLogout} />
        </div>
        <Footer />
      </PageShell>
    );
  }

  if (!session) {
    return (
      <PageShell>
        <SubHeader kicker="Demo 01 · 应用层" title="YYHelp 交互演示" subtitle="一个能真把事办完的电商客服 Agent：先登录，左侧下单，右侧助手能直接查到。" right={<Badge tone="live">真工具 · 真幂等</Badge>} />
        <div className="dp-wrap" style={{ paddingBottom: 80 }}>
          <div style={{ maxWidth: 460, margin: '40px auto 0' }}>
            <Panel title="登录" subtitle={role === 'user' ? '演示账号，不用注册；密码都是 123456。' : '运营后台：可以审核用户提交的退款、查看并直接操作所有订单。'}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {(['user', 'admin'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    className="dp-btn"
                    onClick={() => setRole(r)}
                    style={{ fontSize: 11, borderColor: role === r ? 'var(--fg)' : 'var(--line)', color: role === r ? 'var(--fg)' : 'var(--fg-dim)' }}
                  >
                    {r === 'user' ? '用户登录' : '管理员登录'}
                  </button>
                ))}
              </div>
              {role === 'user' ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  <label style={{ display: 'grid', gap: 4, fontSize: 11.5, color: 'var(--fg-dim)' }}>手机号<input className="dp-input" value={login.phone} onChange={(e) => setLogin({ ...login, phone: e.target.value })} /></label>
                  <label style={{ display: 'grid', gap: 4, fontSize: 11.5, color: 'var(--fg-dim)' }}>密码<input className="dp-input" type="password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} /></label>
                  {loginErr && <p style={{ margin: 0, fontSize: 11.5, color: 'var(--err)' }}>{loginErr}</p>}
                  <button type="button" className="dp-btn dp-btn-primary" onClick={() => doLogin()}>登录</button>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {ACCOUNTS.map((a) => (
                      <button key={a.phone} type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={() => doLogin(a.phone, a.password)}>
                        一键登录 {a.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  <label style={{ display: 'grid', gap: 4, fontSize: 11.5, color: 'var(--fg-dim)' }}>管理员账号<input className="dp-input" value={adminForm.username} onChange={(e) => setAdminForm({ ...adminForm, username: e.target.value })} /></label>
                  <label style={{ display: 'grid', gap: 4, fontSize: 11.5, color: 'var(--fg-dim)' }}>密码<input className="dp-input" type="password" value={adminForm.password} onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })} /></label>
                  {adminErr && <p style={{ margin: 0, fontSize: 11.5, color: 'var(--err)' }}>{adminErr}</p>}
                  <button type="button" className="dp-btn dp-btn-primary" onClick={() => doAdminLogin()}>进入后台</button>
                  <button type="button" className="dp-btn" style={{ fontSize: 11 }} onClick={() => doAdminLogin(ADMIN.username, ADMIN.password)}>一键进入运营后台</button>
                  <p style={{ margin: 0, fontSize: 11, lineHeight: 1.7, color: 'var(--fg-faint)' }}>
                    演示账号：admin / admin123。后台能审核用户提交的退款（通过 / 驳回）、发货、签收、改地址；操作完用户端状态会同步变化。
                  </p>
                </div>
              )}
            </Panel>
            <p style={{ margin: '14px 2px 0', fontSize: 11.5, lineHeight: 1.8, color: 'var(--fg-faint)' }}>
              登录后进入商城：挑几件商品、填收货信息下单，再申请退款或改地址；右侧助手读的是同一份订单数据。
            </p>
          </div>
        </div>
        <Footer />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <SubHeader
        kicker="Demo 01 · 应用层"
        title="YYHelp 交互演示"
        subtitle="左边是商城：下单、改地址、申请退款都会真的改数据；右边的 AI 助手读同一份订单，打开「显示流程」可以看到它每一步调了什么工具。"
        right={<Badge tone="live">真工具 · 真幂等</Badge>}
      />
      <div className="dp-wrap" style={{ paddingBottom: 60 }}>
        {err && (
          <Panel title="数据加载失败">
            <p style={{ margin: 0, fontSize: 12, color: 'var(--err)' }}>{err}</p>
          </Panel>
        )}
        <div className="yy-layout">
          <ShopPanel session={session} onLogout={logout} />
          {assets
            ? <AssistantSidebar assets={assets} llm={{ live: llm.live, mode: llm.mode }} user={{ id: 'u_' + session.phone.slice(-3), name: session.name, phone: session.phone }} />
            : <aside className="dp-panel" style={{ padding: 14, fontSize: 12, color: 'var(--fg-faint)' }}>正在加载助手…</aside>}
        </div>
      </div>
      <Footer />
    </PageShell>
  );
}

export default App;
