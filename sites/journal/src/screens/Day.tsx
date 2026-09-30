/**
 * A day: the page you open every evening. Mood, what you did, the writing, photos, the song,
 * who you were with and where; below, the same day in earlier years. Everything saves as you
 * go; there is no Save button.
 */
import { RichTextEditor, type Doc } from '@allenkh/editor';
import { ChevronDown, ChevronLeft, ChevronRight, Music, Star } from 'lucide-react';
import { useState } from 'react';
import { useJournal } from '../app/context';
import { follow, navigate, paths } from '../app/router';
import { BUILT_IN_TEMPLATES } from '../model/defaults';
import { addDays, longDate, relativeDay, shortDate, today } from '../model/dates';
import { blankDay, blankPerson, blankPlace } from '../model/records';
import { hasEntry, onThisDay, plainText, usualActivities } from '../model/stats';
import type { Day, RichText, Song } from '../model/types';
import { Bean } from '../ui/Bean';
import { Photos } from '../ui/Photos';
import { ActivityPicker, LinkPicker, MoodPicker } from '../ui/pickers';
import { ConflictNotice } from '../ui/ConflictNotice';
import { Title } from '../ui/common';

/** The day's prompt: picked by the date, so it stays put all day and changes tomorrow. */
function promptFor(date: string, prompts: readonly string[]): string {
  if (prompts.length === 0) return 'How was today?';
  let hash = 0;
  for (const char of date) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return prompts[hash % prompts.length] ?? 'How was today?';
}

export function DayScreen({ date }: { date: string }) {
  const journal = useJournal();
  const current = today();
  const day = journal.day(date) ?? blankDay(date);
  const settings = journal.settings();
  const update = (change: (day: Day) => Day) => void journal.updateDay(date, change);
  const relative = relativeDay(date, current);
  const earlier = onThisDay(journal.days(), date).slice(0, 5);
  const templates = [
    ...BUILT_IN_TEMPLATES.map((template) => ({ key: template.id, ...template })),
    ...journal.templates().map(([id, template]) => ({ key: id, ...template })),
  ];
  const moodFamily = settings.moods.find((mood) => mood.value === day.mood)?.family;
  const activities = journal.activities();
  const usual = usualActivities(journal.days(), activities, date);
  // Folded to the day's own and the usual ones, once there are usual ones to show: until then (a
  // new journal) every activity shows, so there is something to pick.
  const [allActivities, setAllActivities] = useState(
    () => usual.length === 0 && day.activities.length === 0,
  );
  // The templates go the moment the first word is typed, not when it is saved: a row vanishing
  // on blur would move the buttons below while they are being clicked.
  const [editorBlank, setEditorBlank] = useState(true);

  return (
    <article className="page day" data-family={moodFamily}>
      <header className="page__head day__head">
        <div className="day__nav">
          <a
            className="icon-button"
            href={paths.day(addDays(date, -1))}
            onClick={follow}
            aria-label="Previous day"
          >
            <ChevronLeft aria-hidden="true" />
          </a>
          <p className="page__overline">{relative ?? 'Journal'}</p>
          <a
            className="icon-button"
            href={paths.day(addDays(date, 1))}
            onClick={follow}
            aria-label="Next day"
            aria-disabled={date >= current || undefined}
            hidden={date >= current}
          >
            <ChevronRight aria-hidden="true" />
          </a>
        </div>
        <div className="day__title-row">
          <Title className="page__title">{longDate(date, current)}</Title>
          <button
            type="button"
            className="icon-button star"
            aria-pressed={day.highlight}
            aria-label={day.highlight ? 'Highlighted day' : 'Highlight this day'}
            title="Highlight"
            onClick={() => update((d) => ({ ...d, highlight: !d.highlight }))}
          >
            <Star aria-hidden="true" />
          </button>
        </div>
      </header>

      <ConflictNotice
        conflicts={day.conflicts}
        onDismiss={(id) =>
          update((d) => ({ ...d, conflicts: (d.conflicts ?? []).filter((copy) => copy.id !== id) }))
        }
      />

      <section className="section" aria-label="Mood">
        <MoodPicker
          value={day.mood}
          moods={settings.moods}
          onChange={(mood) => update((d) => ({ ...d, mood }))}
        />
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">What did you do?</h2>
          <button
            type="button"
            className="button button--quiet disclosure"
            aria-expanded={allActivities}
            aria-controls="day-activities"
            onClick={() => setAllActivities((open) => !open)}
          >
            All activities
            <ChevronDown aria-hidden="true" />
          </button>
        </div>
        <ActivityPicker
          key={date}
          id="day-activities"
          activities={activities}
          selected={day.activities}
          usual={usual}
          folded={!allActivities}
          onToggle={(id) =>
            update((d) => ({
              ...d,
              activities: d.activities.includes(id)
                ? d.activities.filter((other) => other !== id)
                : [...d.activities, id],
            }))
          }
        />
        <a className="section__more" href={paths.settings('activities')} onClick={follow}>
          Edit activities
        </a>
      </section>

      <section className="section note">
        <RichTextEditor
          label={`Journal entry for ${longDate(date, current)}`}
          value={day.note as Doc | null}
          placeholder={promptFor(date, settings.prompts)}
          onChange={(note) => update((d) => ({ ...d, note: note as RichText | null }))}
          onEmptyChange={setEditorBlank}
        />
        {day.note === null && editorBlank && templates.length > 0 ? (
          <div className="templates">
            <span className="faint">Start from</span>
            {templates.map((template) => (
              <button
                key={template.key}
                type="button"
                className="chip"
                onClick={() =>
                  update((d) => (d.note ? d : { ...d, note: structuredClone(template.body) }))
                }
              >
                <span aria-hidden="true">{template.icon}</span>
                {template.name}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <Photos
        photos={day.photos}
        onChange={(change) => update((d) => ({ ...d, photos: change(d.photos) }))}
      />

      <SongField
        song={day.song}
        onPatch={(patch) =>
          update((d) => {
            const song = { ...(d.song ?? { title: '', artist: '', url: '' }), ...patch };
            return { ...d, song: song.title.trim() ? song : null };
          })
        }
      />

      <section className="section">
        <h2 className="section__title">People & places</h2>
        <LinkPicker
          label="Person"
          noun="person"
          options={journal.people().map(([id, person]) => ({
            id,
            name: person.name,
            icon: person.icon,
            family: person.family,
          }))}
          selected={day.people}
          onChange={(people) => update((d) => ({ ...d, people }))}
          onCreate={(name) => journal.save(blankPerson(name))}
          hrefFor={(id) => paths.person(id)}
          onOpen={navigate}
        />
        <LinkPicker
          label="Place"
          noun="place"
          options={journal.places().map(([id, place]) => ({
            id,
            name: place.name,
            icon: place.icon,
            family: place.family,
          }))}
          selected={day.places}
          onChange={(places) => update((d) => ({ ...d, places }))}
          onCreate={(name) => journal.save(blankPlace(name))}
          hrefFor={(id) => paths.place(id)}
          onOpen={navigate}
        />
      </section>

      {earlier.length > 0 ? (
        <section className="section">
          <h2 className="section__title">On this day</h2>
          <ul className="entry-list">
            {earlier.map((other) => (
              <li key={other.date}>
                <a className="entry" href={paths.day(other.date)} onClick={follow}>
                  <Bean
                    mood={other.mood}
                    family={settings.moods.find((mood) => mood.value === other.mood)?.family}
                    size={28}
                  />
                  <span className="entry__text">
                    <span className="entry__date">{shortDate(other.date, current)}</span>
                    <span className="entry__snippet">
                      {plainText(other.note, 140) ||
                        (hasEntry(other) ? 'No words, just the day.' : '')}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

function SongField(props: { song: Song | null; onPatch: (patch: Partial<Song>) => void }) {
  const song = props.song ?? { title: '', artist: '', url: '' };
  // Uncontrolled while typing; keyed by the stored value, so an edit synced in shows up.
  return (
    <section className="section song" aria-label="Song of the day">
      <Music aria-hidden="true" className="song__icon" />
      <div className="song__fields">
        <input
          key={`t:${song.title}`}
          className="bare-input song__title"
          placeholder="Song of the day"
          aria-label="Song title"
          defaultValue={song.title}
          onBlur={(event) =>
            event.target.value !== song.title && props.onPatch({ title: event.target.value })
          }
        />
        <input
          key={`a:${song.artist}`}
          className="bare-input song__artist"
          placeholder="Artist"
          aria-label="Artist"
          defaultValue={song.artist}
          onBlur={(event) =>
            event.target.value !== song.artist && props.onPatch({ artist: event.target.value })
          }
        />
        <input
          key={`u:${song.url}`}
          className="bare-input song__url"
          type="url"
          inputMode="url"
          placeholder="Link (optional)"
          aria-label="Link to the song"
          defaultValue={song.url}
          onBlur={(event) => {
            const url = event.target.value.trim();
            if (url !== song.url) props.onPatch({ url: /^https:\/\//.test(url) ? url : '' });
          }}
        />
      </div>
      {song.url ? (
        <a className="song__open" href={song.url} target="_blank" rel="noopener noreferrer">
          Open
        </a>
      ) : null}
    </section>
  );
}
