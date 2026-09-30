/** The day's quick inputs: the mood beans, the activity chips, people and places. */
import { onRadioKeyDown, radioTabIndex } from '@allenkh/design/radiogroup';
import { FAMILY_KEYS, type FamilyKey } from '@allenkh/design/tokens';
import { Plus, X } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Activities, MoodDef } from '../model/types';
import { Bean } from './Bean';

export function MoodPicker(props: {
  value: number | null;
  moods: MoodDef[];
  onChange: (mood: number | null) => void;
}) {
  const picked = props.moods.findIndex((mood) => mood.value === props.value);
  return (
    <div
      className="moods"
      role="radiogroup"
      aria-label="Mood"
      data-picked={props.value !== null || undefined}
    >
      {props.moods.map((mood, index) => {
        const checked = index === picked;
        return (
          <button
            key={mood.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={radioTabIndex(index, picked)}
            className="mood"
            data-family={mood.family}
            // Clicked again, the mood is taken back: a day may have none.
            onClick={() => props.onChange(checked ? null : mood.value)}
            onKeyDown={onRadioKeyDown}
          >
            <Bean mood={mood.value} family={mood.family} size={48} />
            <span className="mood__label">{mood.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A group's colour: the families in turn, so neighbouring groups differ. */
export const groupFamily = (index: number): FamilyKey =>
  FAMILY_KEYS[index % FAMILY_KEYS.length] as FamilyKey;

export function ActivityPicker(props: {
  activities: Activities;
  selected: readonly string[];
  onToggle: (id: string) => void;
}) {
  const selected = new Set(props.selected);
  return (
    <div className="activities">
      {props.activities.groups.map((group, index) => {
        const items = group.items.filter((item) => !item.archived || selected.has(item.id));
        if (items.length === 0) return null;
        return (
          <section className="activity-group" key={group.id} data-family={groupFamily(index)}>
            <h3 className="activity-group__name">{group.name}</h3>
            <div className="chips">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="chip"
                  aria-pressed={selected.has(item.id)}
                  onClick={() => props.onToggle(item.id)}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  {item.name}
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export interface LinkOption {
  id: string;
  name: string;
  icon: string;
  family: FamilyKey;
}

/**
 * People or places on a day: chips for the linked ones, and a field that finds the rest or
 * makes a new one from what was typed.
 */
export function LinkPicker(props: {
  label: string;
  noun: string;
  options: LinkOption[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  onCreate: (name: string) => string;
  hrefFor: (id: string) => string;
  onOpen: (href: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const byId = useMemo(
    () => new Map(props.options.map((option) => [option.id, option])),
    [props.options],
  );
  const q = query.trim().toLowerCase();
  const matches = props.options
    .filter((option) => !props.selected.includes(option.id))
    .filter((option) => !q || option.name.toLowerCase().includes(q))
    .slice(0, 8);
  const exact = props.options.some((option) => option.name.toLowerCase() === q);

  const add = (id: string) => {
    props.onChange([...props.selected, id]);
    setQuery('');
    input.current?.focus();
  };

  return (
    <div className="links">
      <div className="chips">
        {props.selected.map((id) => {
          const option = byId.get(id);
          if (!option) return null;
          const href = props.hrefFor(id);
          return (
            <span key={id} className="tag link-chip" data-family={option.family}>
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  props.onOpen(href);
                }}
              >
                {option.icon ? <span aria-hidden="true">{option.icon} </span> : null}
                {option.name}
              </a>
              <button
                type="button"
                className="link-chip__remove"
                aria-label={`Remove ${option.name}`}
                onClick={() => props.onChange(props.selected.filter((other) => other !== id))}
              >
                <X aria-hidden="true" />
              </button>
            </span>
          );
        })}
        {open ? (
          <div className="combo">
            <input
              ref={input}
              className="input combo__input"
              role="combobox"
              aria-expanded={matches.length > 0 || Boolean(q)}
              aria-controls={listId}
              aria-label={`Add ${props.noun}`}
              placeholder={`Add ${props.noun}…`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setOpen(false);
                  setQuery('');
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  // The exact name if it is there, else the first match; a new record only
                  // when no one has this name (not even someone already on the day).
                  const pick =
                    matches.find((option) => option.name.toLowerCase() === q) ?? matches[0];
                  if (pick) add(pick.id);
                  else if (q && !exact) add(props.onCreate(query.trim()));
                  else setQuery('');
                }
              }}
              onBlur={() => {
                // Let a click on an option land first.
                setTimeout(() => {
                  if (!input.current?.matches(':focus')) setOpen(false);
                }, 150);
              }}
            />
            <div className="menu combo__menu" id={listId} role="listbox">
              {matches.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected="false"
                  className="menu-item"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => add(option.id)}
                >
                  <span className="menu-item__icon" aria-hidden="true">
                    {option.icon || option.name.slice(0, 1).toUpperCase()}
                  </span>
                  {option.name}
                </button>
              ))}
              {q && !exact ? (
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  className="menu-item"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => add(props.onCreate(query.trim()))}
                >
                  <span className="menu-item__icon" aria-hidden="true">
                    <Plus />
                  </span>
                  New {props.noun}: “{query.trim()}”
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="chip chip--add"
            onClick={() => {
              // The field takes this button's place; focus goes with it.
              flushSync(() => setOpen(true));
              input.current?.focus();
            }}
          >
            <Plus aria-hidden="true" />
            {props.label}
          </button>
        )}
      </div>
    </div>
  );
}
