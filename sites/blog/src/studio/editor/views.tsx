/**
 * How the blog's own blocks look and are edited in the studio (their stored form is in
 * editor/nodes.ts): an image with its caption and alt text, math that opens its LaTeX while it
 * is being edited, and code with a language menu.
 */
import type { Editor } from '@tiptap/core';
import { Selection } from '@tiptap/pm/state';
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { LANGUAGES } from '../../editor/lowlight';
import { mediaUrl, pickWidth, type ImageAttrs } from '../../editor/nodes';
import { drawMath, typeset } from '../math';

export function ImageView({ node, updateAttributes }: ReactNodeViewProps) {
  const attrs = node.attrs as ImageAttrs;
  return (
    <NodeViewWrapper as="figure" className="studio-figure">
      <img
        src={mediaUrl(attrs.id, pickWidth(attrs.widths, 1280), attrs.ext)}
        alt={attrs.alt}
        width={attrs.width || undefined}
        height={attrs.height || undefined}
        contentEditable={false}
        draggable={false}
        data-drag-handle
      />
      <NodeViewContent<'figcaption'> as="figcaption" className="studio-figure__caption" />
      <label className="studio-figure__alt" contentEditable={false}>
        <span>Alt text</span>
        <input
          className="bare-input"
          value={attrs.alt}
          maxLength={300}
          placeholder="What the image shows, for people who can’t see it"
          onChange={(event) => updateAttributes({ alt: event.target.value })}
        />
      </label>
    </NodeViewWrapper>
  );
}

/** Typesets LaTeX into the element behind the returned ref, and says what is wrong with it. */
function useMath<T extends HTMLElement>(latex: string, display: boolean) {
  const target = useRef<T>(null);
  const result = useMemo(() => typeset(latex, display), [latex, display]);
  useLayoutEffect(() => {
    if (target.current) drawMath(target.current, result, latex);
  }, [result, latex]);
  return { target, error: result.error };
}

/**
 * Whether a math node's LaTeX is open: from when it is new or selected (a click, or the arrow
 * keys) until it is left (Enter, Escape, or a click elsewhere on the page).
 */
function useOpen(selected: boolean, latex: string) {
  const [open, setOpen] = useState(latex.trim() === '');
  const [wasSelected, setWasSelected] = useState(selected);
  if (selected !== wasSelected) {
    setWasSelected(selected);
    if (selected) setOpen(true);
  }
  return [open, setOpen] as const;
}

/**
 * Focuses the LaTeX field once it opens: two frames later, after the editor's own focus (Tiptap
 * focuses in the next frame, and would take it back).
 */
function useFocusWhen(
  open: boolean,
  field: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
) {
  useEffect(() => {
    if (!open) return undefined;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => field.current?.focus());
    });
    return () => cancelAnimationFrame(frame);
  }, [open, field]);
}

/** Leaves a math node: the cursor goes just after it (after a block, into the next text). */
function leave(editor: Editor, getPos: () => number | undefined, size: number) {
  const at = getPos();
  if (typeof at !== 'number') return;
  const after = at + size;
  const { doc } = editor.state;
  const next = Selection.findFrom(doc.resolve(after), 1, true);
  if (next) {
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.setSelection(next);
        return true;
      })
      .run();
  } else {
    editor
      .chain()
      .focus()
      .insertContentAt(after, { type: 'paragraph' })
      .setTextSelection(after + 1)
      .run();
  }
}

/** Closing the field when the page (not the window) moves focus elsewhere. */
const closeOnBlur = (close: () => void) => () => {
  if (document.hasFocus()) close();
};

export function MathInlineView({
  node,
  updateAttributes,
  selected,
  editor,
  getPos,
}: ReactNodeViewProps) {
  const latex = String(node.attrs['latex'] ?? '');
  const [open, setOpen] = useOpen(selected, latex);
  const { target, error } = useMath<HTMLSpanElement>(latex, false);
  const field = useRef<HTMLInputElement>(null);
  useFocusWhen(open, field);
  const done = () => {
    setOpen(false);
    leave(editor, getPos, node.nodeSize);
  };
  return (
    <NodeViewWrapper
      as="span"
      className="studio-math studio-math--inline"
      data-open={open || undefined}
    >
      <span ref={target} className="math-inline" />
      {latex.trim() === '' && !open ? <span className="studio-math__empty">Math</span> : null}
      {open ? (
        <span className="studio-math__editor" contentEditable={false}>
          <input
            ref={field}
            className="studio-math__input"
            value={latex}
            size={Math.max(12, latex.length + 2)}
            aria-label="Inline math, in LaTeX"
            aria-invalid={error ? true : undefined}
            placeholder="E = mc^2"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(event) => updateAttributes({ latex: event.target.value })}
            onBlur={closeOnBlur(() => setOpen(false))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'Escape') {
                event.preventDefault();
                done();
              }
            }}
          />
          {error ? (
            <span className="studio-math__error" role="status">
              {error}
            </span>
          ) : null}
        </span>
      ) : null}
    </NodeViewWrapper>
  );
}

export function MathBlockView({
  node,
  updateAttributes,
  selected,
  editor,
  getPos,
}: ReactNodeViewProps) {
  const latex = String(node.attrs['latex'] ?? '');
  const [open, setOpen] = useOpen(selected, latex);
  const { target, error } = useMath<HTMLDivElement>(latex, true);
  const field = useRef<HTMLTextAreaElement>(null);
  useFocusWhen(open, field);
  const done = () => {
    setOpen(false);
    leave(editor, getPos, node.nodeSize);
  };
  return (
    <NodeViewWrapper className="studio-math studio-math--block" data-open={open || undefined}>
      <div ref={target} className="math-block" />
      {latex.trim() === '' && !open ? (
        <div className="studio-math__empty">Empty math block</div>
      ) : null}
      {open ? (
        <div className="studio-math__editor" contentEditable={false}>
          <textarea
            ref={field}
            className="studio-math__source"
            value={latex}
            rows={Math.min(10, Math.max(2, latex.split('\n').length))}
            aria-label="Math block, in LaTeX"
            aria-invalid={error ? true : undefined}
            placeholder={'\\int_0^T F(t)\\,dt'}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(event) => updateAttributes({ latex: event.target.value })}
            onBlur={closeOnBlur(() => setOpen(false))}
            onKeyDown={(event) => {
              if (
                event.key === 'Escape' ||
                (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
              ) {
                event.preventDefault();
                done();
              }
            }}
          />
          <p className={error ? 'studio-math__error' : 'studio-math__hint'} role="status">
            {error ?? 'LaTeX. Ctrl+Enter or Esc when done.'}
          </p>
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}

export function CodeBlockView({ node, updateAttributes }: ReactNodeViewProps) {
  const language = typeof node.attrs['language'] === 'string' ? node.attrs['language'] : null;
  // A language set before the menu knew it (or pasted in) stays choosable.
  const options =
    language && !LANGUAGES.some((option) => option.id === language)
      ? [...LANGUAGES, { id: language, label: language }]
      : LANGUAGES;
  return (
    <NodeViewWrapper className="studio-code">
      <select
        className="studio-code__language"
        contentEditable={false}
        aria-label="Language"
        value={language ?? 'plaintext'}
        onChange={(event) =>
          updateAttributes({
            language: event.target.value === 'plaintext' ? null : event.target.value,
          })
        }
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <pre>
        <NodeViewContent<'code'>
          as="code"
          className={language ? `hljs language-${language}` : 'hljs'}
        />
      </pre>
    </NodeViewWrapper>
  );
}
