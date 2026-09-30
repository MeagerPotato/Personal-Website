/**
 * People and places: who and where your days were with. Each has a page of its own (notes, and
 * every day and event it appears on), made the moment you first tag it on a day.
 */
import type { FamilyKey } from '@allenkh/design/tokens';
import { RichTextEditor, type Doc } from '@allenkh/editor';
import { Archive, ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useJournal } from '../app/context';
import { follow, navigate, paths } from '../app/router';
import { shortDate, today } from '../model/dates';
import { blankPerson, blankPlace } from '../model/records';
import { daysWith, plainText } from '../model/stats';
import type { Person, Place, RichText } from '../model/types';
import { Bean } from '../ui/Bean';
import { ConflictNotice } from '../ui/ConflictNotice';
import { FamilyPicker, IconField } from '../ui/fields';
import { familyOf } from './Calendar';
import { Missing } from './Missing';
import { Title } from '../ui/common';

type Kind = 'person' | 'place';

const words = {
  person: { plural: 'People', one: 'person', list: paths.people, page: paths.person },
  place: { plural: 'Places', one: 'place', list: paths.places, page: paths.place },
};

function Avatar({ name, icon, family }: { name: string; icon: string; family: FamilyKey }) {
  return (
    <span className="avatar" data-family={family} aria-hidden="true">
      {icon || name.trim().slice(0, 1).toUpperCase() || '?'}
    </span>
  );
}

function ListScreen({ kind }: { kind: Kind }) {
  const journal = useJournal();
  const [showArchived, setShowArchived] = useState(false);
  const records: readonly [string, Person | Place][] =
    kind === 'person' ? journal.people() : journal.places();
  const days = journal.days();
  const counts = new Map<string, number>();
  for (const day of days) {
    for (const id of kind === 'person' ? day.people : day.places)
      counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const visible = records
    .filter(([, record]) => showArchived || !record.archived)
    .sort(
      ([a, x], [b, y]) =>
        (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || x.name.localeCompare(y.name),
    );
  const archived = records.filter(([, record]) => record.archived).length;
  const w = words[kind];

  return (
    <article className="page">
      <header className="page__head page__head--row">
        <Title className="page__title">{w.plural}</Title>
        <a className="button button--primary" href={w.page(null)} onClick={follow}>
          <Plus aria-hidden="true" /> New {w.one}
        </a>
      </header>
      {visible.length === 0 ? (
        <p className="muted empty-hint">
          {kind === 'person'
            ? 'Tag people on a day (under “People & places”) and they gather here, with every day you spent together.'
            : 'Tag places on a day and they gather here, with every day you were there.'}
        </p>
      ) : (
        <ul className="record-list">
          {visible.map(([id, record]) => (
            <li key={id}>
              <a className="record-row" href={w.page(id)} onClick={follow}>
                <Avatar name={record.name} icon={record.icon} family={record.family} />
                <span className="record-row__name">
                  {record.name}
                  {'relation' in record && record.relation ? (
                    <span className="faint"> · {record.relation}</span>
                  ) : null}
                  {'address' in record && record.address ? (
                    <span className="faint"> · {record.address}</span>
                  ) : null}
                </span>
                <span className="faint">{counts.get(id) ?? 0} days</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {archived > 0 ? (
        <button
          type="button"
          className="button button--quiet"
          onClick={() => setShowArchived(!showArchived)}
        >
          {showArchived ? 'Hide archived' : `Show ${archived} archived`}
        </button>
      ) : null}
    </article>
  );
}

function RecordScreen({ kind, id }: { kind: Kind; id: string | null }) {
  const journal = useJournal();
  const current = today();
  const [draft] = useState<Person | Place>(() =>
    kind === 'person' ? blankPerson() : blankPlace(),
  );
  const stored = id ? (kind === 'person' ? journal.person(id) : journal.place(id)) : null;
  if (id && !stored) return <Missing />;
  const record = stored ?? draft;
  const w = words[kind];
  const update = (change: (record: Person | Place) => Person | Place) => {
    if (id) journal.update<Person | Place>(id, change);
    else {
      const next = change(draft);
      if (!next.name.trim()) return; // a person or place needs a name before it exists
      navigate(w.page(journal.save(next)), { replace: true, keepScreen: true });
    }
  };
  const days = id ? daysWith(journal.days(), id, kind === 'person' ? 'people' : 'places') : [];
  const events = id
    ? journal
        .events()
        .filter(([, event]) => (kind === 'person' ? event.people : event.places).includes(id))
        .sort(([, a], [, b]) => b.date.localeCompare(a.date))
    : [];
  const moods = journal.settings().moods;

  return (
    <article className="page record" data-family={record.family}>
      <header className="page__head">
        <a className="back-link" href={w.list()} onClick={follow}>
          <ArrowLeft aria-hidden="true" /> {w.plural}
        </a>
        <Title className="visually-hidden">{record.name.trim() || `New ${w.one}`}</Title>
        <div className="record__title-row">
          <IconField
            value={record.icon}
            label="Icon"
            fallback={record.name.trim().slice(0, 1).toUpperCase() || undefined}
            onChange={(icon) => update((r) => ({ ...r, icon }))}
          />
          <input
            key={record.name}
            className="bare-input page__title"
            placeholder={kind === 'person' ? 'Name' : 'Place name'}
            aria-label="Name"
            defaultValue={record.name}
            autoFocus={!record.name}
            onBlur={(event) => {
              const name = event.target.value.trim();
              if (name && name !== record.name) update((r) => ({ ...r, name }));
            }}
          />
        </div>
      </header>

      <ConflictNotice
        conflicts={record.conflicts}
        onDismiss={(copy) =>
          update((r) => ({ ...r, conflicts: (r.conflicts ?? []).filter((c) => c.id !== copy) }))
        }
      />

      <dl className="properties">
        {record.kind === 'person' ? (
          <>
            <dt>Who</dt>
            <dd>
              <input
                key={record.relation}
                className="bare-input"
                placeholder="Friend, sister, lab partner…"
                aria-label="Relation"
                defaultValue={record.relation}
                onBlur={(event) =>
                  event.target.value !== record.relation &&
                  update((r) => ({ ...(r as Person), relation: event.target.value }))
                }
              />
            </dd>
            <dt>Birthday</dt>
            <dd>
              <input
                className="input input--inline"
                type="date"
                aria-label="Birthday"
                value={record.birthday && record.birthday.length === 10 ? record.birthday : ''}
                onChange={(event) =>
                  update((r) => ({ ...(r as Person), birthday: event.target.value || null }))
                }
              />
            </dd>
          </>
        ) : (
          <>
            <dt>Where</dt>
            <dd>
              <input
                key={record.address}
                className="bare-input"
                placeholder="Address or area"
                aria-label="Address"
                defaultValue={record.address}
                onBlur={(event) =>
                  event.target.value !== record.address &&
                  update((r) => ({ ...(r as Place), address: event.target.value }))
                }
              />
            </dd>
          </>
        )}
        <dt>Colour</dt>
        <dd>
          <FamilyPicker
            value={record.family}
            onChange={(family) => update((r) => ({ ...r, family }))}
          />
        </dd>
      </dl>

      {id ? (
        <>
          <section className="section note">
            <RichTextEditor
              label={`Notes about ${record.name}`}
              value={record.note as Doc | null}
              placeholder="Notes"
              onChange={(note) => update((r) => ({ ...r, note: note as RichText | null }))}
            />
          </section>

          {events.length > 0 ? (
            <section className="section">
              <h2 className="section__title">Events</h2>
              <ul className="entry-list">
                {events.map(([eventId, event]) => (
                  <li key={eventId}>
                    <a className="entry" href={paths.event(eventId)} onClick={follow}>
                      <span className="entry__icon" aria-hidden="true">
                        {event.icon}
                      </span>
                      <span className="entry__text">
                        <span className="entry__date">{shortDate(event.date, current)}</span>
                        <span className="entry__snippet">{event.title || 'Untitled event'}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="section">
            <h2 className="section__title">
              {days.length} {days.length === 1 ? 'day' : 'days'}
            </h2>
            <ul className="entry-list">
              {days.slice(0, 60).map((day) => (
                <li key={day.date}>
                  <a className="entry" href={paths.day(day.date)} onClick={follow}>
                    <Bean mood={day.mood} family={familyOf(moods, day.mood)} size={28} />
                    <span className="entry__text">
                      <span className="entry__date">{shortDate(day.date, current)}</span>
                      <span className="entry__snippet">{plainText(day.note, 140)}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <footer className="record__foot">
            <button
              type="button"
              className="button"
              onClick={() => update((r) => ({ ...r, archived: !r.archived }))}
            >
              <Archive aria-hidden="true" /> {record.archived ? 'Unarchive' : 'Archive'}
            </button>
            <button
              type="button"
              className="button button--danger"
              onClick={() => {
                if (!confirm(`Delete ${record.name}? Days keep their text but lose the tag.`))
                  return;
                for (const day of days) {
                  void journal.updateDay(day.date, (d) => ({
                    ...d,
                    people: d.people.filter((other) => other !== id),
                    places: d.places.filter((other) => other !== id),
                  }));
                }
                journal.remove(id);
                navigate(w.list(), { replace: true });
              }}
            >
              <Trash2 aria-hidden="true" /> Delete
            </button>
          </footer>
        </>
      ) : (
        <p className="hint">Give {kind === 'person' ? 'them' : 'it'} a name to save.</p>
      )}
    </article>
  );
}

export const PeopleScreen = () => <ListScreen kind="person" />;
export const PlacesScreen = () => <ListScreen kind="place" />;
export const PersonScreen = ({ id }: { id: string | null }) => (
  <RecordScreen kind="person" id={id} />
);
export const PlaceScreen = ({ id }: { id: string | null }) => <RecordScreen kind="place" id={id} />;
