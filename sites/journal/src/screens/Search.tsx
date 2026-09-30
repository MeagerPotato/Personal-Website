/**
 * Search, on the device: the server holds only ciphertext, so the journal is searched here, in
 * memory, after unlocking. Words in any order; results newest first.
 */
import { plainText } from '@allenkh/editor/text';
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useJournal } from '../app/context';
import { follow, paths } from '../app/router';
import { shortDate, today } from '../model/dates';
import { Bean } from '../ui/Bean';
import { familyOf } from './Calendar';
import { Title } from '../ui/common';

interface Hit {
  key: string;
  href: string;
  date: string;
  title: string;
  text: string;
  icon: ReactNode;
}

const fold = (text: string): string => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** The text around the first match, with the match marked. */
function Snippet({ text, terms }: { text: string; terms: string[] }) {
  const folded = fold(text);
  const at = Math.min(
    ...terms.map((term) => folded.indexOf(term)).filter((index) => index >= 0),
    Infinity,
  );
  if (!Number.isFinite(at)) return <>{text.slice(0, 140)}</>;
  const term = terms.find((candidate) => folded.indexOf(candidate) === at) ?? '';
  const start = Math.max(0, at - 50);
  return (
    <>
      {start > 0 ? '…' : ''}
      {text.slice(start, at)}
      <mark>{text.slice(at, at + term.length)}</mark>
      {text.slice(at + term.length, at + term.length + 90)}
    </>
  );
}

export function SearchScreen() {
  const journal = useJournal();
  const current = today();
  const [query, setQuery] = useState('');
  const [mood, setMood] = useState<number | null>(null);
  const [starred, setStarred] = useState(false);
  const deferred = useDeferredValue(query);
  const moods = journal.settings().moods;
  const field = useRef<HTMLInputElement>(null);

  // Opening Search is asking to type: the field has the focus as the screen appears.
  useEffect(() => field.current?.focus(), []);

  const hits = useMemo(() => {
    const terms = fold(deferred).split(/\s+/).filter(Boolean);
    if (terms.length === 0 && mood === null && !starred) return null;
    const activityNames = new Map(
      journal
        .activities()
        .groups.flatMap((group) => group.items.map((item) => [item.id, item.name] as const)),
    );
    const names = new Map(
      [...journal.people(), ...journal.places()].map(([id, record]) => [id, record.name]),
    );
    const matches = (haystack: string) => {
      const folded = fold(haystack);
      return terms.every((term) => folded.includes(term));
    };
    const out: Hit[] = [];
    for (const day of journal.days()) {
      if (mood !== null && day.mood !== mood) continue;
      if (starred && !day.highlight) continue;
      const text = plainText(day.note);
      const extra = [
        ...day.activities.map((id) => activityNames.get(id) ?? ''),
        ...[...day.people, ...day.places].map((id) => names.get(id) ?? ''),
        day.song ? `${day.song.title} ${day.song.artist}` : '',
        ...day.photos.map((photo) => photo.caption),
      ].join(' ');
      if (!matches(`${text} ${extra}`)) continue;
      out.push({
        key: `d:${day.date}`,
        href: paths.day(day.date),
        date: day.date,
        title: shortDate(day.date, current),
        text: text || extra,
        icon: <Bean mood={day.mood} family={familyOf(moods, day.mood)} size={28} />,
      });
    }
    if (mood === null && !starred) {
      for (const [id, event] of journal.events()) {
        const text = plainText(event.note);
        if (!matches(`${event.title} ${text}`)) continue;
        out.push({
          key: `e:${id}`,
          href: paths.event(id),
          date: event.date,
          title: event.title || 'Untitled event',
          text: text || shortDate(event.date, current),
          icon: <span className="entry__icon">{event.icon}</span>,
        });
      }
      for (const [id, person] of journal.people()) {
        const text = plainText(person.note);
        if (!matches(`${person.name} ${person.relation} ${text}`)) continue;
        out.push({
          key: `p:${id}`,
          href: paths.person(id),
          date: '',
          title: person.name,
          text: person.relation || text,
          icon: (
            <span className="avatar" data-family={person.family}>
              {person.icon || person.name.slice(0, 1)}
            </span>
          ),
        });
      }
      for (const [id, place] of journal.places()) {
        const text = plainText(place.note);
        if (!matches(`${place.name} ${place.address} ${text}`)) continue;
        out.push({
          key: `l:${id}`,
          href: paths.place(id),
          date: '',
          title: place.name,
          text: place.address || text,
          icon: (
            <span className="avatar" data-family={place.family}>
              {place.icon}
            </span>
          ),
        });
      }
    }
    return { terms, results: out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 200) };
  }, [deferred, mood, starred, journal, moods, current]);

  return (
    <article className="page search">
      <header className="page__head">
        <Title className="page__title">Search</Title>
        <input
          ref={field}
          className="input search__input"
          type="search"
          placeholder="Words, people, places, songs…"
          aria-label="Search the journal"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="chips search__filters">
          {moods.map((m) => (
            <button
              key={m.value}
              type="button"
              className="chip"
              aria-pressed={mood === m.value}
              onClick={() => setMood(mood === m.value ? null : m.value)}
            >
              <Bean mood={m.value} family={m.family} size={20} /> {m.label}
            </button>
          ))}
          <button
            type="button"
            className="chip"
            aria-pressed={starred}
            onClick={() => setStarred(!starred)}
          >
            ★ Highlights
          </button>
        </div>
      </header>
      {hits === null ? (
        <p className="faint">Everything is searched here, on this device.</p>
      ) : hits.results.length === 0 ? (
        <p className="muted">Nothing matches.</p>
      ) : (
        <ul className="entry-list" aria-live="polite">
          {hits.results.map((hit) => (
            <li key={hit.key}>
              <a className="entry" href={hit.href} onClick={follow}>
                {hit.icon}
                <span className="entry__text">
                  <span className="entry__date">{hit.title}</span>
                  <span className="entry__snippet">
                    <Snippet text={hit.text} terms={hits.terms} />
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
