/**
 * The month's review: DailyBean's monthly snapshot, with room to write. The page shows the month
 * (beans, moods, activities, highlights, photos, songs) and keeps a note about it; the share
 * picture is made from the same review, with only what its switches allow. Kept "just for you"
 * by default: nothing is shared unless you press Share.
 */
import { RichTextEditor, type Doc } from '@allenkh/editor';
import { plainText } from '@allenkh/editor/text';
import { ArrowLeft, Check, Download, Share2 } from 'lucide-react';
import { useEffect, useEffectEvent, useState } from 'react';
import { useJournal } from '../app/context';
import { follow, paths } from '../app/router';
import { monthGrid, monthName, shortDate, today, weekdayNames } from '../model/dates';
import { blankMonth } from '../model/records';
import { monthSummary } from '../model/stats';
import type { MonthReview, RichText } from '../model/types';
import {
  SIZES,
  renderSnapshot,
  snapshotName,
  type Snapshot,
  type SnapshotSize,
} from '../share/snapshot';
import { Bean } from '../ui/Bean';
import { MoodBar } from '../ui/charts';
import { Title } from '../ui/common';
import { Segmented } from '../ui/fields';
import { SealedImage } from '../ui/Photo';
import { openFile } from '../journal/files';
import { activityById, familyOf } from './Calendar';

type ShareKey = keyof MonthReview['share'];

const SHARE_PARTS: { key: ShareKey; label: string; named: string }[] = [
  { key: 'mood', label: 'Moods', named: 'the moods' },
  { key: 'activities', label: 'Activities', named: 'activities' },
  { key: 'highlights', label: 'Highlights', named: 'highlights' },
  { key: 'photos', label: 'Photos', named: 'photos' },
  { key: 'note', label: 'My note', named: 'your note' },
];

/** "No room for photos and highlights in this shape; try Story." */
function roomHint(omitted: ShareKey[], size: SnapshotSize): string | null {
  if (omitted.length === 0) return null;
  const names = SHARE_PARTS.filter((part) => omitted.includes(part.key)).map((part) => part.named);
  const list = new Intl.ListFormat('en', { type: 'conjunction' }).format(names);
  return `No room for ${list} in this shape${size === 'story' ? '' : '; try Story'}.`;
}

export function MonthScreen({ month }: { month: string }) {
  const journal = useJournal();
  const current = today();
  const settings = journal.settings();
  const review = journal.month(month) ?? blankMonth(month);
  const days = journal.days();
  const summary = monthSummary(days, month);
  const activities = activityById(journal.activities());
  const update = (change: (review: MonthReview) => MonthReview) =>
    void journal.updateMonth(month, change);
  const picked = review.photos
    .map((id) => summary.photos.find((entry) => entry.photo.id === id))
    .filter((entry) => entry !== undefined);
  const shownPhotos = picked.length > 0 ? picked : summary.photos.slice(0, 4);

  return (
    <article className="page page--wide month">
      <header className="page__head">
        <a className="back-link" href={paths.calendar(month)} onClick={follow}>
          <ArrowLeft aria-hidden="true" /> {monthName(month)}
        </a>
        <Title className="page__overline">
          Month review<span className="visually-hidden">, {monthName(month)}</span>
        </Title>
        <input
          key={review.title}
          className="bare-input page__title"
          placeholder={`My ${monthName(month).split(' ')[0]}`}
          aria-label="Title for the month"
          defaultValue={review.title}
          onBlur={(event) =>
            event.target.value !== review.title &&
            update((r) => ({ ...r, title: event.target.value }))
          }
        />
      </header>

      {summary.entries === 0 ? (
        <p className="muted">Nothing written in {monthName(month)} yet.</p>
      ) : (
        <>
          <section className="section month__calendar" aria-label="Moods through the month">
            <div className="mini-month">
              {weekdayNames(settings.weekStart, 'narrow').map((name, i) => (
                <span key={`h${i}`} className="mini-month__head">
                  {name}
                </span>
              ))}
              {monthGrid(month, settings.weekStart)
                .flat()
                .map((date, i) =>
                  date ? (
                    <a
                      key={date}
                      href={paths.day(date)}
                      onClick={follow}
                      className="mini-month__day"
                      aria-label={shortDate(date, current)}
                    >
                      <Bean
                        mood={journal.day(date)?.mood ?? null}
                        family={familyOf(settings.moods, journal.day(date)?.mood ?? null)}
                        size="100%"
                      />
                    </a>
                  ) : (
                    <span key={`e${i}`} />
                  ),
                )}
            </div>
            <div className="month__facts">
              <MoodBar counts={summary.moods} moods={settings.moods} />
              <p className="muted">
                {summary.entries} {summary.entries === 1 ? 'day' : 'days'} written
                {summary.words
                  ? ` · ${summary.words.toLocaleString()} ${summary.words === 1 ? 'word' : 'words'}`
                  : ''}
                {summary.longestStreak > 1 ? ` · longest streak ${summary.longestStreak} days` : ''}
              </p>
              {summary.topActivities.length > 0 ? (
                <ul className="top-activities">
                  {summary.topActivities.slice(0, 10).map(({ id, count }) => {
                    const activity = activities.get(id);
                    return activity ? (
                      <li key={id} className="chip chip--static">
                        <span aria-hidden="true">{activity.icon}</span>
                        {activity.name}
                        <span className="chip__count">{count}</span>
                      </li>
                    ) : null;
                  })}
                </ul>
              ) : null}
            </div>
          </section>

          {summary.highlights.length > 0 ? (
            <section className="section">
              <h2 className="section__title">Highlights</h2>
              <ul className="entry-list">
                {summary.highlights.map((day) => (
                  <li key={day.date}>
                    <a className="entry" href={paths.day(day.date)} onClick={follow}>
                      <Bean mood={day.mood} family={familyOf(settings.moods, day.mood)} size={28} />
                      <span className="entry__text">
                        <span className="entry__date">{shortDate(day.date, current)}</span>
                        <span className="entry__snippet">{plainText(day.note, 160)}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {summary.photos.length > 0 ? (
            <section className="section">
              <h2 className="section__title">Photos</h2>
              <p className="hint">
                Pick up to four for the snapshot
                {picked.length === 0 ? ' (the first four until you do)' : ''}.
              </p>
              <ul className="photos photos--pick">
                {summary.photos.map(({ photo, date }) => {
                  const chosen = review.photos.includes(photo.id);
                  return (
                    <li key={photo.id} className="photo">
                      <button
                        type="button"
                        className="photo__pick"
                        aria-pressed={chosen}
                        aria-label={`${chosen ? 'Unpick' : 'Pick'} photo from ${shortDate(date, current)}`}
                        onClick={() =>
                          update((r) => ({
                            ...r,
                            photos: chosen
                              ? r.photos.filter((id) => id !== photo.id)
                              : [...r.photos, photo.id].slice(-4),
                          }))
                        }
                      >
                        <SealedImage file={photo.thumb} alt="" />
                        {chosen ? (
                          <span className="photo__check" aria-hidden="true">
                            <Check />
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {summary.songs.length > 0 ? (
            <section className="section">
              <h2 className="section__title">Songs of the month</h2>
              <ol className="songs">
                {summary.songs.map(({ date, song }) => (
                  <li key={date}>
                    <span className="faint">{shortDate(date, current)}</span> {song.title}
                    {song.artist ? <span className="muted"> · {song.artist}</span> : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </>
      )}

      <section className="section note">
        <h2 className="section__title">About this month</h2>
        <RichTextEditor
          label={`Notes about ${monthName(month)}`}
          value={review.note as Doc | null}
          placeholder="What will you remember this month for?"
          onChange={(note) => update((r) => ({ ...r, note: note as RichText | null }))}
        />
      </section>

      {summary.entries > 0 ? (
        <ShareCard
          review={review}
          contentKey={JSON.stringify([
            summary.moods,
            summary.entries,
            summary.highlights.length,
            summary.topActivities.slice(0, 8),
          ])}
          onToggle={(key) => update((r) => ({ ...r, share: { ...r.share, [key]: !r.share[key] } }))}
          render={async (size) => {
            const photos = await Promise.all(
              (review.share.photos ? shownPhotos : []).map(async ({ photo }) => ({
                photo,
                image: await createImageBitmap(await openFile(photo.file)),
              })),
            );
            try {
              return await renderSnapshot({
                review,
                summary,
                moods: settings.moods,
                activities: journal.activities(),
                weekStart: settings.weekStart,
                photos,
                days: new Map(
                  days
                    .filter((day) => day.date.startsWith(month))
                    .map((day) => [day.date, { mood: day.mood, highlight: day.highlight }]),
                ),
                highlights: summary.highlights.map((day) => ({
                  date: day.date,
                  excerpt: plainText(day.note, 80),
                })),
                noteExcerpt: plainText(review.note, 220),
                size,
              });
            } finally {
              for (const { image } of photos) image.close();
            }
          }}
          fileName={snapshotName(month)}
        />
      ) : null}
    </article>
  );
}

/**
 * The share picture: rendered ahead of time whenever what it shows changes, so that pressing
 * Share hands the finished file to the share sheet at once (iOS only allows sharing straight
 * from a tap).
 */
function ShareCard(props: {
  review: MonthReview;
  /** Changes when the month's days change, so the picture is made again. */
  contentKey: string;
  onToggle: (key: ShareKey) => void;
  render: (size: SnapshotSize) => Promise<Snapshot>;
  fileName: string;
}) {
  const [size, setSize] = useState<SnapshotSize>('portrait');
  const [image, setImage] = useState<(Snapshot & { url: string; size: SnapshotSize }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const signature = JSON.stringify([
    props.review.share,
    props.review.photos,
    props.review.title,
    size,
    props.contentKey,
  ]);
  // The picture is drawn again only when what it shows changes (the signature), never merely
  // because the parent made a new `render` function.
  const draw = useEffectEvent((shape: SnapshotSize) => props.render(shape));

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      draw(size)
        .then((made) => {
          if (!live) return;
          setImage({ ...made, url: URL.createObjectURL(made.blob), size });
          setError(null);
        })
        .catch(() => {
          if (live) setError('The picture could not be made.');
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [signature, size]);

  // Each picture's object URL lives exactly as long as the picture is shown.
  useEffect(() => () => void (image && URL.revokeObjectURL(image.url)), [image]);

  const file = image ? new File([image.blob], props.fileName, { type: 'image/png' }) : null;
  const hint = image ? roomHint(image.omitted, image.size) : null;
  const canShare =
    file !== null &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] });

  return (
    <section className="section share" aria-label="Share the month">
      <h2 className="section__title">Snapshot</h2>
      <p className="hint">
        Kept just for you. Share it only if you want to: the picture is made on this device.
      </p>
      <div className="share__layout">
        <div className="share__preview" data-size={size}>
          {image ? (
            <img src={image.url} alt="The month's snapshot" />
          ) : (
            <span className="photo-loading" role="progressbar" aria-label="Making the picture" />
          )}
        </div>
        <div className="share__controls">
          <Segmented
            label="Shape"
            value={size}
            options={(Object.keys(SIZES) as SnapshotSize[]).map((key) => ({
              value: key,
              label: SIZES[key].label,
            }))}
            onChange={setSize}
          />
          <fieldset className="share__parts">
            <legend className="visually-hidden">What the picture shows</legend>
            {SHARE_PARTS.map((part) => (
              <label key={part.key} className="check">
                <input
                  type="checkbox"
                  checked={props.review.share[part.key]}
                  onChange={() => props.onToggle(part.key)}
                />
                <span>{part.label}</span>
              </label>
            ))}
          </fieldset>
          {hint ? <p className="hint">{hint}</p> : null}
          {canShare && file ? (
            <button
              type="button"
              className="button button--primary"
              onClick={() => void navigator.share({ files: [file] }).catch(() => undefined)}
            >
              <Share2 aria-hidden="true" /> Share
            </button>
          ) : null}
          {image ? (
            <a className="button" href={image.url} download={props.fileName}>
              <Download aria-hidden="true" /> Save picture
            </a>
          ) : null}
          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
