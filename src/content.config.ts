import { defineCollection, reference } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { entryIdFromPath } from './site/routes';
import { pageSchema, projectSchema, resumeSchema, systemSchema } from './site/schemas';

// The thin Astro wrapper around the content layer (docs/PLAN.md §5.1). Everything with logic in
// it lives in src/site as plain zod and plain functions; this file only says where the content
// is and hands over the two helpers that only Astro can provide: image() and reference().

const generateId = ({ entry }: { entry: string }): string => entryIdFromPath(entry);

export const collections = {
  // One file per solar system: src/content/systems/<id>.md
  systems: defineCollection({
    loader: glob({ base: './src/content/systems', pattern: '*.md', generateId }),
    schema: systemSchema(),
  }),

  // One FOLDER per planet or moon, so its images live beside it: src/content/projects/<id>/index.md
  projects: defineCollection({
    loader: glob({ base: './src/content/projects', pattern: '*/index.md', generateId }),
    schema: ({ image }) => projectSchema({ image, reference }),
  }),

  // About, resume, contact: src/content/pages/<id>.md
  pages: defineCollection({
    loader: glob({ base: './src/content/pages', pattern: '*.md', generateId }),
    schema: pageSchema(),
  }),

  // The resume as data: one entry per section, keyed by section name.
  resume: defineCollection({
    loader: file('src/content/resume.yaml'),
    schema: resumeSchema(),
  }),
};
