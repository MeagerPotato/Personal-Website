/**
 * Tags and series. Tags are made by using them on a post; here they get their colour, their
 * name as shown, and a line about them. Series are made here, then chosen on each post. Each is
 * a row that opens into its form (and closes again once saved).
 */
import { onRadioKeyDown, radioTabIndex } from '@allenkh/design/radiogroup';
import { ChevronRight, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { SeriesInfo, TagInfo } from '../../server/posts';
import { FAMILIES, type Family } from '../../site/tags';
import { api } from '../api';
import { useTitle } from '../router';
import { busyLabel, describe, ErrorText, plural, Title, useConfirm } from '../ui/common';

type Ask = ReturnType<typeof useConfirm>[1];

function Swatches({
  value,
  onChange,
  label,
}: {
  value: Family;
  onChange: (family: Family) => void;
  label: string;
}) {
  const picked = FAMILIES.indexOf(value);
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {FAMILIES.map((family, index) => (
        <button
          key={family}
          type="button"
          role="radio"
          className="swatch"
          data-family={family}
          aria-checked={index === picked}
          aria-label={family[0]?.toUpperCase() + family.slice(1)}
          tabIndex={radioTabIndex(index, picked)}
          onClick={() => onChange(family)}
          onKeyDown={onRadioKeyDown}
        />
      ))}
    </div>
  );
}

function TagEditor({ tag, onSaved, ask }: { tag: TagInfo; onSaved: () => void; ask: Ask }) {
  const [name, setName] = useState(tag.name);
  const [family, setFamily] = useState<Family>(tag.family);
  const [description, setDescription] = useState(tag.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = name !== tag.name || family !== tag.family || description !== tag.description;

  const act = (task: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    task()
      .then(onSaved)
      .catch((caught: unknown) => setError(describe(caught)))
      .finally(() => setBusy(false));
  };

  return (
    <li className="organize-item">
      <details className="organize-item__details">
        <summary className="record-row organize-item__summary">
          <span className="tag" data-family={family}>
            {name.trim() || tag.name}
          </span>
          <span className="hint organize-item__meta">
            /tags/{tag.slug}/ · {plural(tag.count, 'post')}
          </span>
          <ChevronRight className="organize-item__chevron" aria-hidden />
        </summary>
        <form
          className="organize-item__form"
          onSubmit={(event) => {
            event.preventDefault();
            act(() =>
              api.saveTag(tag.slug, { name: name.trim(), family, description: description.trim() }),
            );
          }}
        >
          <label className="field">
            <span>Name</span>
            <input
              className="input"
              value={name}
              maxLength={40}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <Swatches value={family} onChange={setFamily} label={`Colour of ${tag.name}`} />
          <label className="field">
            <span>About it (shown on its page)</span>
            <textarea
              className="input"
              rows={2}
              maxLength={600}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <ErrorText error={error} />
          <div className="row">
            <button
              type="submit"
              className="button button--primary"
              disabled={busy || !changed || !name.trim()}
            >
              {busyLabel(busy, 'Save', 'Saving…')}
            </button>
            <button
              type="button"
              className="button button--quiet button--danger"
              disabled={busy}
              onClick={() => {
                void ask({
                  title: `Delete the tag “${tag.name}”?`,
                  body:
                    tag.count > 0
                      ? `It comes off ${plural(tag.count, 'post')}, now. A post that still lists it makes it again when it’s next published.`
                      : 'No published post has it.',
                  confirm: 'Delete tag',
                  danger: true,
                }).then((yes) => {
                  if (yes) act(() => api.deleteTag(tag.slug));
                });
              }}
            >
              Delete
            </button>
          </div>
        </form>
      </details>
    </li>
  );
}

interface SeriesFields {
  title: string;
  slug: string;
  description: string;
}

function SeriesEditor({
  series,
  onSaved,
  onCancel,
  ask,
}: {
  series: SeriesInfo | null;
  onSaved: () => void;
  onCancel?: () => void;
  ask: Ask;
}) {
  const [fields, setFields] = useState<SeriesFields>({
    title: series?.title ?? '',
    slug: series?.slug ?? '',
    description: series?.description ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed =
    !series ||
    fields.title !== series.title ||
    fields.slug !== series.slug ||
    fields.description !== series.description;

  const act = (task: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    task()
      .then(onSaved)
      .catch((caught: unknown) => setError(describe(caught)))
      .finally(() => setBusy(false));
  };

  const input = {
    title: fields.title.trim(),
    slug: fields.slug.trim(),
    description: fields.description.trim(),
  };

  const form = (
    <form
      className="organize-item__form"
      onSubmit={(event) => {
        event.preventDefault();
        act(() => (series ? api.saveSeries(series.id, input) : api.createSeries(input)));
      }}
    >
      {series ? null : <h3 className="organize-item__new">New series</h3>}
      <label className="field">
        <span>Title</span>
        <input
          className="input"
          value={fields.title}
          maxLength={120}
          required
          onChange={(event) => setFields({ ...fields, title: event.target.value })}
        />
      </label>
      <label className="field">
        <span>Address (empty: from the title)</span>
        <input
          className="input"
          value={fields.slug}
          maxLength={80}
          spellCheck={false}
          autoCapitalize="off"
          onChange={(event) => setFields({ ...fields, slug: event.target.value })}
        />
      </label>
      <label className="field">
        <span>About it (shown on its page and on its posts)</span>
        <textarea
          className="input"
          rows={2}
          maxLength={600}
          value={fields.description}
          onChange={(event) => setFields({ ...fields, description: event.target.value })}
        />
      </label>
      <ErrorText error={error} />
      <div className="row">
        <button
          type="submit"
          className="button button--primary"
          disabled={busy || !changed || !input.title}
        >
          {busyLabel(busy, series ? 'Save' : 'Make the series', 'Saving…')}
        </button>
        {onCancel ? (
          <button type="button" className="button button--quiet" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        {series ? (
          <button
            type="button"
            className="button button--quiet button--danger"
            disabled={busy}
            onClick={() => {
              void ask({
                title: `Delete the series “${series.title}”?`,
                body: 'Its posts stay, no longer part of a series.',
                confirm: 'Delete series',
                danger: true,
              }).then((yes) => {
                if (yes) act(() => api.deleteSeries(series.id));
              });
            }}
          >
            Delete
          </button>
        ) : null}
      </div>
    </form>
  );

  if (!series) return <li className="organize-item organize-item--new">{form}</li>;
  return (
    <li className="organize-item">
      <details className="organize-item__details">
        <summary className="record-row organize-item__summary">
          <strong className="organize-item__name">{series.title}</strong>
          <span className="hint organize-item__meta">
            /series/{series.slug}/ · {plural(series.count, 'post')}
          </span>
          <ChevronRight className="organize-item__chevron" aria-hidden />
        </summary>
        {form}
      </details>
    </li>
  );
}

export function Organize() {
  useTitle('Organize');
  const [tags, setTags] = useState<TagInfo[] | null>(null);
  const [series, setSeries] = useState<SeriesInfo[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, ask] = useConfirm();

  const load = useCallback(
    () =>
      Promise.all([api.tags(), api.series()]).then(
        ([nextTags, nextSeries]) => {
          setTags(nextTags);
          setSeries(nextSeries);
        },
        (caught: unknown) => setError(describe(caught)),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <header className="page__head">
        <Title className="page__title">Organize</Title>
        <p className="hint">
          Tags and series: how readers find their way from one post to the next.
        </p>
      </header>
      <ErrorText error={error} />

      <section className="settings__section" aria-labelledby="series-title">
        <h2 id="series-title" className="settings__title">
          Series
        </h2>
        {series && series.length === 0 && !adding ? (
          <p className="hint">No series yet: a series strings posts together, part by part.</p>
        ) : null}
        <ul className="organize-list">
          {series?.map((item) => (
            <SeriesEditor
              key={`${item.id}:${item.title}:${item.slug}:${item.description}`}
              series={item}
              ask={ask}
              onSaved={() => void load()}
            />
          ))}
          {adding ? (
            <SeriesEditor
              series={null}
              ask={ask}
              onCancel={() => setAdding(false)}
              onSaved={() => {
                setAdding(false);
                void load();
              }}
            />
          ) : null}
        </ul>
        {!adding ? (
          <button
            type="button"
            className="button button--quiet organize__add"
            onClick={() => setAdding(true)}
          >
            <Plus aria-hidden />
            New series
          </button>
        ) : null}
      </section>

      <section className="settings__section" aria-labelledby="tags-title">
        <h2 id="tags-title" className="settings__title">
          Tags
        </h2>
        {tags === null ? (
          <p className="hint" aria-busy="true">
            Loading…
          </p>
        ) : tags.length === 0 ? (
          <p className="hint">
            No tags yet. Add some to a post (in its properties) and publish it.
          </p>
        ) : (
          <ul className="organize-list">
            {tags.map((tag) => (
              <TagEditor
                key={`${tag.slug}:${tag.name}:${tag.family}:${tag.description}`}
                tag={tag}
                ask={ask}
                onSaved={() => void load()}
              />
            ))}
          </ul>
        )}
      </section>
      {confirmDialog}
    </div>
  );
}
