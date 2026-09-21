import type { z } from 'astro/zod';
import type { resumeSchema } from './schemas';

// src/content/resume.yaml holds one entry per section. The page wants them by name, in an order
// the page chooses, and with every section present: a resume that silently lost its Education
// section must fail the build, not ship.

export type ResumeSection = z.infer<ReturnType<typeof resumeSchema>>;
export type SectionName = ResumeSection['section'];
type ItemsOf<Name extends SectionName> = Extract<ResumeSection, { section: Name }>['items'];

export type Resume = { [Name in SectionName]: ItemsOf<Name> };

export const RESUME_SECTIONS = [
  'education',
  'experience',
  'leadership',
  'skills',
  'awards',
] as const satisfies readonly SectionName[];

export class ResumeError extends Error {}

export function toResume(entries: ReadonlyArray<{ id: string; data: ResumeSection }>): Resume {
  const found = new Map<SectionName, ResumeSection>();
  for (const entry of entries) {
    if (entry.id !== entry.data.section) {
      throw new ResumeError(
        `resume.yaml: the entry "${entry.id}" says section: ${entry.data.section}. Key and section must match.`,
      );
    }
    found.set(entry.data.section, entry.data);
  }

  const items = <Name extends SectionName>(name: Name): ItemsOf<Name> => {
    const section = found.get(name);
    if (section === undefined || section.items.length === 0) {
      throw new ResumeError(`resume.yaml: the "${name}" section is missing or empty.`);
    }
    return section.items as ItemsOf<Name>;
  };

  return {
    education: items('education'),
    experience: items('experience'),
    leadership: items('leadership'),
    skills: items('skills'),
    awards: items('awards'),
  };
}
