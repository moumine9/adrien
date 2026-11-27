import type { MetaResponse } from '@adrien/api/contract';
import { Columns3, FolderTree, GitBranch, HeartPulse, ListChecks, Moon, Settings, Sun, Waypoints } from 'lucide-react';
import { Suspense, useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Button } from '@/components/ui/button.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { useFlatApiHeld, useMeta } from '@/lib/queries.ts';
import { useApplyTheme, useTheme } from '@/lib/theme.ts';
import { cn } from '@/lib/utils.ts';
import { useWorkspacePath } from '@/lib/workspace.ts';
import { BrandMark } from './brand-mark.tsx';
import { ChangeToast } from './change-toast.tsx';
import { DemoBanner } from './demo-banner.tsx';
import { LoadingBar } from './loading-bar.tsx';
import { LoadingBlocks } from './states.tsx';
import { UnverifiedBanner } from './unverified-banner.tsx';
import { WorkspaceSwitcher } from './workspace-switcher.tsx';

const NAV = [
  { to: '/', label: 'Decisions', icon: ListChecks, end: true },
  { to: '/board', label: 'Board', icon: Columns3, end: false },
  { to: '/graph', label: 'Graph', icon: Waypoints, end: false },
  { to: '/files', label: 'Files', icon: FolderTree, end: false },
  { to: '/check', label: 'Health', icon: HeartPulse, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
] as const;

function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <Button
      variant="neutral"
      size="icon"
      onClick={() => setTheme(next)}
      aria-label={`Use the ${next} theme`}
      title={`Use the ${next} theme`}
    >
      {theme === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}

/** Where statuses come from: the default branch they are checked against, or a plain reading of the files. */
function BaseRef({ meta }: { meta: MetaResponse }) {
  const unverified = meta.baseUnresolved || meta.forkUnresolved;
  const label = meta.mode === 'files' ? 'Files only' : unverified ? 'Unverified' : (meta.baseRef ?? 'Default branch');
  const title =
    meta.mode === 'files'
      ? 'Not a git repository: statuses are read as written.'
      : unverified
        ? 'Statuses could not be checked against a default branch.'
        : `Statuses are checked against ${meta.baseRef}.`;
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-10 max-w-48 items-center gap-2 frame px-4 text-sm font-semibold',
        unverified ? 'bg-caution text-ink' : 'bg-background',
      )}
    >
      <GitBranch aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
      <span className="sr-only">Base: </span>
      <span className={cn('truncate', !unverified && meta.mode === 'git' && 'font-mono text-[0.8125rem]')}>
        {label}
      </span>
    </span>
  );
}

/** After a client-side navigation, start at the top and move focus to the new page, as a full load would. */
function useRouteFocus() {
  const { pathname } = useLocation();
  const previous = useRef(pathname);
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    document.documentElement.scrollTop = 0;
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [pathname]);
}

export function Layout() {
  const meta = useMeta();
  const held = useFlatApiHeld();
  const { pathname } = useLocation();
  const wp = useWorkspacePath();
  useRouteFocus();
  useApplyTheme();
  return (
    <div className="flex min-h-dvh flex-col">
      {/* A button, not an anchor: the router owns the hash, so `#main` would replace the current route with `/main`. */}
      <button
        type="button"
        onClick={() => document.getElementById('main')?.focus()}
        className="sr-only z-50 panel px-4 py-2 font-heading focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to content
      </button>
      <header className="relative border-b-4 border-border bg-secondary-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-4 px-4 py-4 sm:px-6">
          <Link
            to={wp('/')}
            className="flex items-center gap-2 rounded-base text-[1.75rem] leading-none font-black tracking-[-0.02em]"
            style={{ fontStretch: '125%' }}
          >
            <BrandMark className="size-9 shrink-0" />
            Adrien
          </Link>
          <WorkspaceSwitcher />
          <nav aria-label="Main" className="order-last w-full lg:order-none lg:w-auto">
            <ul className="grid grid-cols-3 gap-2 lg:flex">
              {NAV.map(({ to, label, icon: Icon, end }) => (
                <li key={to}>
                  <NavLink
                    to={wp(to)}
                    end={end}
                    className={({ isActive }) =>
                      cn(
                        'inline-flex h-10 w-full items-center justify-center gap-2 rounded-base border-2 px-2 font-heading whitespace-nowrap sm:px-4 lg:w-auto',
                        isActive || (to === '/' && pathname.startsWith(wp('/adr/')))
                          ? 'border-border bg-main text-main-foreground shadow-shadow'
                          : 'border-transparent hover:border-border hover:bg-background',
                      )
                    }
                  >
                    <Icon aria-hidden className="hidden size-4 opacity-70 sm:block" strokeWidth={2} />
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {meta.data ? (
              <BaseRef meta={meta.data} />
            ) : meta.isPending && !held ? (
              <Skeleton className="h-10 w-28" />
            ) : null}
            <ThemeToggle />
          </div>
        </div>
        <LoadingBar />
      </header>
      {import.meta.env.MODE === 'demo' && <DemoBanner />}
      {meta.data && <UnverifiedBanner meta={meta.data} />}
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 outline-none sm:px-6 sm:py-10">
        <Suspense fallback={<LoadingBlocks label="Loading" count={2} />}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="border-t-2 border-border">
        <div className="mx-auto max-w-6xl px-4 py-4 text-sm text-muted-foreground sm:px-6">
          {meta.data
            ? `${meta.data.product} ${meta.data.version}, workspace ${meta.data.workspace}, reading ${meta.data.adrDir}. This view is read-only.`
            : 'This view is read-only.'}
        </div>
      </footer>
      <ChangeToast />
    </div>
  );
}
