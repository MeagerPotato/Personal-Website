/** Fields shared by the record pages: an emoji icon, a colour family, a set of choices. */
import { onRadioKeyDown, radioTabIndex } from '@allenkh/design/radiogroup';
import { FAMILY_KEYS, type FamilyKey } from '@allenkh/design/tokens';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';

const FAMILY_NAMES: Record<FamilyKey, string> = {
  coral: 'Coral',
  butter: 'Butter',
  mint: 'Mint',
  sky: 'Sky',
  lilac: 'Lilac',
};

/** Keeps the first grapheme typed or pasted: one emoji (or one letter). */
function firstGrapheme(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (typeof Intl.Segmenter === 'function') {
    const first = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      .segment(trimmed)
      [Symbol.iterator]()
      .next();
    return first.done ? '' : first.value.segment;
  }
  return Array.from(trimmed)[0] ?? '';
}

/** An emoji as the record's icon: tap it and type or paste another (the system emoji keyboard). */
export function IconField(props: {
  value: string;
  label: string;
  onChange: (icon: string) => void;
  fallback?: string;
}) {
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return editing ? (
    <input
      ref={input}
      className="icon-field icon-field--editing"
      aria-label={props.label}
      defaultValue={props.value}
      onFocus={(event) => event.target.select()}
      onBlur={(event) => {
        setEditing(false);
        const icon = firstGrapheme(event.target.value);
        if (icon !== props.value) props.onChange(icon);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
      }}
    />
  ) : (
    <button
      type="button"
      className="icon-field"
      aria-label={`${props.label}: ${props.value || 'none'}. Change`}
      onClick={() => {
        // The field takes this button's place; focus goes with it.
        flushSync(() => setEditing(true));
        input.current?.focus();
      }}
    >
      {props.value || props.fallback || '＋'}
    </button>
  );
}

export function FamilyPicker(props: {
  value: FamilyKey;
  label?: string;
  onChange: (family: FamilyKey) => void;
}) {
  const picked = FAMILY_KEYS.indexOf(props.value);
  return (
    <div className="swatches" role="radiogroup" aria-label={props.label ?? 'Colour'}>
      {FAMILY_KEYS.map((family, index) => (
        <button
          key={family}
          type="button"
          role="radio"
          aria-checked={index === picked}
          tabIndex={radioTabIndex(index, picked)}
          aria-label={FAMILY_NAMES[family]}
          title={FAMILY_NAMES[family]}
          className="swatch"
          data-family={family}
          onClick={() => props.onChange(family)}
          onKeyDown={onRadioKeyDown}
        />
      ))}
    </div>
  );
}

export function Segmented<T extends string | number>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const picked = props.options.findIndex((option) => option.value === props.value);
  return (
    <div className="segmented" role="radiogroup" aria-label={props.label}>
      {props.options.map((option, index) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={index === picked}
          tabIndex={radioTabIndex(index, picked)}
          onClick={() => props.onChange(option.value)}
          onKeyDown={onRadioKeyDown}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
