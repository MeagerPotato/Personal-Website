/**
 * Route → screen. Every screen but the calendar loads when first opened. The day brings the
 * editor with it, half the app's code, so it is fetched as soon as the app starts (preloadDay):
 * the lock screen shows without it, and the passkey prompt covers the wait.
 */
import { lazy, Suspense } from 'react';
import { today } from '../model/dates';
import { CalendarScreen } from '../screens/Calendar';
import { Missing } from '../screens/Missing';
import type { Route } from './router';

const loadDay = () => import('../screens/Day');
const DayScreen = lazy(() => loadDay().then((m) => ({ default: m.DayScreen })));

/** Starts fetching the day screen and the editor. */
export function preloadDay(): void {
  void loadDay();
}

const Timeline = lazy(() =>
  import('../screens/Timeline').then((m) => ({ default: m.TimelineScreen })),
);
const EventScreen = lazy(() =>
  import('../screens/Event').then((m) => ({ default: m.EventScreen })),
);
const Stats = lazy(() => import('../screens/Stats').then((m) => ({ default: m.StatsScreen })));
const MonthScreen = lazy(() =>
  import('../screens/Month').then((m) => ({ default: m.MonthScreen })),
);
const People = lazy(() => import('../screens/People').then((m) => ({ default: m.PeopleScreen })));
const PersonScreen = lazy(() =>
  import('../screens/People').then((m) => ({ default: m.PersonScreen })),
);
const Places = lazy(() => import('../screens/People').then((m) => ({ default: m.PlacesScreen })));
const PlaceScreen = lazy(() =>
  import('../screens/People').then((m) => ({ default: m.PlaceScreen })),
);
const Search = lazy(() => import('../screens/Search').then((m) => ({ default: m.SearchScreen })));
const Settings = lazy(() =>
  import('../screens/Settings').then((m) => ({ default: m.SettingsScreen })),
);

function Routed({ route }: { route: Route }) {
  switch (route.name) {
    case 'today':
      return <DayScreen date={today()} />;
    case 'day':
      return route.date > today() ? <Missing future /> : <DayScreen date={route.date} />;
    case 'calendar':
      return <CalendarScreen month={route.month} />;
    case 'month':
      return <MonthScreen month={route.month} />;
    case 'timeline':
      return <Timeline />;
    case 'event':
      return <EventScreen id={route.id} />;
    case 'stats':
      return <Stats />;
    case 'people':
      return <People />;
    case 'person':
      return <PersonScreen id={route.id} />;
    case 'places':
      return <Places />;
    case 'place':
      return <PlaceScreen id={route.id} />;
    case 'search':
      return <Search />;
    case 'settings':
      return <Settings section={route.section} />;
    case 'missing':
      return <Missing />;
  }
}

export function Screen({ route }: { route: Route }) {
  return (
    <Suspense fallback={<div className="page" aria-busy="true" />}>
      <Routed route={route} />
    </Suspense>
  );
}
