import { useQuery } from '@tanstack/react-query';
import { BookOpenText, LogOut, Search, Settings } from 'lucide-react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { api, ApiError } from './api';
import { Loading } from './components';
import { browserTimezone, formatDate, isoWeekForDate, todayInTimezone, weekRangeForDate } from './lib';

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
    timezone: string;
    workspaceId: string;
    role: string;
  };
};

export function App() {
  const location = useLocation();
  const barRef = useRef<HTMLElement>(null);
  const highlightRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    document.documentElement.classList.toggle(
      'compact-ui',
      localStorage.getItem('weekly-report:compact') === 'true'
    );
  }, []);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/api/me'), retry: false });
  // 液态玻璃导航：将高亮滑块定位到当前激活的菜单项上。
  useEffect(() => {
    const bar = barRef.current;
    const highlight = highlightRef.current;
    const menu = bar?.querySelector('nav');
    if (!bar || !highlight || !menu) return;
    const place = () => {
      const links = menu.querySelectorAll('a');
      const active =
        menu.querySelector('a.active') ??
        (location.pathname.startsWith('/week') ? links[0] : null);
      if (!active) {
        highlight.style.setProperty('--indicator-w', '0px');
        highlight.style.setProperty('--indicator-h', '0px');
        return;
      }
      const barBox = bar.getBoundingClientRect();
      const box = active.getBoundingClientRect();
      highlight.style.setProperty('--indicator-x', `${box.left - barBox.left}px`);
      highlight.style.setProperty('--indicator-y', `${box.top - barBox.top}px`);
      highlight.style.setProperty('--indicator-w', `${box.width}px`);
      highlight.style.setProperty('--indicator-h', `${box.height}px`);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [me.data, location.pathname]);
  // 液态玻璃光源：跟随指针移动，移出后平滑回到中心。
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const center = 50;
    const resetDuration = 320;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const clamp = (value: number, min: number, max: number) =>
      Math.min(Math.max(value, min), max);
    let frame = 0;
    let lightX = center;
    let lightY = center;
    const setLight = (x: number, y: number) => {
      lightX = x;
      lightY = y;
      bar.style.setProperty('--light-x', `${x.toFixed(2)}%`);
      bar.style.setProperty('--light-y', `${y.toFixed(2)}%`);
      bar.style.setProperty('--shadow-x', `${((center - x) * 0.14).toFixed(2)}px`);
      bar.style.setProperty('--shadow-y', `${(4 + (center - y) * 0.14).toFixed(2)}px`);
    };
    const cancel = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };
    const reset = () => {
      cancel();
      if (reduced.matches) {
        setLight(center, center);
        return;
      }
      const startX = lightX;
      const startY = lightY;
      const startedAt = performance.now();
      const animate = (now: number) => {
        const progress = clamp((now - startedAt) / resetDuration, 0, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setLight(
          startX + (center - startX) * eased,
          startY + (center - startY) * eased
        );
        frame = progress < 1 ? requestAnimationFrame(animate) : 0;
      };
      frame = requestAnimationFrame(animate);
    };
    const onMove = (event: PointerEvent) => {
      cancel();
      const bounds = bar.getBoundingClientRect();
      setLight(
        clamp(((event.clientX - bounds.left) / bounds.width) * 100, 0, 100),
        clamp(((event.clientY - bounds.top) / bounds.height) * 100, 0, 100)
      );
    };
    bar.addEventListener('pointermove', onMove);
    bar.addEventListener('pointerleave', reset);
    bar.addEventListener('pointercancel', reset);
    return () => {
      cancel();
      bar.removeEventListener('pointermove', onMove);
      bar.removeEventListener('pointerleave', reset);
      bar.removeEventListener('pointercancel', reset);
    };
  }, [me.data]);
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
      <aside className="sidebar" ref={barRef}>
        <span className="nav-highlight" ref={highlightRef} aria-hidden="true" />
        <div className="brand">
          <div className="brand-mark">报</div>
          <div>
            <strong>周报工作台</strong>
            <span>Weekly briefing</span>
          </div>
        </div>
        <nav>
          {links.map(([to, Icon, label]) => (
            <NavLink key={to} to={to} end={to === '/'}>
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

export function LoginPage() {
  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () =>
      api<{ devAuthEnabled: boolean; providers: Array<{ provider: string; enabled: boolean }> }>(
        '/api/auth/providers'
      )
  });
  const labels: Record<string, string> = {
    google: 'Google',
    microsoft: 'Microsoft',
    github: 'GitHub',
    apple: 'Apple'
  };
  const error = new URLSearchParams(location.search).get('error');
  const today = todayInTimezone(browserTimezone());
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
        {error && <div className="inline-alert">登录失败或登录流程已经过期，请重新尝试。</div>}
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
        {providers.data?.providers.every((p) => !p.enabled) &&
          (providers.data.devAuthEnabled ? (
            <>
              <p className="muted center">尚未配置登录平台。本地开发可使用开发入口。</p>
              <a className="button full" href="/auth/dev">
                进入本地开发环境
              </a>
            </>
          ) : (
            <div className="inline-alert">尚未配置可用的登录平台，请联系管理员完成身份平台配置。</div>
          ))}
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
