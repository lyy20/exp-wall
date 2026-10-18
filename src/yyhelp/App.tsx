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

  if (!session) {
    return (
      <PageShell>
        <SubHeader kicker="Demo 01 · 应用层" title="YYHelp 交互演示" subtitle="一个能真把事办完的电商客服 Agent：先登录，左侧下单，右侧助手能直接查到。" right={<Badge tone="live">真工具 · 真幂等</Badge>} />
        <div className="dp-wrap" style={{ paddingBottom: 80 }}>
          <div style={{ maxWidth: 460, margin: '40px auto 0' }}>
            <Panel title="登录" subtitle="演示账号，不用注册；密码都是 123456。">
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
            ? <AssistantSidebar assets={assets} llm={{ live: llm.live, mode: llm.mode }} />
            : <aside className="dp-panel" style={{ padding: 14, fontSize: 12, color: 'var(--fg-faint)' }}>正在加载助手…</aside>}
        </div>
      </div>
      <Footer />
    </PageShell>
  );
}

export default App;
