import { useQuery } from '@tanstack/react-query';
import { BookOpenText, LogOut, Menu, Search, Settings, X } from 'lucide-react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import { lazy, Suspense, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { Loading } from './components';
import { formatDate, isoWeekForDate, todayShanghai, weekRangeForDate } from './lib';

const ReportPage = lazy(() =>
  import('./pages/ReportPage').then((module) => ({ default: module.ReportPage }))
);
const SearchPage = lazy(() =>
  import('./pages/SearchPage').then((module) => ({ default: module.SearchPage }))
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage }))
);

type Me = {
  user: {
    id: string;
    displayName: string;
    email: string | null;
    avatarUrl: string | null;
    workspaceId: string;
    role: string;
  };
};

export function App() {
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    document.documentElement.classList.toggle(
      'compact-ui',
      localStorage.getItem('weekly-report:compact') === 'true'
    );
  }, []);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/api/me'), retry: false });
  if (me.isLoading)
    return (
      <div className="app-loader">
        <div className="brand-mark">周</div>
        <Loading />
      </div>
    );
  if (me.error instanceof ApiError && me.error.status === 401)
    return location.pathname === '/login' ? <LoginPage /> : <Navigate to="/login" replace />;
  if (me.error)
    return (
      <div className="login-shell">
        <div className="login-card">
          <h1>暂时无法连接</h1>
          <p>{me.error.message}</p>
          <button className="button" onClick={() => me.refetch()}>
            重新尝试
          </button>
        </div>
      </div>
    );
  const user = me.data!.user;
  const links = [
    ['/', BookOpenText, '工作周报'],
    ['/search', Search, '资料检索'],
    ['/settings', Settings, '系统设置']
  ] as const;
  return (
    <div className="app-shell">
      <header className="mobile-header">
        <button className="icon-button" onClick={() => setNavOpen(true)} aria-label="打开导航">
          <Menu />
        </button>
        <span className="mobile-brand">周报工作台</span>
        <Avatar user={user} />
      </header>
      {navOpen && <button className="nav-scrim" aria-label="关闭导航" onClick={() => setNavOpen(false)} />}
      <aside className={`sidebar ${navOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">报</div>
          <div>
            <strong>周报工作台</strong>
            <span>Weekly briefing</span>
          </div>
          <button className="icon-button nav-close" aria-label="关闭导航" onClick={() => setNavOpen(false)}>
            <X />
          </button>
        </div>
        <nav>
          {links.map(([to, Icon, label]) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={() => setNavOpen(false)}>
              <Icon size={19} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="user-row">
            <Avatar user={user} />
            <div>
              <strong>{user.displayName}</strong>
              <span>{user.email ?? '个人空间'}</span>
            </div>
          </div>
          <button
            className="icon-button"
            aria-label="退出登录"
            onClick={async () => {
              await api('/auth/logout', { method: 'POST' });
              window.location.href = '/login';
            }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <main className="main-content">
        <Suspense
          fallback={
            <div className="route-loader">
              <Loading />
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<ReportPage user={user} />} />
            <Route path="/week/:year/:week" element={<ReportPage user={user} />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/projects" element={<Navigate to="/settings#projects" replace />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

function Avatar({ user }: { user: { displayName: string; avatarUrl: string | null } }) {
  return user.avatarUrl ? (
    <img className="avatar" src={user.avatarUrl} alt="" />
  ) : (
    <span className="avatar avatar-fallback">{user.displayName.slice(0, 1)}</span>
  );
}

function LoginPage() {
  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => api<{ providers: Array<{ provider: string; enabled: boolean }> }>('/api/auth/providers')
  });
  const labels: Record<string, string> = {
    google: 'Google',
    microsoft: 'Microsoft',
    github: 'GitHub',
    apple: 'Apple'
  };
  const error = new URLSearchParams(location.search).get('error');
  const today = todayShanghai();
  const current = isoWeekForDate(today);
  const range = weekRangeForDate(today);
  return (
    <div className="login-shell">
      <div className="login-atmosphere">
        <span />
        <span />
        <span />
      </div>
      <section className="login-editorial">
        <div className="eyebrow">Weekly briefing workspace</div>
        <h1>
          工作有进展，
          <br />
          <em>汇报有重点。</em>
        </h1>
        <p>统一整理成果、计划与风险，让每周工作能够快速浏览、清晰呈报。</p>
        <div className="week-mini">
          <b>{current.week}</b>
          <div>
            <strong>本年度第 {current.week} 周</strong>
            <span>
              {formatDate(range.weekStart)} — {formatDate(range.weekEnd)}
            </span>
          </div>
        </div>
      </section>
      <section className="login-card">
        <div className="brand compact">
          <div className="brand-mark">报</div>
          <div>
            <strong>登录周报工作台</strong>
            <span>进入工作汇报空间</span>
          </div>
        </div>
        {error && <div className="inline-alert">该账号未获授权，或登录流程已经过期。</div>}
        <div className="provider-list">
          {providers.isLoading ? (
            <Loading />
          ) : providers.error ? (
            <div className="inline-alert">登录方式加载失败，请稍后重试。</div>
          ) : (
            providers.data?.providers
              .filter((p) => p.enabled)
              .map((provider) => (
                <a
                  className="provider-button"
                  key={provider.provider}
                  href={`/auth/${provider.provider}/start`}
                >
                  <ProviderIcon provider={provider.provider} />
                  <span>使用 {labels[provider.provider]} 继续</span>
                </a>
              ))
          )}
        </div>
        {providers.data?.providers.every((p) => !p.enabled) && (
          <>
            <p className="muted center">尚未配置登录平台。本地开发可使用开发入口。</p>
            <a className="button full" href="/auth/dev">
              进入本地开发环境
            </a>
          </>
        )}
        <p className="login-note">登录即表示仅在你的授权空间内保存周报数据。</p>
      </section>
    </div>
  );
}

function ProviderIcon({ provider }: { provider: string }) {
  return (
    <span className={`provider-icon ${provider}`}>
      {provider === 'google' ? 'G' : provider === 'microsoft' ? '⊞' : provider === 'github' ? 'GH' : '●'}
    </span>
  );
}
