/** One life event: what, when (a day or a span), how big, the story, photos, who and where. */
import { RichTextEditor, type Doc } from '@allenkh/editor';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useJournal } from '../app/context';
import { follow, navigate, paths } from '../app/router';
import { today } from '../model/dates';
import { blankEvent, blankPerson, blankPlace } from '../model/records';
import type { LifeEvent, RichText } from '../model/types';
import { ConflictNotice } from '../ui/ConflictNotice';
import { FamilyPicker, IconField, Segmented } from '../ui/fields';
import { Photos } from '../ui/Photos';
import { LinkPicker } from '../ui/pickers';
import { Missing } from './Missing';

export function EventScreen({ id }: { id: string | null }) {
  const journal = useJournal();
  // A new event is a draft until its first change: nothing is saved for a page opened and left.
  const [draft] = useState(() => blankEvent(today()));
  const stored = id ? journal.event(id) : null;
  if (id && !stored) return <Missing />;
  const event = stored ?? draft;
  const update = (change: (event: LifeEvent) => LifeEvent) => {
    if (id) journal.update<LifeEvent>(id, change);
    else navigate(paths.event(journal.save(change(draft))), { replace: true, keepScreen: true });
  };

  return (
    <article className="page record" data-family={event.family}>
      <header className="page__head">
        <a className="back-link" href={paths.timeline()} onClick={follow}>
          <ArrowLeft aria-hidden="true" /> Timeline
        </a>
        <h1 className="visually-hidden">{event.title.trim() || 'New event'}</h1>
        <div className="record__title-row">
          <IconField
            value={event.icon}
            label="Icon"
            onChange={(icon) => update((e) => ({ ...e, icon: icon || '✨' }))}
          />
          <input
            key={event.title}
            className="bare-input page__title"
            placeholder="Untitled event"
            aria-label="Title"
            defaultValue={event.title}
            autoFocus={!event.title}
            onBlur={(e) =>
              e.target.value !== event.title && update((ev) => ({ ...ev, title: e.target.value }))
            }
          />
        </div>
      </header>

      <ConflictNotice
        conflicts={event.conflicts}
        onDismiss={(copy) =>
          update((e) => ({ ...e, conflicts: (e.conflicts ?? []).filter((c) => c.id !== copy) }))
        }
      />

      <dl className="properties">
        <dt>When</dt>
        <dd className="properties__dates">
          <input
            className="input input--inline"
            type="date"
            aria-label="Date"
            value={event.date}
            max={today()}
            onChange={(e) => e.target.value && update((ev) => ({ ...ev, date: e.target.value }))}
          />
          <span className="faint">to</span>
          <input
            className="input input--inline"
            type="date"
            aria-label="End date (optional)"
            value={event.endDate ?? ''}
            min={event.date}
            onChange={(e) =>
              update((ev) => ({
                ...ev,
                endDate: e.target.value && e.target.value > ev.date ? e.target.value : null,
              }))
            }
          />
        </dd>
        <dt>Size</dt>
        <dd>
          <Segmented
            label="Size"
            value={event.weight}
            options={[
              { value: 1, label: 'Everyday' },
              { value: 2, label: 'Notable' },
              { value: 3, label: 'Milestone' },
            ]}
            onChange={(weight) => update((e) => ({ ...e, weight }))}
          />
        </dd>
        <dt>Colour</dt>
        <dd>
          <FamilyPicker
            value={event.family}
            onChange={(family) => update((e) => ({ ...e, family }))}
          />
        </dd>
      </dl>

      <section className="section note">
        <RichTextEditor
          label="The story"
          value={event.note as Doc | null}
          placeholder="What happened? Why does it matter?"
          onChange={(note) => update((e) => ({ ...e, note: note as RichText | null }))}
        />
      </section>

      <Photos
        photos={event.photos}
        onChange={(change) => update((e) => ({ ...e, photos: change(e.photos) }))}
      />

      <section className="section">
        <h2 className="section__title">People & places</h2>
        <LinkPicker
          label="Person"
          noun="person"
          options={journal
            .people()
            .map(([pid, p]) => ({ id: pid, name: p.name, icon: p.icon, family: p.family }))}
          selected={event.people}
          onChange={(people) => update((e) => ({ ...e, people }))}
          onCreate={(name) => journal.save(blankPerson(name))}
          hrefFor={(pid) => paths.person(pid)}
          onOpen={navigate}
        />
        <LinkPicker
          label="Place"
          noun="place"
          options={journal
            .places()
            .map(([pid, p]) => ({ id: pid, name: p.name, icon: p.icon, family: p.family }))}
          selected={event.places}
          onChange={(places) => update((e) => ({ ...e, places }))}
          onCreate={(name) => journal.save(blankPlace(name))}
          hrefFor={(pid) => paths.place(pid)}
          onOpen={navigate}
        />
      </section>

      <footer className="record__foot">
        <button
          type="button"
          className="button button--danger"
          onClick={() => {
            if (!confirm('Delete this event? This can’t be undone.')) return;
            if (id) journal.remove(id);
            navigate(paths.timeline(), { replace: true });
          }}
        >
          <Trash2 aria-hidden="true" /> Delete event
        </button>
      </footer>
    </article>
  );
}
