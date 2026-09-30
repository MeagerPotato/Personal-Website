/**
 * The editor both sites write with: Notion's way of writing (blocks, "/" to insert one,
 * Markdown shortcuts, a toolbar over selected text) on Tiptap, styled by the shared prose sheet.
 *
 * Controlled, loosely: `value` is the stored document and `onChange` gets the new one, at most
 * every `saveDelayMs` while typing and at once on blur or unmount, so a keystroke is never a
 * save. A new `value` from outside (another device's edit, synced in) replaces the content
 * only while the editor is not focused; while you type, your version wins and the sync's merge
 * keeps the other as a conflict copy.
 */
import { Extension, type Editor, type Extensions, type JSONContent } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { BLOCKS, type BlockItem } from './blocks';
import { schemaExtensions } from './schema';
import { SlashCommands } from './slash';
import { BubbleToolbar, KeyboardToolbar } from './Toolbar';

export type Doc = JSONContent;

export interface RichTextEditorProps {
  value: Doc | null;
  onChange: (value: Doc | null) => void;
  /**
   * Told at once, as you type (saving waits `saveDelayMs`), when the document stops or starts
   * being empty: for what the page shows only beside an empty one.
   */
  onEmptyChange?: (empty: boolean) => void;
  /** Shown while the document is empty ("How was today?"). */
  placeholder?: string;
  /** For assistive technology: what this text is ("Journal entry"). */
  label: string;
  /** Extra blocks for the schema (the blog's images and math) and their catalogue entries. */
  extra?: Extensions;
  blocks?: BlockItem[];
  autofocus?: boolean;
  saveDelayMs?: number;
  className?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    prompt: {
      /** Sets the empty document's prompt and redraws the placeholder. */
      setPrompt: (text: string) => ReturnType;
    };
  }
  interface Storage {
    prompt: { text: string };
  }
}

/**
 * The empty document's prompt ("How was today?"). It can change while the editor lives, so it
 * sits in storage, not in the Placeholder's options, which are fixed when the editor is made.
 */
const Prompt = Extension.create<Record<string, never>, { text: string }>({
  name: 'prompt',
  addStorage: () => ({ text: '' }),
  addCommands() {
    return {
      setPrompt:
        (text) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            this.storage.text = text;
            tr.setMeta('prompt', text); // any transaction redraws the placeholder
          }
          return true;
        },
    };
  },
});

const isEmptyDoc = (doc: JSONContent): boolean => {
  const content = doc.content ?? [];
  if (content.length === 0) return true;
  if (content.length > 1) return false;
  const only = content[0];
  return only?.type === 'paragraph' && !only.content?.length;
};

/** The same test on the live document, cheap enough for every keystroke. */
const isBlank = (editor: Editor): boolean => {
  const { doc } = editor.state;
  const only = doc.firstChild;
  return doc.childCount === 1 && only?.type.name === 'paragraph' && only.content.size === 0;
};

export function RichTextEditor({
  value,
  onChange,
  onEmptyChange,
  placeholder = 'Write something, or type “/” for blocks',
  label,
  extra,
  blocks = BLOCKS,
  autofocus = false,
  saveDelayMs = 400,
  className,
}: RichTextEditorProps) {
  // The latest callbacks, for what fires after a render (a timer, blur, unmount, a keystroke).
  const changeRef = useRef(onChange);
  const emptyChangeRef = useRef(onEmptyChange);
  useLayoutEffect(() => {
    changeRef.current = onChange;
    emptyChangeRef.current = onEmptyChange;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = useRef(false);
  const blank = useRef(value === null || isEmptyDoc(value));

  const extensions = useMemo(
    () => [
      ...schemaExtensions({ extra }),
      SlashCommands.configure({ blocks }),
      Prompt,
      Placeholder.configure({
        showOnlyCurrent: true,
        includeChildren: false,
        placeholder: ({ editor, node }) => {
          if (editor.isEmpty) return editor.storage.prompt.text;
          if (node.type.name === 'heading') return `Heading ${node.attrs['level'] as number}`;
          if (node.type.name === 'detailsSummary') return 'Toggle';
          return 'Type “/” for blocks';
        },
      }),
    ],
    [extra, blocks],
  );

  const editor = useEditor({
    extensions,
    content: value ?? undefined,
    autofocus: autofocus ? 'end' : false,
    // No <style> element: the CSP allows none. editor.css carries ProseMirror's base rules.
    injectCSS: false,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: `prose ${className ?? ''}`.trim(),
        'aria-label': label,
        'aria-multiline': 'true',
        role: 'textbox',
        spellcheck: 'true',
        autocapitalize: 'sentences',
      },
    },
    onUpdate: ({ editor: current }) => {
      const nowBlank = isBlank(current);
      if (nowBlank !== blank.current) {
        blank.current = nowBlank;
        emptyChangeRef.current?.(nowBlank);
      }
      dirty.current = true;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        dirty.current = false;
        changeRef.current(isEmptyDoc(current.getJSON()) ? null : current.getJSON());
      }, saveDelayMs);
    },
    onBlur: ({ editor: current }) => {
      if (!dirty.current) return;
      clearTimeout(timer.current);
      dirty.current = false;
      changeRef.current(isEmptyDoc(current.getJSON()) ? null : current.getJSON());
    },
  });

  // Save what is pending when the editor goes away (navigating to another day).
  useEffect(
    () => () => {
      if (!dirty.current || editor.isDestroyed) return;
      clearTimeout(timer.current);
      dirty.current = false;
      changeRef.current(isEmptyDoc(editor.getJSON()) ? null : editor.getJSON());
    },
    [editor],
  );

  // A new value from outside: take it, unless the person is typing.
  useEffect(() => {
    if (editor.isDestroyed || editor.isFocused || dirty.current) return;
    const next = value ?? { type: 'doc', content: [] };
    if (JSON.stringify(next) === JSON.stringify(editor.getJSON())) return;
    editor.commands.setContent(next, { emitUpdate: false });
    const nowBlank = isBlank(editor);
    if (nowBlank !== blank.current) {
      blank.current = nowBlank;
      emptyChangeRef.current?.(nowBlank);
    }
  }, [editor, value]);

  // The prompt, before the first paint and whenever it changes.
  useLayoutEffect(() => {
    if (!editor.isDestroyed) editor.commands.setPrompt(placeholder);
  }, [editor, placeholder]);

  return (
    <div className="editor">
      <EditorContent editor={editor} />
      <BubbleToolbar editor={editor} blocks={blocks} />
      <KeyboardToolbar editor={editor} blocks={blocks} />
    </div>
  );
}
