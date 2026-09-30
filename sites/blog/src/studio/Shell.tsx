/**
 * The studio's frame: the journal's (the shared app.css), Notion's sidebar on a wide screen and a
 * tab bar on a phone, with the screen the address names. The overview (posts, comments waiting,
 * email) is loaded here and refreshed on every move, so the sidebar's count stays true.
 */
import {
  ExternalLink,
  FileText,
  LogOut,
  Mail,
  MessageSquare,
  Settings as SettingsIcon,
  Tags,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { api, type Overview } from './api';
import { OverviewContext } from './data';
import { follow, hrefFor, useRoute, type Route } from './router';
import { Comments } from './screens/Comments';
import { Missing } from './screens/Missing';
import { Organize } from './screens/Organize';
import { PostEditor } from './screens/PostEditor';
import { Posts } from './screens/Posts';
import { Settings } from './screens/Settings';
import { Subscribers } from './screens/Subscribers';
import { useSignOut } from './signOut';

interface NavItem {
  label: string;
  route: Route;
  icon: ComponentType<{ 'aria-hidden'?: boolean }>;
  match: (route: Route) => boolean;
}

const NAV: NavItem[] = [
  {
    label: 'Posts',
    route: { name: 'posts' },
    icon: FileText,
    match: (route) => route.name === 'posts' || route.name === 'post',
  },
  {
    label: 'Comments',
    route: { name: 'comments' },
    icon: MessageSquare,
    match: (route) => route.name === 'comments',
  },
  {
    label: 'Subscribers',
    route: { name: 'subscribers' },
    icon: Mail,
    match: (route) => route.name === 'subscribers',
  },
  {
    label: 'Organize',
    route: { name: 'organize' },
    icon: Tags,
    match: (route) => route.name === 'organize',
  },
  {
    label: 'Settings',
    route: { name: 'settings' },
    icon: SettingsIcon,
    match: (route) => route.name === 'settings',
  },
];

function NavLink({ item, route, count }: { item: NavItem; route: Route; count: number }) {
  const Icon = item.icon;
  return (
    <a
      className="nav-link"
      href={hrefFor(item.route)}
      aria-current={item.match(route) ? 'page' : undefined}
      onClick={follow}
    >
      <Icon aria-hidden />
      <span>{item.label}</span>
      {count > 0 ? (
        <span className="nav-link__count">
          {count}
          <span className="visually-hidden"> waiting</span>
        </span>
      ) : null}
    </a>
  );
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'posts':
      return <Posts />;
    case 'post':
      return <PostEditor key={route.id} id={route.id} />;
    case 'comments':
      return <Comments />;
    case 'subscribers':
      return <Subscribers />;
    case 'organize':
      return <Organize />;
    case 'settings':
      return <Settings />;
    case 'missing':
      return <Missing />;
  }
}

export function Shell({ onSignOut }: { onSignOut: () => void }) {
  const route = useRoute();
  const [overview, setOverview] = useState<Overview | null>(null);
  const signOut = useSignOut(onSignOut);

  // A failure to load it is shown by the screen that needs the data; the frame carries on.
  const refresh = useCallback(async () => {
    const next = await api.overview().catch(() => null);
    if (next) setOverview(next);
  }, []);

  // On every move, and on coming back to the tab (a comment may have arrived meanwhile).
  useEffect(() => {
    let live = true;
    const load = () => {
      api.overview().then(
        (next) => {
          if (live) setOverview(next);
        },
        () => undefined,
      );
    };
    load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [route.name]);

  const pending = overview?.pendingComments ?? 0;
  const counts = (item: NavItem) => (item.route.name === 'comments' ? pending : 0);

  return (
    <OverviewContext value={{ overview, refresh }}>
      <div className="shell studio">
        <nav className="sidebar" aria-label="Studio">
          <div className="sidebar__head">
            <img src="/icon.svg" alt="" width={24} height={24} />
            <span>Studio</span>
          </div>
          <div className="sidebar__list">
            {NAV.map((item) => (
              <NavLink key={item.label} item={item} route={route} count={counts(item)} />
            ))}
          </div>
          <div className="sidebar__foot">
            <a className="nav-link" href="/" target="_blank" rel="noopener">
              <ExternalLink aria-hidden />
              <span>View the blog</span>
            </a>
            <button type="button" className="nav-link" onClick={signOut.start}>
              <LogOut aria-hidden />
              <span>Sign out</span>
            </button>
          </div>
        </nav>
        <main className="main" id="main">
          <Screen route={route} />
        </main>
        <nav className="tabbar" aria-label="Studio">
          {NAV.map((item) => (
            <NavLink key={item.label} item={item} route={route} count={counts(item)} />
          ))}
        </nav>
        {signOut.dialog}
      </div>
    </OverviewContext>
  );
}
