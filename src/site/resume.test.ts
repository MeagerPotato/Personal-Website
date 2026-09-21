import { describe, expect, it } from 'vitest';
import { RESUME_SECTIONS, ResumeError, toResume, type ResumeSection } from './resume';
import { resumeSchema } from './schemas';

const role = {
  role: 'Systems Engineering Intern',
  org: 'A Company',
  when: 'Summer 2025',
  bullets: ['Did a thing, and measured it.'],
};

const SECTIONS: Record<string, unknown> = {
  education: {
    section: 'education',
    items: [{ school: 'A University', detail: 'B.S. Something', when: 'Expected May 2030' }],
  },
  experience: { section: 'experience', items: [role] },
  leadership: { section: 'leadership', items: [{ ...role, link: 'https://example.com/' }] },
  skills: { section: 'skills', items: [{ label: 'Programming', values: ['TypeScript'] }] },
  awards: {
    section: 'awards',
    items: [{ title: 'An award' }, { title: 'Another', detail: '2025' }],
  },
};

const parseAll = (sections: Record<string, unknown>) =>
  Object.entries(sections).map(([id, value]) => ({ id, data: resumeSchema().parse(value) }));

describe('resumeSchema', () => {
  it('accepts every section the page renders', () => {
    expect(parseAll(SECTIONS).map((entry) => entry.id)).toEqual([...RESUME_SECTIONS]);
  });

  it('rejects an unknown section and an unknown key: a typo fails the build', () => {
    expect(() => resumeSchema().parse({ section: 'hobbies', items: [] })).toThrow();
    expect(() =>
      resumeSchema().parse({ section: 'experience', items: [{ ...role, phone: 'nope' }] }),
    ).toThrow();
  });

  it('wants at least one bullet per role, and at most five', () => {
    const withBullets = (count: number) => ({
      section: 'experience',
      items: [{ ...role, bullets: Array.from({ length: count }, () => 'Bullet.') }],
    });
    expect(() => resumeSchema().parse(withBullets(0))).toThrow();
    expect(() => resumeSchema().parse(withBullets(5))).not.toThrow();
    expect(() => resumeSchema().parse(withBullets(6))).toThrow();
  });

  it('only takes https links', () => {
    const linked = { section: 'experience', items: [{ ...role, link: 'http://example.com/' }] };
    expect(() => resumeSchema().parse(linked)).toThrow();
  });
});

describe('toResume', () => {
  it('hands the page every section by name, items in file order', () => {
    const resume = toResume(parseAll(SECTIONS));
    expect(Object.keys(resume)).toEqual([...RESUME_SECTIONS]);
    expect(resume.awards.map((award) => award.title)).toEqual(['An award', 'Another']);
    expect(resume.leadership[0]?.link).toBe('https://example.com/');
  });

  it('fails loudly when a section is missing or empty, instead of shipping half a resume', () => {
    const rest = Object.entries(SECTIONS).filter(([id]) => id !== 'education');
    expect(() => toResume(parseAll(Object.fromEntries(rest)))).toThrow(ResumeError);

    const emptied = { ...SECTIONS, awards: { section: 'awards', items: [] } };
    expect(() => toResume(parseAll(emptied))).toThrow(/awards/);
  });

  it('fails when a key and its section disagree (a copy-paste slip in the YAML)', () => {
    const entries = parseAll(SECTIONS).map((entry) =>
      entry.id === 'skills' ? { ...entry, id: 'skillz' } : entry,
    );
    expect(() => toResume(entries as { id: string; data: ResumeSection }[])).toThrow(/skillz/);
  });
});
