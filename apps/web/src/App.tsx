import { useQuery } from '@tanstack/react-query';
import { BookOpenText, LogOut, Search, Settings } from 'lucide-react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
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
  const navigate = useNavigate();
  const barRef = useRef<HTMLElement>(null);
  const highlightRef = useRef<HTMLSpanElement>(null);
  // 拖拽结束后的下一次 click 需要被吞掉（跨 effect 重挂载保持）。
  const suppressClickRef = useRef(false);
  useEffect(() => {
    document.documentElement.classList.toggle(
      'compact-ui',
      localStorage.getItem('weekly-report:compact') === 'true'
    );
  }, []);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/api/me'), retry: false });
  // 液态玻璃导航：严格移植“纯CSS液态玻璃”示例脚本
  // （拖拽吸附、液滴拉伸/收缩/回弹、指针光源与阴影、光源 320ms 回中）。
  useEffect(() => {
    const bar = barRef.current;
    const indicator = highlightRef.current;
    const menu = bar?.querySelector('nav');
    if (!bar || !indicator || !menu) return;
    const links: HTMLAnchorElement[] = Array.from(menu.querySelectorAll('a'));
    if (links.length === 0) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const center = 50;
    const resetDuration = 320;
    const clamp = (value: number, min: number, max: number) =>
      Math.min(Math.max(value, min), max);

    let resetFrame = 0;
    let resetTimer = 0;
    let lightX = center;
    let lightY = center;
    let pointerDown = false;
    let dragging = false;
    let dragMoved = false;
    let dragStartX = 0;
    let dragStartPosition = 0;
    let previousPointerX = 0;
    let dragStretch = 1;
    let currentX = 0;
    let currentW = 0;

    const setLight = (x: number, y: number) => {
      lightX = x;
      lightY = y;
      indicator.style.setProperty('--light-x', `${x.toFixed(2)}%`);
      indicator.style.setProperty('--light-y', `${y.toFixed(2)}%`);
      indicator.style.setProperty('--shadow-x', `${((center - x) * 0.14).toFixed(2)}px`);
      indicator.style.setProperty(
        '--shadow-y',
        `${(4 + (center - y) * 0.14).toFixed(2)}px`
      );
    };

    const cancelReset = () => {
      if (resetFrame) {
        cancelAnimationFrame(resetFrame);
        resetFrame = 0;
      }
    };

    const resetLight = () => {
      if (dragging) return;
      cancelReset();
      if (reduceMotion.matches) {
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
        resetFrame = progress < 1 ? requestAnimationFrame(animate) : 0;
      };
      resetFrame = requestAnimationFrame(animate);
    };

    const activeIndex = () => {
      const index = links.findIndex((link) => link.classList.contains('active'));
      if (index >= 0) return index;
      return location.pathname.startsWith('/week') ? 0 : -1;
    };

    const setActive = (index: number) => {
      links.forEach((link, current) => {
        const active = current === index;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
    };

    const measure = () => {
      const index = activeIndex();
      if (index < 0) return;
      const barBox = bar.getBoundingClientRect();
      const box = links[index].getBoundingClientRect();
      currentW = box.width;
      currentX = box.left - barBox.left;
      indicator.style.setProperty('--indicator-x', `${currentX}px`);
      indicator.style.setProperty('--indicator-y', `${box.top - barBox.top}px`);
      indicator.style.setProperty('--indicator-w', `${currentW}px`);
      indicator.style.setProperty('--indicator-h', `${box.height}px`);
    };

    const dragLimits = () => {
      const barBox = bar.getBoundingClientRect();
      const first = links[0].getBoundingClientRect();
      const last = links[links.length - 1].getBoundingClientRect();
      return {
        min: first.left - barBox.left,
        max: last.right - barBox.left - currentW
      };
    };

    const nearestIndex = () => {
      const barBox = bar.getBoundingClientRect();
      const indicatorCenter = currentX + currentW / 2;
      let best = 0;
      let bestDistance = Infinity;
      links.forEach((link, index) => {
        const box = link.getBoundingClientRect();
        const distance = Math.abs(
          box.left + box.width / 2 - barBox.left - indicatorCenter
        );
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      return best;
    };

    // 松手吸附到最近菜单项（示例 setIndicatorPosition + 导航适配）。
    const snapTo = (index: number) => {
      const barBox = bar.getBoundingClientRect();
      const box = links[index].getBoundingClientRect();
      currentW = box.width;
      currentX = box.left - barBox.left;
      indicator.style.setProperty('--indicator-x', `${currentX}px`);
      indicator.style.setProperty('--indicator-w', `${currentW}px`);
      setActive(index);
      const href = links[index].getAttribute('href');
      if (href && href !== location.pathname) navigate(href);
    };

    const onMove = (event: PointerEvent) => {
      if (pointerDown && !dragging && Math.abs(event.clientX - dragStartX) > 4) {
        dragging = true;
        dragMoved = true;
        bar.classList.add('is-dragging');
        bar.setPointerCapture(event.pointerId);
      }

      if (dragging) {
        const limits = dragLimits();
        currentX = clamp(
          dragStartPosition + (event.clientX - dragStartX),
          limits.min,
          limits.max
        );
        indicator.style.setProperty('--indicator-x', `${currentX}px`);
        setActive(nearestIndex());

        const movementPixels = event.clientX - previousPointerX;
        const targetStretch = clamp(1 + Math.abs(movementPixels) * 0.035, 1, 1.32);
        dragStretch += (targetStretch - dragStretch) * 0.58;
        const squash = 1 - (dragStretch - 1) * 0.48;
        const skew = clamp(movementPixels * 0.8, -8, 8);
        indicator.style.setProperty('--drag-scale-x', dragStretch.toFixed(3));
        indicator.style.setProperty('--drag-scale-y', squash.toFixed(3));
        indicator.style.setProperty('--drag-skew', `${skew.toFixed(2)}deg`);
        previousPointerX = event.clientX;
        dragMoved = true;
      }

      cancelReset();
      // 光源以滑块自身 bounds 计算（示例一致）。
      const bounds = indicator.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) {
        setLight(
          clamp(((event.clientX - bounds.left) / bounds.width) * 100, 0, 100),
          clamp(((event.clientY - bounds.top) / bounds.height) * 100, 0, 100)
        );
      }
    };

    const onDown = (event: PointerEvent) => {
      if (event.button !== undefined && event.button !== 0) return;
      pointerDown = true;
      dragging = false;
      dragMoved = false;
      dragStartX = event.clientX;
      previousPointerX = event.clientX;
      const bounds = indicator.getBoundingClientRect();
      const grabbedIndicator =
        event.clientX >= bounds.left && event.clientX <= bounds.right;
      if (grabbedIndicator) {
        dragStartPosition = currentX;
      } else {
        // 未按住滑块时：从指针下方的位置开始拖（示例 getPointerPosition）。
        const limits = dragLimits();
        dragStartPosition = clamp(
          event.clientX - bar.getBoundingClientRect().left - currentW / 2,
          limits.min,
          limits.max
        );
      }
      dragStretch = 1;
      indicator.style.setProperty('--drag-scale-x', '1');
      indicator.style.setProperty('--drag-scale-y', '1');
      indicator.style.setProperty('--drag-skew', '0deg');
      cancelReset();
    };

    const finishDrag = (event: PointerEvent, suppressIfCancelled: boolean) => {
      if (!pointerDown) return;
      if (dragging) snapTo(nearestIndex());
      indicator.style.setProperty('--drag-scale-x', '1');
      indicator.style.setProperty('--drag-scale-y', '1');
      indicator.style.setProperty('--drag-skew', '0deg');
      dragStretch = 1;
      pointerDown = false;
      dragging = false;
      bar.classList.remove('is-dragging');
      if (dragMoved && bar.hasPointerCapture(event.pointerId)) {
        bar.releasePointerCapture(event.pointerId);
      }
      suppressClickRef.current = suppressIfCancelled ? true : dragMoved;
      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };

    const onUp = (event: PointerEvent) => finishDrag(event, false);
    const onCancel = (event: PointerEvent) => finishDrag(event, true);

    // 拖拽后的下一次 click 不应再跳到指针所在的其他链接（document 捕获先于 React）。
    const onClickCapture = (event: Event) => {
      if (suppressClickRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressClickRef.current = false;
      }
    };

    const onResize = () => measure();

    bar.addEventListener('pointermove', onMove);
    bar.addEventListener('pointerdown', onDown);
    bar.addEventListener('pointerup', onUp);
    bar.addEventListener('pointercancel', onCancel);
    bar.addEventListener('pointerleave', resetLight);
    document.addEventListener('click', onClickCapture, true);
    window.addEventListener('resize', onResize);
    measure();
    return () => {
      cancelReset();
      window.clearTimeout(resetTimer);
      bar.classList.remove('is-dragging');
      bar.removeEventListener('pointermove', onMove);
      bar.removeEventListener('pointerdown', onDown);
      bar.removeEventListener('pointerup', onUp);
      bar.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('resize', onResize);
      bar.removeEventListener('pointerleave', resetLight);
      document.removeEventListener('click', onClickCapture, true);
      // suppressClickRef 故意不在这里清除：拖拽松手会同步触发路由更新并重挂载本
      // effect，随后的 click 仍需被吞掉；由 setTimeout 统一复位。
    };
  }, [location.pathname, me.data?.user.id, navigate]);
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
        <nav>
          {links.map(([to, Icon, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              draggable={false}
              className={() => {
                const active =
                  to === '/'
                    ? location.pathname === '/' ||
                      location.pathname.startsWith('/week')
                    : location.pathname === to;
                return active ? 'active' : '';
              }}
            >
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
