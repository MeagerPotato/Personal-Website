/**
 * The journal's frame: Notion's sidebar on a wide screen, a tab bar on a phone, and the screen
 * the URL names. The sync status lives in the sidebar (and in the phone's "More" sheet).
 */
import {
  BarChart3,
  CalendarDays,
  Ellipsis,
  Lock,
  MapPin,
  Milestone,
  Search,
  Settings as SettingsIcon,
  Sun,
  Users,
} from 'lucide-react';
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { prepareOnlineUnlock, signInAgain } from '../account/account';
import type { SyncStatus } from '../journal/journal';
import { Bean } from '../ui/Bean';
import { describe } from '../ui/common';
import { useJournal, useLock } from './context';
import { follow, parseRoute, paths, usePath, useScreenKey, type Route } from './router';
import { Screen } from './Screen';

interface NavItem {
  label: string;
  href: string;
  icon: ComponentType<{ 'aria-hidden'?: boolean }>;
  match: (route: Route) => boolean;
}

const NAV: NavItem[] = [
  {
    label: 'Today',
    href: paths.today(),
    icon: Sun,
    match: (route) => route.name === 'today' || route.name === 'day',
  },
  {
    label: 'Calendar',
    href: paths.calendar(),
    icon: CalendarDays,
    match: (route) => route.name === 'calendar' || route.name === 'month',
  },
  {
    label: 'Timeline',
    href: paths.timeline(),
    icon: Milestone,
    match: (route) => route.name === 'timeline' || route.name === 'event',
  },
  {
    label: 'Stats',
    href: paths.stats(),
    icon: BarChart3,
    match: (route) => route.name === 'stats',
  },
  {
    label: 'People',
    href: paths.people(),
    icon: Users,
    match: (route) => route.name === 'people' || route.name === 'person',
  },
  {
    label: 'Places',
    href: paths.places(),
    icon: MapPin,
    match: (route) => route.name === 'places' || route.name === 'place',
  },
  {
    label: 'Search',
    href: paths.search(),
    icon: Search,
    match: (route) => route.name === 'search',
  },
  {
    label: 'Settings',
    href: paths.settings(),
    icon: SettingsIcon,
    match: (route) => route.name === 'settings',
  },
];

/** The phone's tab bar shows the first four; the rest are under "More". */
const TABS = 4;

function NavLink({ item, route, onClick }: { item: NavItem; route: Route; onClick?: () => void }) {
  const Icon = item.icon;
  const current = item.match(route);
  return (
    <a
      className="nav-link"
      href={item.href}
      aria-current={current ? 'page' : undefined}
      onClick={(event) => {
        follow(event);
        onClick?.();
      }}
    >
      <Icon aria-hidden />
      <span>{item.label}</span>
    </a>
  );
}

/** The rollback check found the server short of what this device knows is there (journal.ts). */
const missing = (status: SyncStatus): boolean =>
  status.state === 'idle' && (status.behind > 0 || status.withheld > 0);

function syncWords(status: SyncStatus): string {
  const waiting = status.pending === 1 ? '1 change to sync' : `${status.pending} changes to sync`;
  switch (status.state) {
    case 'syncing':
      return 'Syncing…';
    case 'offline':
      return status.pending > 0 ? `Offline · ${waiting}` : 'Offline · all saved here';
    case 'signed-out':
      return 'Sign in to sync';
    case 'error':
      return status.pending > 0 ? `Sync failed · ${waiting}` : 'Sync failed · retrying';
    case 'idle':
      if (missing(status)) return 'Server missing changes';
      if (status.pending > 0) return `Saved here · ${waiting}`;
      return status.lastSyncedAt ? 'Synced' : 'Not synced yet';
  }
}

/** `onNavigate`: the phone's sheet closes when its link to the details is followed. */
function SyncStatusLine({ onNavigate }: { onNavigate?: () => void }) {
  const journal = useJournal();
  const status = journal.status;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ticket = useRef<Awaited<ReturnType<typeof prepareOnlineUnlock>> | null>(null);

  useEffect(() => {
    if (status.state !== 'signed-out') return;
    void prepareOnlineUnlock()
      .then((next) => (ticket.current = next))
      .catch(() => (ticket.current = null));
  }, [status.state]);

  return (
    <div className="sync" data-state={status.state} data-missing={missing(status) || undefined}>
      <span className="sync__dot" aria-hidden="true" />
      <span className="sync__words" role="status">
        {syncWords(status)}
      </span>
      {status.state === 'signed-out' ? (
        <button
          type="button"
          className="button button--quiet sync__action"
          disabled={busy}
          onClick={() => {
            const current = ticket.current;
            if (!current) return;
            setBusy(true);
            signInAgain(current)
              .then(() => journal.resume())
              .catch((caught: unknown) => setError(describe(caught)))
              .finally(() => setBusy(false));
          }}
        >
          Sign in
        </button>
      ) : null}
      {missing(status) ? (
        <a
          className="button button--quiet sync__action"
          href={paths.settings('data')}
          onClick={(event) => {
            follow(event);
            onNavigate?.();
          }}
        >
          Details
        </a>
      ) : null}
      {error ? <span className="visually-hidden">{error}</span> : null}
    </div>
  );
}

function Sidebar({ route }: { route: Route }) {
  const lock = useLock();
  return (
    <nav className="sidebar" aria-label="Journal">
      <div className="sidebar__head">
        <Bean mood={4} family="mint" size={24} />
        <span>Allen’s journal</span>
      </div>
      <div className="sidebar__list">
        {NAV.map((item) => (
          <NavLink key={item.href} item={item} route={route} />
        ))}
      </div>
      <div className="sidebar__foot">
        <SyncStatusLine />
        <button type="button" className="nav-link" onClick={lock}>
          <Lock aria-hidden />
          <span>Lock</span>
        </button>
      </div>
    </nav>
  );
}

/**
 * The phone's tab bar. "More" opens the rest as a popover: the browser closes it on Escape or a
 * tap outside, and puts it next to its button in the tab order.
 */
function TabBar({ route }: { route: Route }) {
  const lock = useLock();
  const sheet = useRef<HTMLElement>(null);
  const moreActive = NAV.slice(TABS).some((item) => item.match(route));
  const close = () => sheet.current?.hidePopover();

  return (
    <>
      <nav className="tabbar" aria-label="Journal">
        {NAV.slice(0, TABS).map((item) => (
          <NavLink key={item.href} item={item} route={route} />
        ))}
        <button
          type="button"
          className="nav-link"
          aria-current={moreActive ? 'page' : undefined}
          popoverTarget="more"
        >
          <Ellipsis aria-hidden />
          <span>More</span>
        </button>
      </nav>
      <nav ref={sheet} id="more" className="sheet" popover="auto" aria-label="More">
        <div className="sheet__body">
          {NAV.slice(TABS).map((item) => (
            <NavLink key={item.href} item={item} route={route} onClick={close} />
          ))}
          <button
            type="button"
            className="nav-link"
            onClick={() => {
              close();
              lock();
            }}
          >
            <Lock aria-hidden />
            <span>Lock</span>
          </button>
          <SyncStatusLine onNavigate={close} />
        </div>
      </nav>
    </>
  );
}

export function Shell(): ReactNode {
  const path = usePath();
  const screen = useScreenKey();
  const route = parseRoute(path);
  return (
    <div className="shell">
      <Sidebar route={route} />
      <main className="main" id="main">
        <Screen route={route} key={screen} />
      </main>
      <TabBar route={route} />
    </div>
  );
}
