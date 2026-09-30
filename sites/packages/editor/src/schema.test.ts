import { getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { schemaExtensions } from './schema';

describe('headings', () => {
  const heading = getSchema(schemaExtensions()).nodes['heading'];
  /** A heading of this level as the editor draws it: [tag, attributes, hole]. */
  const drawn = (level: number) =>
    heading?.spec.toDOM?.(heading.create({ level })) as [string, Record<string, unknown>, 0];

  it('are drawn one level below the page title, and say their stored level', () => {
    expect(drawn(1).slice(0, 2)).toEqual(['h2', { 'data-level': 1 }]);
    expect(drawn(2)[0]).toBe('h3');
    expect(drawn(3)[0]).toBe('h4');
  });

  it('paste back at their own level, and read anyone else’s by the tag', () => {
    const rules = heading?.spec.parseDOM ?? [];
    const levelOf = (tag: string) => {
      const matching = rules.filter((rule) => rule.tag === tag);
      expect(matching).toHaveLength(1);
      return (matching[0] as { attrs?: { level?: number } } | undefined)?.attrs?.level;
    };
    for (const level of [1, 2, 3]) {
      expect(levelOf(`h${level + 1}[data-level="${level}"]`)).toBe(level);
      expect(levelOf(`h${level}`)).toBe(level);
    }
    // The editor's own headings are tried first: its "Heading 1" is an <h2>.
    const own = rules.find((rule) => rule.tag === 'h2[data-level="1"]');
    const theirs = rules.find((rule) => rule.tag === 'h2');
    expect(own?.priority ?? 50).toBeGreaterThan(theirs?.priority ?? 50);
  });
});
