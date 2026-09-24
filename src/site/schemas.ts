import { z } from 'astro/zod';
import { BIOME_KEYS, THEME_KEYS } from '../universe/design/tokens';

// Content schemas as PLAIN zod ("thin Astro", docs/PLAN.md §5.1). The two helpers only Astro can
// provide, image() and reference(), are injected by src/content.config.ts, so these schemas run
// in Vitest as they are and would survive a change of page shell.
//
// Zod 4 notes: strictObject rejects unknown keys (a typo in frontmatter fails the build instead
// of being ignored), and an object with .default({}) would skip its inner defaults.

/** "2026-08". Quote it in YAML so that it stays a string. */
export const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use "YYYY-MM", in quotes');

/** Leave a link out rather than empty: "" fails on purpose. */
export const httpsUrl = z.url({ protocol: /^https$/, error: 'must be a full https:// URL' });

export interface SchemaHelpers<Image extends z.ZodType, Reference extends z.ZodType> {
  /** Astro's image(): resolves a relative path to an optimisable image. */
  image: () => Image;
  /** Astro's reference(): an id in another collection. Existence is asserted in buildUniverse(). */
  reference: (collection: 'systems' | 'projects') => Reference;
}

/** A solar system: one passion. Its sun carries the name and the colour family. */
export const systemSchema = () =>
  z.strictObject({
    name: z.string().min(1).max(32),
    tagline: z.string().min(1).max(120),
    theme: z.enum(THEME_KEYS),
    /** Slot in the galaxy's honeycomb, from 1 (0 is home). Never reuse or renumber: it IS the position. */
    order: z.number().int().min(1),
    position: z.union([z.literal('auto'), z.tuple([z.number(), z.number()])]).default('auto'),
  });

/** A planet (set `system`) or a moon (set `parent`). One schema, one URL shape. */
export const projectSchema = <Image extends z.ZodType, Reference extends z.ZodType>({
  image,
  reference,
}: SchemaHelpers<Image, Reference>) =>
  z.strictObject({
    title: z.string().min(1).max(60),
    /** One sentence. Also the meta description and the link-preview text. */
    summary: z.string().min(1).max(160),
    system: reference('systems').optional(),
    parent: reference('projects').optional(),
    date: yearMonth,
    dateEnd: yearMonth.optional(),
    status: z.enum(['shipped', 'in-progress', 'archived']),
    role: z.string().min(1).max(80),
    stack: z.array(z.string().min(1)).max(12).default([]),
    links: z
      .strictObject({
        repo: httpsUrl.optional(),
        demo: httpsUrl.optional(),
        video: httpsUrl.optional(),
      })
      .default({}),
    cover: z.strictObject({ src: image(), alt: z.string().min(1) }),
    gallery: z
      .array(
        z.strictObject({
          src: image(),
          alt: z.string().min(1),
          caption: z.string().min(1).optional(),
        }),
      )
      .max(8)
      .default([]),
    planet: z.strictObject({
      size: z.enum(['s', 'm', 'l']).default('m'),
      biome: z.enum(BIOME_KEYS),
      rings: z.boolean().default(false),
      decorMoons: z.number().int().min(0).max(3).default(0),
      /** Reseeds the procedural surface without renaming the project. Defaults to the id. */
      seed: z.string().min(1).optional(),
    }),
    flagship: z.boolean().default(false),
    related: z.array(reference('projects')).default([]),
    draft: z.boolean().default(false),
  });

/** About, resume, contact: the bodies of the home system. */
export const pageSchema = () =>
  z.strictObject({
    title: z.string().min(1).max(60),
    summary: z.string().min(1).max(160),
    /** home = the home planet itself; station and satellite orbit it. */
    dock: z.enum(['home', 'station', 'satellite']),
  });

// --- resume.yaml ---------------------------------------------------------------------------------
// One entry per section, keyed by the section's name. `items` is a list, so the order written in
// the file is the order on the page. No phone number and no private email, ever.

const resumeRole = z.strictObject({
  role: z.string().min(1).max(80),
  org: z.string().min(1).max(80),
  location: z.string().min(1).max(60).optional(),
  /** Shown as written ("Summer 2025", "Sep 2022 – May 2026"): a resume knows seasons, not months. */
  when: z.string().min(1).max(40),
  /** One accomplishment per bullet, with a number in it where there is one. */
  bullets: z.array(z.string().min(1).max(320)).min(1).max(5),
  link: httpsUrl.optional(),
});

export const resumeSchema = () =>
  z.discriminatedUnion('section', [
    z.strictObject({
      section: z.literal('education'),
      items: z.array(
        z.strictObject({
          school: z.string().min(1).max(80),
          detail: z.string().min(1).max(160),
          location: z.string().min(1).max(60).optional(),
          /** Shown as written: "Expected May 2030". */
          when: z.string().min(1).max(40),
        }),
      ),
    }),
    z.strictObject({ section: z.literal('experience'), items: z.array(resumeRole) }),
    z.strictObject({ section: z.literal('leadership'), items: z.array(resumeRole) }),
    z.strictObject({
      section: z.literal('skills'),
      items: z.array(
        z.strictObject({
          label: z.string().min(1).max(40),
          values: z.array(z.string().min(1).max(60)).min(1),
        }),
      ),
    }),
    z.strictObject({
      section: z.literal('awards'),
      items: z.array(
        z.strictObject({
          title: z.string().min(1).max(120),
          detail: z.string().min(1).max(160).optional(),
        }),
      ),
    }),
  ]);
