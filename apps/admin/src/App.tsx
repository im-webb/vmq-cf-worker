import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard,
  LogOut,
  Menu,
  QrCode,
  Receipt,
  ScrollText,
  Settings,
  UserCog,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Brand } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { Toaster } from '@/components/ui/toaster';
import { api, UnauthorizedError, type Me } from '@/lib/api';
import { cn } from '@/lib/utils';
import { LoginPage } from '@/pages/login';
import { useMe } from '@/lib/use-me';

// 页面按需加载：首屏只下登录 + 概览，其余点开才拉取对应 chunk
const DashboardPage = lazy(() => import('@/pages/dashboard').then((m) => ({ default: m.DashboardPage })));
const OrdersPage = lazy(() => import('@/pages/orders').then((m) => ({ default: m.OrdersPage })));
const PassagesPage = lazy(() => import('@/pages/passages').then((m) => ({ default: m.PassagesPage })));
const QrcodesPage = lazy(() => import('@/pages/qrcodes').then((m) => ({ default: m.QrcodesPage })));
const LogsPage = lazy(() => import('@/pages/logs').then((m) => ({ default: m.LogsPage })));
const AdminsPage = lazy(() => import('@/pages/admins').then((m) => ({ default: m.AdminsPage })));
const ConfigPage = lazy(() => import('@/pages/config').then((m) => ({ default: m.ConfigPage })));
const ProfilePage = lazy(() => import('@/pages/profile').then((m) => ({ default: m.ProfilePage })));

function PageFallback() {
  return <p className="text-sm text-muted-foreground">加载中…</p>;
}

/** 侧边栏分组；顺序即导航顺序 */
const NAV: Array<{
  group: string;
  items: Array<{ path: string; label: string; icon: typeof Menu }>;
}> = [
  { group: '', items: [{ path: '/', label: '概览', icon: LayoutDashboard }] },
  {
    group: '交易',
    items: [
      { path: '/orders', label: '订单管理', icon: Receipt },
      { path: '/passages', label: '通道管理', icon: Wallet },
      { path: '/qrcodes', label: '固定金额码', icon: QrCode },
    ],
  },
  {
    group: '系统',
    items: [
      { path: '/logs', label: '操作日志', icon: ScrollText },
      { path: '/admins', label: '管理员', icon: UserCog },
      { path: '/config', label: '系统配置', icon: Settings },
    ],
  },
];


function NavItems({ superOnly, onNavigate }: { superOnly: boolean; onNavigate?: () => void }) {
  return (
    <>
      {NAV.map((section) => {
        const items = section.items.filter(
          (item) => superOnly || (item.path !== '/admins' && item.path !== '/config')
        );
        if (!items.length) return null;
        return (
        <div key={section.group || 'main'} className="mb-1">
          {section.group ? (
            <p className="px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">
              {section.group}
            </p>
          ) : null}
          {items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex h-9 items-center gap-2 rounded-md px-3 text-sm transition-colors',
                  isActive
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-foreground hover:bg-muted'
                )
              }
            >
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
        </div>
        );
      })}
    </>
  );
}

function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  async function logout() {
    try {
      await api.post('/logout');
    } finally {
      qc.clear();
      navigate('/login', { replace: true });
    }
  }

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r border-border bg-card md:flex">
        <div className="flex h-14 items-center border-b border-border px-4">
          <Brand markClassName="size-7" />
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto p-3">
          <NavItems superOnly={me.role === 1} />
        </nav>
        <div className="border-t border-border p-3">
          <div className="mb-1 flex items-center gap-1">
            <NavLink
              to="/profile"
              className={({ isActive }) =>
                cn(
                  'flex h-9 flex-1 items-center gap-2 rounded-md px-3 text-sm transition-colors',
                  isActive ? 'bg-accent font-medium text-accent-foreground' : 'hover:bg-muted'
                )
              }
            >
              {/* 有头像就显示头像，没设置回退到图标；size-5 + 负边距是为了让
                  图标/头像的视觉左边缘和上面 nav 项的 size-4 图标对齐 */}
              {me.head_img ? (
                <img
                  src={me.head_img}
                  alt=""
                  className="-ml-0.5 size-5 shrink-0 rounded-full object-cover"
                />
              ) : (
                <UserCog className="size-4" />
              )}
              <span className="truncate">{me.username}</span>
            </NavLink>
            <ThemeToggle />
          </div>
          {/* 与上一行的 nav 项对齐：同样的 px-3 / gap-2 / size-4，图标左边缘才对得上 */}
          <Button variant="ghost" className="w-full justify-start px-3" onClick={logout}>
            <LogOut className="size-4" /> 退出
          </Button>
        </div>
      </aside>

      <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-border bg-card px-4 md:hidden">
        <Button variant="ghost" size="icon" onClick={() => setOpen((v) => !v)} aria-label="菜单">
          <Menu />
        </Button>
        <Brand markClassName="size-7" />
        <ThemeToggle className="ml-auto" />
        <Button variant="ghost" size="icon" onClick={logout} aria-label="退出">
          <LogOut />
        </Button>
      </header>
      {open ? (
        <nav className="border-b border-border bg-card p-3 md:hidden">
          <NavItems superOnly={me.role === 1} onNavigate={() => setOpen(false)} />
        </nav>
      ) : null}

      <main className="p-5 md:pl-[15.5rem]">{children}</main>
    </div>
  );
}

function Guarded() {
  const { data: me, isLoading, error } = useMe();
  const navigate = useNavigate();

  useEffect(() => {
    if (error instanceof UnauthorizedError) navigate('/login', { replace: true });
  }, [error, navigate]);

  if (isLoading) return <p className="p-8 text-sm text-muted-foreground">加载中…</p>;
  if (!me) return <Navigate to="/login" replace />;

  return (
    <Shell me={me}>
      <Suspense fallback={<PageFallback />}>
        <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/passages" element={<PassagesPage />} />
        <Route path="/qrcodes" element={<QrcodesPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/admins" element={me.role === 1 ? <AdminsPage /> : <Navigate to="/" replace />} />
        <Route path="/config" element={me.role === 1 ? <ConfigPage /> : <Navigate to="/" replace />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}

function App() {
  const qc = useQueryClient();

  return (
    <Routes>
      <Route
        path="/login"
        element={
          <LoginPage
            onLogin={(me) => {
              qc.setQueryData(['me'], me);
            }}
          />
        }
      />
      <Route path="/*" element={<Guarded />} />
    </Routes>
  );
}

/** 根组件：路由 + 全局 Toast */
export function Root() {
  return (
    <>
      <App />
      <Toaster />
    </>
  );
}
