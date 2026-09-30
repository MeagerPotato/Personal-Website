/**
 * Life events on one line: firsts, milestones, trips, the days that mark a chapter. Newest
 * first, grouped by year; milestones drawn larger.
 */
import { Plus } from 'lucide-react';
import { useJournal } from '../app/context';
import { follow, paths } from '../app/router';
import { shortDate, today } from '../model/dates';
import { plainText } from '../model/stats';
import { Title } from '../ui/common';

export function TimelineScreen() {
  const journal = useJournal();
  const current = today();
  const events = journal
    .events()
    .toSorted(([, a], [, b]) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const years = new Map<string, typeof events>();
  for (const entry of events) {
    const year = entry[1].date.slice(0, 4);
    years.set(year, [...(years.get(year) ?? []), entry]);
  }

  return (
    <article className="page timeline">
      <header className="page__head page__head--row">
        <div>
          <p className="page__overline">Life events</p>
          <Title className="page__title">Timeline</Title>
        </div>
        <a className="button button--primary" href={paths.event(null)} onClick={follow}>
          <Plus aria-hidden="true" />
          New event
        </a>
      </header>

      {events.length === 0 ? (
        <div className="empty-hint">
          <p className="muted">
            The days that mark a chapter: a first launch, a move, a trip, a friend made. Add one,
            and it shows here in order.
          </p>
        </div>
      ) : (
        [...years].map(([year, list]) => (
          <section key={year} className="timeline__year" aria-label={year}>
            <h2 className="timeline__label">{year}</h2>
            <ol className="timeline__list">
              {list.map(([id, event]) => (
                <li
                  key={id}
                  className="timeline__item"
                  data-weight={event.weight}
                  data-family={event.family}
                >
                  <span className="timeline__node" aria-hidden="true">
                    {event.icon}
                  </span>
                  <a className="timeline__card" href={paths.event(id)} onClick={follow}>
                    <span className="timeline__date">
                      {shortDate(event.date, current)}
                      {event.endDate ? ` – ${shortDate(event.endDate, current)}` : ''}
                    </span>
                    <span className="timeline__title">{event.title || 'Untitled event'}</span>
                    {event.note ? (
                      <span className="timeline__snippet">{plainText(event.note, 160)}</span>
                    ) : null}
                  </a>
                </li>
              ))}
            </ol>
          </section>
        ))
      )}
    </article>
  );
}
