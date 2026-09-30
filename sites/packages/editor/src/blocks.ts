/**
 * The block catalogue: every kind of block the "/" menu can insert and "Turn into" can convert
 * to, with the words it answers to. One list, so the two menus never disagree.
 */
import type { Editor, Range } from '@tiptap/core';

export interface BlockItem {
  id: string;
  label: string;
  /** One line under the label in the "/" menu. */
  hint: string;
  /** What else it answers to when typed after "/". */
  keywords: string[];
  /** A glyph for the menu (text, so it needs no icon font). */
  glyph: string;
  /** Markdown shortcut, shown as a hint ("# ", "- "…). */
  shortcut?: string;
  /** Whether "Turn into" offers it (blocks that wrap text; not dividers). */
  convertible: boolean;
  run: (editor: Editor, range?: Range) => void;
}

/** Starts a chain, first deleting the typed "/query" when the "/" menu is the caller. */
const at = (editor: Editor, range?: Range) =>
  range ? editor.chain().focus().deleteRange(range) : editor.chain().focus();

export const BLOCKS: BlockItem[] = [
  {
    id: 'paragraph',
    label: 'Text',
    hint: 'Just start writing.',
    keywords: ['paragraph', 'plain', 'body'],
    glyph: 'Aa',
    convertible: true,
    run: (editor, range) => at(editor, range).setParagraph().run(),
  },
  {
    id: 'heading1',
    label: 'Heading 1',
    hint: 'A big section heading.',
    keywords: ['h1', 'title', 'big'],
    glyph: 'H1',
    shortcut: '# ',
    convertible: true,
    run: (editor, range) => at(editor, range).setHeading({ level: 1 }).run(),
  },
  {
    id: 'heading2',
    label: 'Heading 2',
    hint: 'A medium section heading.',
    keywords: ['h2', 'subtitle'],
    glyph: 'H2',
    shortcut: '## ',
    convertible: true,
    run: (editor, range) => at(editor, range).setHeading({ level: 2 }).run(),
  },
  {
    id: 'heading3',
    label: 'Heading 3',
    hint: 'A small section heading.',
    keywords: ['h3', 'small'],
    glyph: 'H3',
    shortcut: '### ',
    convertible: true,
    run: (editor, range) => at(editor, range).setHeading({ level: 3 }).run(),
  },
  {
    id: 'bulletList',
    label: 'Bulleted list',
    hint: 'A simple list.',
    keywords: ['ul', 'unordered', 'points', 'bullet'],
    glyph: '•',
    shortcut: '- ',
    convertible: true,
    run: (editor, range) => at(editor, range).toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    label: 'Numbered list',
    hint: 'A list with numbers.',
    keywords: ['ol', 'ordered', 'numbers', 'steps'],
    glyph: '1.',
    shortcut: '1. ',
    convertible: true,
    run: (editor, range) => at(editor, range).toggleOrderedList().run(),
  },
  {
    id: 'taskList',
    label: 'To-do list',
    hint: 'Things to tick off.',
    keywords: ['todo', 'task', 'checkbox', 'check'],
    glyph: '☐',
    shortcut: '[] ',
    convertible: true,
    run: (editor, range) => at(editor, range).toggleTaskList().run(),
  },
  {
    id: 'details',
    label: 'Toggle',
    hint: 'Hide what is inside until it is opened.',
    keywords: ['toggle', 'collapse', 'details', 'fold', 'spoiler'],
    glyph: '▸',
    convertible: true,
    run: (editor, range) => at(editor, range).setDetails().run(),
  },
  {
    id: 'blockquote',
    label: 'Quote',
    hint: 'Set a quotation apart.',
    keywords: ['quote', 'blockquote', 'citation'],
    glyph: '❝',
    shortcut: '> ',
    convertible: true,
    run: (editor, range) => at(editor, range).toggleBlockquote().run(),
  },
  {
    id: 'callout',
    label: 'Callout',
    hint: 'Make something stand out.',
    keywords: ['note', 'tip', 'info', 'box', 'aside', 'warning'],
    glyph: '💡',
    convertible: true,
    run: (editor, range) => at(editor, range).setCallout().run(),
  },
  {
    id: 'codeBlock',
    label: 'Code',
    hint: 'A block of code.',
    keywords: ['code', 'snippet', 'pre', 'program'],
    glyph: '</>',
    shortcut: '``` ',
    convertible: true,
    run: (editor, range) => at(editor, range).toggleCodeBlock().run(),
  },
  {
    id: 'horizontalRule',
    label: 'Divider',
    hint: 'A line between sections.',
    keywords: ['hr', 'line', 'separator', 'rule'],
    glyph: '—',
    shortcut: '--- ',
    convertible: false,
    run: (editor, range) => at(editor, range).setHorizontalRule().run(),
  },
];

/** Items matching what was typed after "/", best first. */
export function filterBlocks(blocks: readonly BlockItem[], query: string): BlockItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...blocks];
  const score = (item: BlockItem): number => {
    const label = item.label.toLowerCase();
    if (label.startsWith(q)) return 3;
    if (item.keywords.some((keyword) => keyword.startsWith(q))) return 2;
    if (label.includes(q) || item.keywords.some((keyword) => keyword.includes(q))) return 1;
    return 0;
  };
  return blocks
    .map((item) => ({ item, score: score(item) }))
    .filter(({ score: s }) => s > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}

/** Which catalogue entry describes the block the selection is in (for "Turn into"). */
export function currentBlock(editor: Editor): string {
  if (editor.isActive('taskList')) return 'taskList';
  if (editor.isActive('bulletList')) return 'bulletList';
  if (editor.isActive('orderedList')) return 'orderedList';
  if (editor.isActive('callout')) return 'callout';
  if (editor.isActive('blockquote')) return 'blockquote';
  if (editor.isActive('details')) return 'details';
  if (editor.isActive('codeBlock')) return 'codeBlock';
  for (const level of [1, 2, 3] as const) {
    if (editor.isActive('heading', { level })) return `heading${level}`;
  }
  return 'paragraph';
}
