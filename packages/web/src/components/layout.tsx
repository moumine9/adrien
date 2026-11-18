import type { MetaResponse } from '@adrien/api/contract';
import { FolderTree, GitBranch, HeartPulse, ListChecks, Moon, Sun, TriangleAlert, Waypoints } from 'lucide-react';
import { Suspense, useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Button } from '@/components/ui/button.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { useMeta } from '@/lib/queries.ts';
import { useTheme } from '@/lib/theme.ts';
import { cn } from '@/lib/utils.ts';
import { BrandMark } from './brand-mark.tsx';
import { LoadingBlocks } from './states.tsx';

const NAV = [
  { to: '/', label: 'Decisions', icon: ListChecks, end: true },
  { to: '/graph', label: 'Graph', icon: Waypoints, end: false },
  { to: '/files', label: 'Files', icon: FolderTree, end: false },
  { to: '/check', label: 'Health', icon: HeartPulse, end: false },
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
        'inline-flex h-10 max-w-48 items-center gap-1.5 rounded-base border-2 border-border px-2.5 text-sm font-semibold',
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

function UnverifiedBanner({ meta }: { meta: MetaResponse }) {
  if (!meta.baseUnresolved && !meta.forkUnresolved) return null;
  return (
    <div role="alert" className="border-b-4 border-border bg-secondary-background">
      <div aria-hidden className="caution-tape h-2.5 border-b-2 border-border" />
      <div className="mx-auto flex max-w-6xl gap-3 px-4 py-4 sm:px-6">
        <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={2.5} />
        {meta.baseUnresolved ? (
          <p className="max-w-[80ch]">
            <strong className="font-heading">No default branch found.</strong> Statuses are read as written, so nothing
            here is verified as binding: an ADR marked accepted may never have been merged. Fetch the default branch
            (for example <code className="font-mono text-[0.875em]">git fetch origin</code>), then reload.
          </p>
        ) : (
          <p className="max-w-[80ch]">
            <strong className="font-heading">This checkout shares no history with the default branch.</strong> Pending
            changes cannot be told apart from merged ones, so nothing here is verified as binding. Fetch more history
            (for example <code className="font-mono text-[0.875em]">git fetch --unshallow</code>), then reload.
          </p>
        )}
      </div>
    </div>
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
  const { pathname } = useLocation();
  useRouteFocus();
  return (
    <div className="flex min-h-dvh flex-col">
      {/* A button, not an anchor: the router owns the hash, so `#main` would replace the current route with `/main`. */}
      <button
        type="button"
        onClick={() => document.getElementById('main')?.focus()}
        className="sr-only z-50 rounded-base border-2 border-border bg-secondary-background px-4 py-2 font-heading focus:not-sr-only focus:absolute focus:top-3 focus:left-3"
      >
        Skip to content
      </button>
      <header className="border-b-4 border-border bg-secondary-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="flex items-center gap-2.5 rounded-base text-[1.75rem] leading-none font-black tracking-[-0.02em]"
            style={{ fontStretch: '125%' }}
          >
            <BrandMark className="size-9 shrink-0" />
            Adrien
          </Link>
          <nav aria-label="Main" className="order-last -mx-1 w-full overflow-x-auto px-1 pb-1 md:order-none md:w-auto">
            <ul className="flex gap-2">
              {NAV.map(({ to, label, icon: Icon, end }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      cn(
                        'inline-flex h-10 items-center gap-2 rounded-base border-2 px-2.5 font-heading whitespace-nowrap sm:px-3',
                        isActive || (to === '/' && pathname.startsWith('/adr/'))
                          ? 'border-border bg-main text-main-foreground shadow-shadow'
                          : 'border-transparent hover:border-border hover:bg-background',
                      )
                    }
                  >
                    <Icon aria-hidden className="hidden size-4 sm:block" strokeWidth={2.5} />
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {meta.data ? <BaseRef meta={meta.data} /> : meta.isPending ? <Skeleton className="h-10 w-28" /> : null}
            <ThemeToggle />
          </div>
        </div>
      </header>
      {meta.data && <UnverifiedBanner meta={meta.data} />}
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 outline-none sm:px-6 sm:py-10">
        <Suspense fallback={<LoadingBlocks label="Loading" count={2} />}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="border-t-2 border-border">
        <div className="mx-auto max-w-6xl px-4 py-4 text-sm text-muted-foreground sm:px-6">
          {meta.data
            ? `${meta.data.product} ${meta.data.version}, reading ${meta.data.adrDir}. This view is read-only.`
            : 'This view is read-only.'}
        </div>
      </footer>
    </div>
  );
}
