/**
 * Patterns: how the days have felt, what goes with the good ones, and the year in pixels. All
 * computed here, from the decrypted journal; nothing about it leaves the device.
 */
import { useMemo, useState } from 'react';
import { useJournal } from '../app/context';
import { navigate, paths } from '../app/router';
import { addDays, today } from '../model/dates';
import {
  activityImpact,
  monthSummary,
  moodSeries,
  streaks,
  wordCount,
  yearInPixels,
} from '../model/stats';
import { ImpactList, MoodBar, MoodLine, YearPixels } from '../ui/charts';
import { Segmented } from '../ui/fields';

type Range = 30 | 90 | 365;

export function StatsScreen() {
  const journal = useJournal();
  const current = today();
  const days = journal.days();
  const moods = journal.settings().moods;
  const [range, setRange] = useState<Range>(30);
  const [year, setYear] = useState(Number(current.slice(0, 4)));

  const from = addDays(current, -(range - 1));
  const inRange = useMemo(
    () => days.filter((day) => day.date >= from && day.date <= current),
    [days, from, current],
  );
  const series = useMemo(() => moodSeries(days, from, current), [days, from, current]);
  const counts = useMemo(() => {
    const out: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const day of inRange) if (day.mood) out[day.mood] = (out[day.mood] ?? 0) + 1;
    return out;
  }, [inRange]);
  const impact = useMemo(
    () =>
      activityImpact(inRange, journal.activities())
        .filter((item) => item.count >= 2)
        .slice(0, 12),
    [inRange, journal],
  );
  const streak = useMemo(() => streaks(days, current), [days, current]);
  const words = useMemo(
    () => inRange.reduce((sum, day) => sum + wordCount(day.note), 0),
    [inRange],
  );
  const pixels = useMemo(() => yearInPixels(days, year), [days, year]);
  const years = useMemo(() => {
    const found = new Set(days.map((day) => Number(day.date.slice(0, 4))));
    found.add(Number(current.slice(0, 4)));
    return [...found].sort((a, b) => b - a);
  }, [days, current]);
  const month = monthSummary(days, current.slice(0, 7));

  return (
    <article className="page page--wide stats">
      <header className="page__head page__head--row">
        <h1 className="page__title">Stats</h1>
        <Segmented
          label="Range"
          value={range}
          options={[
            { value: 30, label: '30 days' },
            { value: 90, label: '90 days' },
            { value: 365, label: 'Year' },
          ]}
          onChange={setRange}
        />
      </header>

      <section className="stat-cards" aria-label="Streaks">
        <div className="stat-card">
          <span className="stat-card__value">{streak.current}</span>
          <span className="stat-card__label">day streak</span>
        </div>
        <div className="stat-card">
          <span className="stat-card__value">{streak.longest}</span>
          <span className="stat-card__label">longest streak</span>
        </div>
        <div className="stat-card">
          <span className="stat-card__value">{streak.total}</span>
          <span className="stat-card__label">
            {streak.total === 1 ? 'day written' : 'days written'}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-card__value">{words.toLocaleString()}</span>
          <span className="stat-card__label">
            {words === 1 ? 'word' : 'words'} ({range === 365 ? 'year' : `${range} days`})
          </span>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">Mood</h2>
        {inRange.some((day) => day.mood) ? (
          <>
            <MoodLine series={series} moods={moods} />
            <MoodBar counts={counts} moods={moods} />
          </>
        ) : (
          <p className="faint">Pick a mood on a few days and the pattern shows here.</p>
        )}
      </section>

      <section className="section">
        <h2 className="section__title">What goes with a good day</h2>
        {impact.length > 0 ? (
          <>
            <p className="hint">
              Your average mood on days with each activity, compared with days without it. A
              pattern, not a cause.
            </p>
            <ImpactList items={impact} />
          </>
        ) : (
          <p className="faint">Tick activities for a couple of weeks to see what goes with what.</p>
        )}
      </section>

      <section className="section">
        <div className="month-summary__row">
          <h2 className="section__title">Year in pixels</h2>
          {years.length > 1 ? (
            <select
              className="input input--inline"
              aria-label="Year"
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <YearPixels
          year={year}
          pixels={pixels}
          moods={moods}
          current={current}
          onPick={(date) => navigate(paths.day(date))}
        />
      </section>

      {month.entries > 0 ? (
        <p className="muted section">
          This month so far: {month.entries} {month.entries === 1 ? 'day' : 'days'} written
          {month.averageMood ? `, average mood ${month.averageMood.toFixed(1)} of 5` : ''}.
        </p>
      ) : null}
    </article>
  );
}
