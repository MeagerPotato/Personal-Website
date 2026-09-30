/**
 * Formatting, two ways:
 *   - on a computer, a small toolbar floats over selected text (Notion's): turn into, bold,
 *     italic, underline, strikethrough, code, link, highlight
 *   - on a phone, where the system's own copy/paste bubble owns the selection, a toolbar rides
 *     on top of the keyboard instead: add a block, the common marks, lists, indent, undo, done
 */
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import {
  Bold,
  Check,
  ChevronDown,
  Code,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link as LinkIcon,
  ListTodo,
  Plus,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { currentBlock, type BlockItem } from './blocks';
import { BlockMenu, insertBlockBelow, turnInto } from './slash';

function useMarks(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      highlight: e.isActive('highlight'),
      taskList: e.isActive('taskList'),
      inList: e.isActive('listItem') || e.isActive('taskItem'),
      block: currentBlock(e),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
}

function MarkButton(props: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="toolbar__button"
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.active ?? undefined}
      disabled={props.disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function LinkField({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const [href, setHref] = useState<string>(
    (editor.getAttributes('link')['href'] as string | undefined) ?? '',
  );
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const apply = () => {
    const url = href.trim();
    const chain = editor.chain().focus().extendMarkRange('link');
    if (!url) chain.unsetLink().run();
    else chain.setLink({ href: /^[a-z]+:/i.test(url) ? url : `https://${url}` }).run();
    onDone();
  };
  return (
    <form
      className="toolbar__link"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <input
        ref={input}
        className="bare-input"
        type="url"
        inputMode="url"
        placeholder="Paste a link"
        value={href}
        onChange={(event) => setHref(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone();
        }}
      />
      <MarkButton label="Apply link" onClick={apply}>
        <Check aria-hidden="true" />
      </MarkButton>
    </form>
  );
}

/** Formatting over a text selection (fine pointers only: see KeyboardToolbar for touch). */
export function BubbleToolbar({ editor, blocks }: { editor: Editor; blocks: BlockItem[] }) {
  const marks = useMarks(editor);
  const [mode, setMode] = useState<'marks' | 'link' | 'turn'>('marks');
  const current = blocks.find((item) => item.id === marks.block);

  return (
    <BubbleMenu
      editor={editor}
      className="toolbar toolbar--bubble floating"
      options={{
        placement: 'top',
        offset: 8,
        flip: true,
        shift: true,
        onHide: () => setMode('marks'),
      }}
      shouldShow={({ editor: e, state }) => {
        if (matchMedia('(pointer: coarse)').matches) return false;
        const { empty } = state.selection;
        return !empty && e.isEditable && !e.isActive('codeBlock');
      }}
    >
      {mode === 'link' ? (
        <LinkField editor={editor} onDone={() => setMode('marks')} />
      ) : mode === 'turn' ? (
        <BlockMenu
          items={blocks.filter((item) => item.convertible)}
          command={(item) => {
            turnInto(editor, item);
            setMode('marks');
          }}
        />
      ) : (
        <>
          <button
            type="button"
            className="toolbar__button toolbar__turn"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setMode('turn')}
            aria-label="Turn into"
          >
            {current?.label ?? 'Text'}
            <ChevronDown aria-hidden="true" />
          </button>
          <span className="toolbar__sep" aria-hidden="true" />
          <MarkButton
            label="Bold"
            active={marks.bold}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold aria-hidden="true" />
          </MarkButton>
          <MarkButton
            label="Italic"
            active={marks.italic}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic aria-hidden="true" />
          </MarkButton>
          <MarkButton
            label="Underline"
            active={marks.underline}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <Underline aria-hidden="true" />
          </MarkButton>
          <MarkButton
            label="Strikethrough"
            active={marks.strike}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough aria-hidden="true" />
          </MarkButton>
          <MarkButton
            label="Code"
            active={marks.code}
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            <Code aria-hidden="true" />
          </MarkButton>
          <MarkButton label="Link" active={marks.link} onClick={() => setMode('link')}>
            <LinkIcon aria-hidden="true" />
          </MarkButton>
          <MarkButton
            label="Highlight"
            active={marks.highlight}
            onClick={() => editor.chain().focus().toggleHighlight().run()}
          >
            <Highlighter aria-hidden="true" />
          </MarkButton>
        </>
      )}
    </BubbleMenu>
  );
}

/** Keeps an element on top of the on-screen keyboard (iOS resizes only the visual viewport). */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () =>
      setInset(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}

/** The phone's toolbar: shown while the editor has focus on a touch screen. */
export function KeyboardToolbar({ editor, blocks }: { editor: Editor; blocks: BlockItem[] }) {
  const marks = useMarks(editor);
  const focused = useEditorState({ editor, selector: ({ editor: e }) => e.isFocused });
  const [picking, setPicking] = useState(false);
  const inset = useKeyboardInset();
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (!coarse || (!focused && !picking)) return null;

  return (
    <div className="toolbar toolbar--keyboard" style={{ bottom: `${inset}px` }}>
      {picking ? (
        <div className="toolbar__sheet">
          <BlockMenu
            items={blocks}
            command={(item) => {
              insertBlockBelow(editor, item);
              setPicking(false);
            }}
          />
        </div>
      ) : null}
      <div className="toolbar__row">
        <MarkButton label="Add a block" active={picking} onClick={() => setPicking(!picking)}>
          {picking ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}
        </MarkButton>
        <MarkButton
          label="Bold"
          active={marks.bold}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold aria-hidden="true" />
        </MarkButton>
        <MarkButton
          label="Italic"
          active={marks.italic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic aria-hidden="true" />
        </MarkButton>
        <MarkButton
          label="Strikethrough"
          active={marks.strike}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough aria-hidden="true" />
        </MarkButton>
        <MarkButton
          label="To-do list"
          active={marks.taskList}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        >
          <ListTodo aria-hidden="true" />
        </MarkButton>
        <MarkButton
          label="Indent"
          disabled={!marks.inList}
          onClick={() =>
            editor
              .chain()
              .focus()
              .sinkListItem(marks.taskList ? 'taskItem' : 'listItem')
              .run()
          }
        >
          <IndentIncrease aria-hidden="true" />
        </MarkButton>
        <MarkButton
          label="Outdent"
          disabled={!marks.inList}
          onClick={() =>
            editor
              .chain()
              .focus()
              .liftListItem(marks.taskList ? 'taskItem' : 'listItem')
              .run()
          }
        >
          <IndentDecrease aria-hidden="true" />
        </MarkButton>
        <MarkButton
          label="Undo"
          disabled={!marks.canUndo}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 aria-hidden="true" />
        </MarkButton>
        <MarkButton
          label="Redo"
          disabled={!marks.canRedo}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 aria-hidden="true" />
        </MarkButton>
        <button
          type="button"
          className="toolbar__done"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setPicking(false);
            editor.commands.blur();
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
