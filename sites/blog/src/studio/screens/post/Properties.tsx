/**
 * A post's properties, Notion's way: a quiet table under the title. Summary, address, date,
 * tags, series, cover. Each change goes to the draft, and is saved with it.
 */
import { X } from 'lucide-react';
import { useId, useState } from 'react';
import type { Draft, SeriesInfo, StudioPost, TagInfo } from '../../../server/posts';
import { isPostSlug, RESERVED_SLUGS, slugify } from '../../../server/slug';
import { shortDate } from '../../../site/format';
import { familyFor } from '../../../site/tags';
import { follow, hrefFor } from '../../router';

const MAX_TAGS = 12;

function TagInput({
  id,
  tags,
  known,
  onChange,
}: {
  id: string;
  tags: string[];
  known: TagInfo[];
  onChange: (tags: string[]) => void;
}) {
  const [text, setText] = useState('');
  const list = useId();
  const family = (name: string) =>
    known.find((tag) => tag.name.toLowerCase() === name.toLowerCase())?.family ??
    familyFor(slugify(name, 40));
  /** Adds what was typed (one tag, or several between commas); `rest` stays in the field. */
  const add = (typed: string[], rest = '') => {
    setText(rest);
    const next = [...tags];
    for (const raw of typed) {
      const name = raw.trim().replace(/\s+/g, ' ').slice(0, 40);
      if (!name || next.length >= MAX_TAGS) continue;
      if (next.some((tag) => tag.toLowerCase() === name.toLowerCase())) continue;
      // A tag that exists already keeps its own spelling.
      const existing = known.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
      next.push(existing?.name ?? name);
    }
    if (next.length !== tags.length) onChange(next);
  };
  return (
    <div className="tag-input">
      {tags.map((tag) => (
        <span key={tag} className="tag tag-input__tag" data-family={family(tag)}>
          {tag}
          <button
            type="button"
            className="tag-input__remove"
            aria-label={`Remove the tag ${tag}`}
            onClick={() => onChange(tags.filter((other) => other !== tag))}
          >
            <X aria-hidden />
          </button>
        </span>
      ))}
      {tags.length < MAX_TAGS ? (
        <input
          id={id}
          className="bare-input tag-input__field"
          list={list}
          value={text}
          placeholder={tags.length > 0 ? 'Add a tag' : 'Add tags'}
          autoComplete="off"
          onChange={(event) => {
            const { value } = event.target;
            // A pick from the list (not typing: no InputEvent, or a replacement) is a whole tag.
            const native = event.nativeEvent;
            const picked =
              !(native instanceof InputEvent) || native.inputType === 'insertReplacementText';
            if (picked && known.some((tag) => tag.name === value)) {
              add([value]);
              return;
            }
            // A comma ends a tag (a pasted "a, b, c" becomes three).
            const parts = value.split(',');
            const rest = parts.pop() ?? '';
            if (parts.length > 0) add(parts, rest);
            else setText(rest);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add([text]);
            } else if (event.key === 'Backspace' && text === '' && tags.length > 0) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={() => add([text])}
        />
      ) : null}
      <datalist id={list}>
        {known
          .filter((tag) => !tags.some((mine) => mine.toLowerCase() === tag.name.toLowerCase()))
          .map((tag) => (
            <option key={tag.slug} value={tag.name} />
          ))}
      </datalist>
    </div>
  );
}

export interface CoverControls {
  busy: boolean;
  pick: () => void;
  remove: () => void;
}

export function Properties({
  post,
  draft,
  known,
  cover,
  onChange,
}: {
  post: StudioPost;
  draft: Draft;
  known: { tags: TagInfo[]; series: SeriesInfo[] };
  cover: CoverControls;
  onChange: (update: (draft: Draft) => Draft) => void;
}) {
  const ids = {
    summary: useId(),
    address: useId(),
    date: useId(),
    tags: useId(),
    series: useId(),
    part: useId(),
    coverAlt: useId(),
  };
  const set = (patch: Partial<Draft>) => onChange((current) => ({ ...current, ...patch }));

  const autoSlug = slugify(draft.title);
  const slug = draft.slug.trim() || autoSlug;
  const slugProblem = !slug
    ? null
    : RESERVED_SLUGS.has(slug)
      ? `“${slug}” is one of the blog’s own addresses. Choose another.`
      : !isPostSlug(slug)
        ? 'Use lowercase letters, numbers and hyphens.'
        : null;
  const moving = post.status === 'published' && post.slug !== null && slug !== post.slug;

  const series = draft.series;
  const seriesKnown = series ? known.series.some((option) => option.id === series.id) : true;

  return (
    <dl className="properties post-properties">
      <dt>
        <label htmlFor={ids.summary}>Summary</label>
      </dt>
      <dd>
        <textarea
          id={ids.summary}
          className="bare-input post-properties__summary"
          rows={2}
          maxLength={300}
          value={draft.summary}
          placeholder="A sentence or two, for lists, feeds and link previews"
          onChange={(event) => set({ summary: event.target.value.replace(/\n/g, ' ') })}
        />
        {draft.summary.length > 240 ? (
          <span className="hint">{300 - draft.summary.length} characters left</span>
        ) : null}
      </dd>

      <dt>
        <label htmlFor={ids.address}>Address</label>
      </dt>
      <dd>
        <span className="post-properties__address">
          <span className="post-properties__host" aria-hidden="true">
            {location.host}/
          </span>
          <input
            id={ids.address}
            className="bare-input"
            value={draft.slug}
            placeholder={autoSlug || 'from-the-title'}
            maxLength={80}
            spellCheck={false}
            autoCapitalize="off"
            aria-invalid={slugProblem ? true : undefined}
            onChange={(event) => set({ slug: event.target.value })}
            onBlur={() => onChange((current) => ({ ...current, slug: slugify(current.slug) }))}
          />
        </span>
        {slugProblem ? (
          <span className="error-text">{slugProblem}</span>
        ) : moving ? (
          <span className="hint">Links to /{post.slug}/ will still lead here.</span>
        ) : null}
      </dd>

      <dt>
        <label htmlFor={ids.date}>Date</label>
      </dt>
      <dd className="row">
        <input
          id={ids.date}
          className="input input--inline"
          type="date"
          value={draft.date ?? ''}
          onChange={(event) => set({ date: event.target.value || null })}
        />
        {draft.date ? (
          <button
            type="button"
            className="button button--quiet"
            onClick={() => set({ date: null })}
          >
            Clear
          </button>
        ) : (
          <span className="hint">
            {post.publishedAt !== null
              ? `Shows ${shortDate(post.publishedAt)}, when it was first published`
              : 'Empty: the day it’s published'}
          </span>
        )}
      </dd>

      <dt>
        <label htmlFor={ids.tags}>Tags</label>
      </dt>
      <dd>
        <TagInput
          id={ids.tags}
          tags={draft.tags}
          known={known.tags}
          onChange={(tags) => set({ tags })}
        />
      </dd>

      <dt>
        <label htmlFor={ids.series}>Series</label>
      </dt>
      <dd className="row">
        <select
          id={ids.series}
          className="input input--inline"
          value={series?.id ?? ''}
          onChange={(event) =>
            set({
              series: event.target.value
                ? { id: event.target.value, part: series?.part ?? null }
                : null,
            })
          }
        >
          <option value="">None</option>
          {known.series.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title}
            </option>
          ))}
          {series && !seriesKnown ? (
            <option value={series.id}>(a series that is gone)</option>
          ) : null}
        </select>
        {series ? (
          <label className="row post-properties__part" htmlFor={ids.part}>
            <span>Part</span>
            <input
              id={ids.part}
              className="input input--inline"
              type="number"
              inputMode="numeric"
              min={1}
              max={999}
              value={series.part ?? ''}
              onChange={(event) => {
                const part = Number.parseInt(event.target.value, 10);
                set({ series: { id: series.id, part: part >= 1 && part <= 999 ? part : null } });
              }}
            />
          </label>
        ) : (
          <a className="hint" href={hrefFor({ name: 'organize' })} onClick={follow}>
            Series are made in Organize
          </a>
        )}
      </dd>

      <dt>{draft.cover ? <label htmlFor={ids.coverAlt}>Cover</label> : <span>Cover</span>}</dt>
      <dd className="post-properties__cover">
        {draft.cover ? (
          <>
            <input
              id={ids.coverAlt}
              className="bare-input"
              value={draft.cover.alt}
              maxLength={300}
              placeholder="Alt text: what the cover shows"
              onChange={(event) =>
                onChange((current) =>
                  current.cover
                    ? { ...current, cover: { ...current.cover, alt: event.target.value } }
                    : current,
                )
              }
            />
            <span className="row">
              <button
                type="button"
                className="button button--quiet"
                disabled={cover.busy}
                onClick={cover.pick}
              >
                Change
              </button>
              <button type="button" className="button button--quiet" onClick={cover.remove}>
                Remove
              </button>
            </span>
          </>
        ) : (
          <button
            type="button"
            className="button button--quiet"
            disabled={cover.busy}
            onClick={cover.pick}
          >
            {cover.busy ? 'Uploading…' : 'Add an image'}
          </button>
        )}
      </dd>
    </dl>
  );
}
