/**
 * The month at a glance: a bean on every day that has a mood, a star on the highlights, and the
 * month's shape underneath (how it felt, what filled it). DailyBean's calendar, in our colours.
 */
import { ChevronLeft, ChevronRight, ImageIcon, Star } from 'lucide-react';
import { useJournal } from '../app/context';
import { follow, paths } from '../app/router';
import { addMonths, monthGrid, monthName, monthOf, today, weekdayNames } from '../model/dates';
import { hasEntry, monthSummary } from '../model/stats';
import type { Activities, MoodDef } from '../model/types';
import { Bean } from '../ui/Bean';
import { MoodBar } from '../ui/charts';
import { Title } from '../ui/common';

export function activityById(activities: Activities) {
  const map = new Map<string, { name: string; icon: string }>();
  for (const group of activities.groups) {
    for (const item of group.items) map.set(item.id, { name: item.name, icon: item.icon });
  }
  return map;
}

export const familyOf = (moods: MoodDef[], mood: number | null) =>
  moods.find((candidate) => candidate.value === mood)?.family;

export function CalendarScreen({ month: given }: { month: string | null }) {
  const journal = useJournal();
  const current = today();
  const month = given ?? monthOf(current);
  const settings = journal.settings();
  const summary = monthSummary(journal.days(), month);
  const activities = activityById(journal.activities());
  const rows = monthGrid(month, settings.weekStart);

  return (
    <article className="page page--wide calendar">
      <header className="page__head calendar__head">
        <Title className="page__title">{monthName(month)}</Title>
        <div className="calendar__nav">
          <a
            className="icon-button"
            href={paths.calendar(addMonths(month, -1))}
            onClick={follow}
            aria-label="Previous month"
          >
            <ChevronLeft aria-hidden="true" />
          </a>
          {month !== monthOf(current) ? (
            <a className="button button--quiet" href={paths.calendar()} onClick={follow}>
              Today
            </a>
          ) : null}
          <a
            className="icon-button"
            href={paths.calendar(addMonths(month, 1))}
            onClick={follow}
            aria-label="Next month"
          >
            <ChevronRight aria-hidden="true" />
          </a>
        </div>
      </header>

      <table className="month-grid">
        <thead>
          <tr>
            {weekdayNames(settings.weekStart, 'short').map((name) => (
              <th key={name} scope="col">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((date, j) => {
                if (!date) return <td key={j} />;
                const day = journal.day(date);
                const future = date > current;
                const written = day !== null && hasEntry(day);
                return (
                  <td key={date}>
                    <a
                      className="month-grid__day"
                      href={paths.day(date)}
                      onClick={follow}
                      aria-current={date === current ? 'date' : undefined}
                      aria-disabled={future || undefined}
                      tabIndex={future ? -1 : undefined}
                      data-written={written || undefined}
                    >
                      <span className="month-grid__n">{Number(date.slice(8))}</span>
                      {day?.mood ? (
                        <Bean
                          mood={day.mood}
                          family={familyOf(settings.moods, day.mood)}
                          size="100%"
                          className="month-grid__bean"
                        />
                      ) : (
                        <span className="month-grid__dot" aria-hidden="true" />
                      )}
                      <span className="month-grid__marks" aria-hidden="true">
                        {day?.highlight ? <Star className="month-grid__star" /> : null}
                        {day?.photos.length ? <ImageIcon className="month-grid__photo" /> : null}
                      </span>
                      <span className="visually-hidden">
                        {day?.mood
                          ? settings.moods.find((m) => m.value === day.mood)?.label
                          : written
                            ? 'written'
                            : ''}
                        {day?.highlight ? ', highlight' : ''}
                      </span>
                    </a>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <section className="section month-summary">
        <div className="month-summary__row">
          <h2 className="section__title">This month</h2>
          <a className="button" href={paths.month(month)} onClick={follow}>
            Month review
          </a>
        </div>
        {summary.entries === 0 ? (
          <p className="faint">Nothing written this month yet.</p>
        ) : (
          <>
            <p className="muted">
              {summary.entries} {summary.entries === 1 ? 'day' : 'days'} written
              {summary.words > 0
                ? ` · ${summary.words.toLocaleString()} ${summary.words === 1 ? 'word' : 'words'}`
                : ''}
              {summary.highlights.length > 0 ? ` · ${summary.highlights.length} highlighted` : ''}
            </p>
            <MoodBar counts={summary.moods} moods={settings.moods} />
            {summary.topActivities.length > 0 ? (
              <ul className="top-activities">
                {summary.topActivities.slice(0, 8).map(({ id, count }) => {
                  const activity = activities.get(id);
                  if (!activity) return null;
                  return (
                    <li key={id} className="chip chip--static">
                      <span aria-hidden="true">{activity.icon}</span>
                      {activity.name}
                      <span className="chip__count">{count}</span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </>
        )}
      </section>
    </article>
  );
}
