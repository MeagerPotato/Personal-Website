/**
 * The "/" menu: type a slash at the start of a line (or after a space) and pick a block. The
 * list filters as you type ("/to" → To-do list, Toggle), arrows move, Enter inserts, Escape
 * closes. Built on Tiptap's Suggestion utility, which also positions it (Floating UI).
 */
import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import { Suggestion, type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { BLOCKS, filterBlocks, type BlockItem } from './blocks';

interface MenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface MenuProps {
  items: BlockItem[];
  command: (item: BlockItem) => void;
  ref?: Ref<MenuHandle>;
}

export function BlockMenu({ items, command, ref }: MenuProps) {
  // The highlighted row belongs to the list it was picked in: a new list (the query changed)
  // starts again at the top.
  const [choice, setChoice] = useState({ items, index: 0 });
  const selected = choice.items === items ? choice.index : 0;
  const select = (index: number) => setChoice({ items, index });
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (items.length === 0) return false;
      if (event.key === 'ArrowDown') {
        select((selected + 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowUp') {
        select((selected - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = items[selected];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  return (
    <div className="menu slash-menu" ref={list} role="listbox" aria-label="Insert a block">
      {items.length === 0 ? (
        <div className="menu-label">No blocks match</div>
      ) : (
        <>
          <div className="menu-label">Blocks</div>
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className="menu-item"
              role="option"
              data-index={index}
              aria-selected={index === selected}
              // Keep the editor's selection: a click here must not blur it first.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => select(index)}
              onClick={() => command(item)}
            >
              <span className="menu-item__icon" aria-hidden="true">
                {item.glyph}
              </span>
              <span className="slash-menu__text">
                <span>{item.label}</span>
                <span className="slash-menu__hint">{item.hint}</span>
              </span>
              {item.shortcut ? <kbd className="menu-item__hint">{item.shortcut.trim()}</kbd> : null}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

export interface SlashOptions {
  blocks: BlockItem[];
}

const slashKey = new PluginKey('slash');

export const SlashCommands = Extension.create<SlashOptions>({
  name: 'slashCommands',

  addOptions() {
    return { blocks: BLOCKS };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<BlockItem, BlockItem>({
        editor: this.editor,
        pluginKey: slashKey,
        char: '/',
        placement: 'bottom-start',
        offset: { mainAxis: 6 },
        items: ({ query }) => filterBlocks(this.options.blocks, query),
        // Not inside code, where a slash is just a slash.
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let renderer: ReactRenderer<MenuHandle, MenuProps> | null = null;
          let unmount: (() => void) | null = null;
          const toProps = (props: SuggestionProps<BlockItem, BlockItem>): MenuProps => ({
            items: props.items,
            command: props.command,
          });
          return {
            onStart(props) {
              renderer = new ReactRenderer(BlockMenu, {
                props: toProps(props),
                editor: props.editor,
              });
              renderer.element.classList.add('floating');
              unmount = props.mount(renderer.element);
            },
            onUpdate(props) {
              renderer?.updateProps(toProps(props));
            },
            onKeyDown({ event }: SuggestionKeyDownProps) {
              if (event.key === 'Escape') {
                unmount?.();
                unmount = null;
                return true;
              }
              return renderer?.ref?.onKeyDown(event) ?? false;
            },
            onExit() {
              unmount?.();
              renderer?.destroy();
              unmount = null;
              renderer = null;
            },
          };
        },
      }),
    ];
  },
});

/** Inserts a block below the current one (the "+" of the phone toolbar and the block handle). */
export function insertBlockBelow(editor: Editor, item: BlockItem): void {
  const { $from } = editor.state.selection;
  const block = $from.node(1) ?? $from.parent;
  const isEmptyParagraph = block.type.name === 'paragraph' && block.content.size === 0;
  if (isEmptyParagraph) {
    item.run(editor);
    return;
  }
  const end = $from.depth >= 1 ? $from.after(1) : editor.state.doc.content.size;
  editor
    .chain()
    .focus()
    .insertContentAt(end, { type: 'paragraph' })
    .setTextSelection(end + 1)
    .run();
  item.run(editor);
}

/** Converts the current block ("Turn into"): unwraps it to a paragraph, then applies the kind. */
export function turnInto(editor: Editor, item: BlockItem, range?: Range): void {
  if (!range) editor.chain().focus().clearNodes().run();
  item.run(editor, range);
}
