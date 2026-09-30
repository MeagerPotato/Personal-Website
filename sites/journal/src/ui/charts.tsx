/**
 * Small, hand-drawn charts (SVG and flexbox, no chart library): the mood mix of a month, mood
 * over time, a year in pixels, and how activities go with mood. Colours come from the moods'
 * families; every chart has a text equivalent for screen readers.
 */
import { useRef, useState, type KeyboardEvent } from 'react';
import { shortDate } from '../model/dates';
import type { ActivityImpact } from '../model/stats';
import type { MoodDef } from '../model/types';
import { Bean } from './Bean';

const familyFor = (moods: MoodDef[], mood: number) =>
  moods.find((candidate) => candidate.value === mood)?.family;

/** How many days had each mood, as one bar and a legend. */
export function MoodBar({ counts, moods }: { counts: Record<number, number>; moods: MoodDef[] }) {
  const total = moods.reduce((sum, mood) => sum + (counts[mood.value] ?? 0), 0);
  if (total === 0) return null;
  return (
    <figure className="mood-bar">
      <div className="mood-bar__track" aria-hidden="true">
        {moods.map((mood) => {
          const count = counts[mood.value] ?? 0;
          return count > 0 ? (
            <span
              key={mood.value}
              className="mood-bar__part"
              data-family={mood.family}
              style={{ flexGrow: count }}
            />
          ) : null;
        })}
      </div>
      <figcaption className="mood-bar__legend">
        {moods.map((mood) => (
          <span key={mood.value} className="mood-bar__item">
            <Bean mood={mood.value} family={mood.family} size={20} />
            {mood.label} <strong>{counts[mood.value] ?? 0}</strong>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** Mood over time: each day a dot in its mood's colour, and a line through the weekly mean. */
export function MoodLine({
  series,
  moods,
}: {
  series: { date: string; mood: number | null }[];
  moods: MoodDef[];
}) {
  const width = 640;
  const height = 180;
  const pad = { top: 12, right: 8, bottom: 20, left: 8 };
  const n = series.length;
  const x = (i: number) => pad.left + (n <= 1 ? 0.5 : i / (n - 1)) * (width - pad.left - pad.right);
  const y = (mood: number) => pad.top + ((5 - mood) / 4) * (height - pad.top - pad.bottom);

  // A 7-day moving mean, over the days that have a mood.
  const smooth: { i: number; value: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    const window = series
      .slice(Math.max(0, i - 3), i + 4)
      .flatMap((day) => (day.mood ? [day.mood] : []));
    if (window.length >= 2)
      smooth.push({ i, value: window.reduce((a, b) => a + b, 0) / window.length });
  }
  const path = smooth
    .map(({ i, value }, k) => `${k === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(value).toFixed(1)}`)
    .join('');
  const withMood = series.filter((day) => day.mood !== null);
  const mean = withMood.length
    ? withMood.reduce((sum, day) => sum + (day.mood ?? 0), 0) / withMood.length
    : null;
  const dot = n > 120 ? 2.2 : n > 45 ? 3 : 4.5;

  return (
    <figure className="mood-line">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Mood over ${n} days${mean ? `, averaging ${mean.toFixed(1)} of 5` : ''}`}
      >
        {[1, 2, 3, 4, 5].map((mood) => (
          <line
            key={mood}
            className="mood-line__grid"
            x1={pad.left}
            x2={width - pad.right}
            y1={y(mood)}
            y2={y(mood)}
          />
        ))}
        {path ? <path className="mood-line__trend" d={path} /> : null}
        {series.map((day, i) =>
          day.mood ? (
            <circle
              key={day.date}
              className="mood-line__dot"
              data-family={familyFor(moods, day.mood)}
              cx={x(i)}
              cy={y(day.mood)}
              r={dot}
            />
          ) : null,
        )}
      </svg>
    </figure>
  );
}

/** A year as a grid: one column per month, one row per day of the month. */
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The year as a grid, days down and months across, each day a pixel in its mood's colour. The
 * ARIA grid pattern: one tab stop for the whole year, arrow keys move by day and by month, Home
 * and End along the row (with Ctrl: to the year's first and last day), Enter opens the day. Days
 * still to come are drawn but are not targets.
 */
export function YearPixels({
  year,
  pixels,
  moods,
  current,
  onPick,
}: {
  year: number;
  pixels: Map<string, number | null>;
  moods: MoodDef[];
  /** Today: later days cannot be opened. */
  current: string;
  onPick: (date: string) => void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const at = (month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;
  const openable = (date: string) => pixels.has(date) && date <= current;
  const stop =
    focused && openable(focused)
      ? focused
      : [current, at(1, 1)].find((date) => date.startsWith(String(year)) && openable(date));

  /** The next day that can be opened from `date`, stepping by months and days; null: none. */
  const walk = (date: string, byMonth: number, byDay: number): string | null => {
    let month = Number(date.slice(5, 7)) + byMonth;
    let day = Number(date.slice(8, 10)) + byDay;
    for (; month >= 1 && month <= 12 && day >= 1 && day <= 31; month += byMonth, day += byDay) {
      if (openable(at(month, day))) return at(month, day);
    }
    return null;
  };
  /** Where a key goes from `date`: a day, null (nowhere further), or undefined (not our key). */
  const target = (date: string, key: string, jump: boolean): string | null | undefined => {
    const day = Number(date.slice(8, 10));
    const rowMajor = DAYS.flatMap((d) => MONTHS.map((m) => at(m, d))).filter(openable);
    switch (key) {
      case 'ArrowDown':
        return walk(date, 0, 1);
      case 'ArrowUp':
        return walk(date, 0, -1);
      case 'ArrowRight':
        return walk(date, 1, 0);
      case 'ArrowLeft':
        return walk(date, -1, 0);
      case 'Home':
        return jump ? (rowMajor[0] ?? null) : walk(at(0, day), 1, 0);
      case 'End':
        return jump ? (rowMajor.at(-1) ?? null) : walk(at(13, day), -1, 0);
      default:
        return undefined;
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = target(event.currentTarget.dataset.date ?? '', event.key, event.ctrlKey);
    if (next === undefined) return;
    event.preventDefault();
    if (next) grid.current?.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus();
  };

  const letters = MONTHS.map((month) =>
    new Intl.DateTimeFormat(undefined, { month: 'narrow', timeZone: 'UTC' }).format(
      Date.UTC(year, month - 1, 1),
    ),
  );
  return (
    <div ref={grid} className="pixels" role="grid" aria-label={`${year} in pixels`}>
      <div className="pixels__row" role="row">
        <span className="pixels__n" role="columnheader" />
        {letters.map((letter, i) => (
          <span key={i} className="pixels__head" role="columnheader">
            {letter}
          </span>
        ))}
      </div>
      {DAYS.map((day) => (
        <div key={day} className="pixels__row" role="row">
          <span className="pixels__n" role="rowheader">
            {day}
          </span>
          {MONTHS.map((month) => {
            const date = at(month, day);
            if (!pixels.has(date)) {
              return <span key={month} className="pixels__cell" role="gridcell" />;
            }
            if (!openable(date)) {
              return <span key={month} className="pixels__cell" role="gridcell" data-later="" />;
            }
            const mood = pixels.get(date) ?? null;
            const label = mood ? moods.find((m) => m.value === mood)?.label : 'no mood';
            return (
              <span key={month} className="pixels__cell" role="gridcell">
                <button
                  type="button"
                  className="pixels__day"
                  data-date={date}
                  data-family={mood ? familyFor(moods, mood) : undefined}
                  tabIndex={date === stop ? 0 : -1}
                  title={`${shortDate(date, current)}: ${label}`}
                  onClick={() => onPick(date)}
                  onKeyDown={onKeyDown}
                  onFocus={() => setFocused(date)}
                />
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Activities by how they go with mood: a bar either side of "no difference". */
export function ImpactList({ items }: { items: ActivityImpact[] }) {
  const max = Math.max(0.5, ...items.map((item) => Math.abs(item.lift ?? 0)));
  return (
    <ul className="impact">
      {items.map((item) => {
        const lift = item.lift ?? 0;
        const share = `${(Math.abs(lift) / max) * 50}%`;
        return (
          <li key={item.activity.id} className="impact__row">
            <span className="impact__name">
              <span aria-hidden="true">{item.activity.icon}</span> {item.activity.name}
              <span className="faint"> · {item.count}</span>
            </span>
            <span className="impact__track" aria-hidden="true">
              <span
                className="impact__bar"
                data-family={lift >= 0 ? 'mint' : 'coral'}
                style={lift >= 0 ? { left: '50%', width: share } : { right: '50%', width: share }}
              />
            </span>
            <span className="impact__value">
              {item.lift === null ? '–' : `${lift >= 0 ? '+' : '−'}${Math.abs(lift).toFixed(1)}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
