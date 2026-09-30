/**
 * The month as a picture to share: drawn on a canvas, in the journal's colours and typeface, as
 * a PNG. Only what the month review's switches allow goes in, and the picture is made on this
 * device: the journal never publishes anything.
 *
 * Sizes: portrait (1080 × 1350, a feed post), story (1080 × 1920), square (1080 × 1080). The
 * parts stack from the top. When they do not all fit, the calendar shrinks first (and moves the
 * mood summary and activities into a column beside it), then the photos; only then is a part
 * left out (the note first), and the caller is told which. Room left over goes to the photos, as
 * far as their own shape allows.
 */
import { monthGrid, monthName, shortDate, weekdayNames } from '../model/dates';
import type { MonthSummary } from '../model/stats';
import type { Activities, MonthReview, MoodDef, Photo } from '../model/types';

export type SnapshotSize = 'portrait' | 'story' | 'square';

export const SIZES: Record<SnapshotSize, { width: number; height: number; label: string }> = {
  portrait: { width: 1080, height: 1350, label: 'Post' },
  story: { width: 1080, height: 1920, label: 'Story' },
  square: { width: 1080, height: 1080, label: 'Square' },
};

export interface SnapshotInput {
  review: MonthReview;
  summary: MonthSummary;
  moods: MoodDef[];
  activities: Activities;
  weekStart: 0 | 1;
  /** The chosen photos, already opened (from the thumbnails' or files' blob URLs). */
  photos: { photo: Photo; image: ImageBitmap }[];
  /** Each day's mood and star, by date. */
  days: Map<string, { mood: number | null; highlight: boolean }>;
  /** The highlighted days, each with the first words of its entry. */
  highlights: { date: string; excerpt: string }[];
  /** A short excerpt of the month's note, if it is shared. */
  noteExcerpt: string;
  size: SnapshotSize;
}

/** The theme's colours, read from the page (so the picture follows the tokens). */
function palette() {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    bg: read('--bg'),
    sunken: read('--sunken'),
    line: read('--line'),
    ink: read('--ink-high'),
    mid: read('--ink-mid'),
    low: read('--ink-low'),
    faint: read('--ink-faint'),
    onFamily: read('--on-family'),
    family: (key: string, part: 'base' | 'tint' | 'ink') => read(`--${key}-${part}`),
    font: read('--font-body') || 'sans-serif',
  };
}

type Palette = ReturnType<typeof palette>;

// The bean, from ui/Bean.tsx, in a 48-unit box.
const BEAN =
  'M25.2 6.2c8.9.6 15.4 7.2 15.9 15.9.5 9.8-5.3 18.9-15.4 19.8C15.4 42.8 6.9 36.6 6.9 26.4 6.9 15 14.7 5.5 25.2 6.2Z';
const FACES: Record<number, { eyes: 'dots' | string; mouth: string; fill?: boolean }> = {
  5: {
    eyes: 'M16.6 23.2q2.4-3.2 4.8 0M27.4 23.2q2.4-3.2 4.8 0',
    mouth: 'M18.4 28.4q5.8 6.4 11.6 0Z',
    fill: true,
  },
  4: { eyes: 'dots', mouth: 'M19.2 29q4.8 4 9.6 0' },
  3: { eyes: 'dots', mouth: 'M19.6 30.4h8.8' },
  2: { eyes: 'dots', mouth: 'M19.4 31.8q4.6-3.4 9.2 0' },
  1: { eyes: 'M16.4 21.2l4.4 2.2M31.8 21.2l-4.4 2.2', mouth: 'M18.6 32.6q5.4-5 10.8 0' },
};

function drawBean(
  ctx: CanvasRenderingContext2D,
  p: Palette,
  mood: number | null,
  family: string | undefined,
  x: number,
  y: number,
  size: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 48, size / 48);
  const body = new Path2D(BEAN);
  if (mood === null || !family) {
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = p.faint;
    ctx.stroke(body);
    ctx.restore();
    return;
  }
  ctx.fillStyle = p.family(family, 'base');
  ctx.fill(body);
  const face = FACES[mood];
  if (face) {
    ctx.strokeStyle = p.onFamily;
    ctx.fillStyle = p.onFamily;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (face.eyes === 'dots') {
      for (const cx of [19, 29.4]) {
        ctx.beginPath();
        ctx.arc(cx, 22.4, 1.9, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.stroke(new Path2D(face.eyes));
    }
    const mouth = new Path2D(face.mouth);
    if (face.fill) ctx.fill(mouth);
    else ctx.stroke(mouth);
  }
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Wraps text into lines no wider than `width`; at most `max` lines, the last one ellipsised. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === max) break;
  }
  if (lines.length < max && line) lines.push(line);
  if (lines.length === max && words.join(' ') !== lines.join(' ')) {
    let last = lines[max - 1] ?? '';
    while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    lines[max - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}

/** The parts the review's switches turn on (the calendar and mood bar are "mood"). */
export type SnapshotPart = keyof MonthReview['share'];

/** Left out in this order when the shape has no room for everything: the note first. */
const LEAVE_OUT: SnapshotPart[] = ['note', 'highlights', 'photos', 'activities'];

export interface Snapshot {
  blob: Blob;
  /** Parts that were switched on but did not fit this shape. */
  omitted: SnapshotPart[];
}

const PAD = 72;
/** Between blocks, top to bottom. */
const GAP = 28;
/** Between the calendar and the column beside it. */
const COLUMN_GAP = 48;
/** Between photos side by side. */
const PHOTO_GAP = 16;
/** Kept free at the bottom for the journal's mark. */
const MARK = 56;
const HEADER = 150;
const CHIP = 52;
const CHIP_GAP = 12;
const LINE = 36;
const HIGHLIGHT = 52;
const NOTE_LINE = 44;

/** One way to arrange the picture: tried from the roomiest down until everything fits. */
interface Plan {
  /** A calendar cell, in pixels. */
  cell: number;
  /** The mood summary and the activities in a column beside the calendar, not below it. */
  beside: boolean;
  photoHeight: number;
}

export async function renderSnapshot(input: SnapshotInput): Promise<Snapshot> {
  const { width, height } = SIZES[input.size];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas here');
  const p = palette();
  await Promise.all([
    document.fonts.load(`650 64px ${p.font}`),
    document.fonts.load(`400 30px ${p.font}`),
  ]).catch(() => undefined);

  const inner = width - PAD * 2;
  const room = height - PAD * 2 - MARK;
  const font = (weight: number, size: number) => `${weight} ${size}px ${p.font}`;
  const familyOf = (mood: number | null) => input.moods.find((m) => m.value === mood)?.family;
  const { review, summary } = input;
  const rows = monthGrid(review.month, input.weekStart);
  const totalMoods = input.moods.reduce((sum, m) => sum + (summary.moods[m.value] ?? 0), 0);

  const names = new Map(
    input.activities.groups.flatMap((g) => g.items.map((i) => [i.id, i] as const)),
  );
  const chips = summary.topActivities
    .flatMap(({ id, count }) => {
      const item = names.get(id);
      return item ? [`${item.icon} ${item.name}  ${count}`] : [];
    })
    .slice(0, 8);
  const highlights = input.highlights.slice(0, 3);
  const photos = input.photos.slice(0, 4);

  // What is switched on and has something to show.
  const wanted = new Set<SnapshotPart>(
    (Object.keys(review.share) as SnapshotPart[]).filter((part) => review.share[part]),
  );
  if (chips.length === 0) wanted.delete('activities');
  if (photos.length === 0) wanted.delete('photos');
  if (highlights.length === 0) wanted.delete('highlights');
  if (!input.noteExcerpt) wanted.delete('note');

  // --- Measuring ----------------------------------------------------------------------------------

  const calendarHeight = (cell: number) => 40 + rows.length * cell;

  const summaryWords = () => {
    const top = input.moods.find((m) => m.value === summary.topMood);
    return [
      `${summary.entries} ${summary.entries === 1 ? 'day' : 'days'} written`,
      top ? `mostly ${top.label.toLowerCase()}` : '',
      summary.longestStreak > 2 ? `${summary.longestStreak}-day streak` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  };
  const summaryLines = (w: number) => {
    ctx.font = font(500, 26);
    return wrap(ctx, summaryWords(), w, 3);
  };
  /** The mood bar and the line under it. */
  const summaryHeight = (w: number) =>
    (totalMoods > 0 ? 28 + 20 : 0) + summaryLines(w).length * LINE;

  /** Chips in lines no wider than `w`, at most `max` lines. */
  const chipLines = (w: number, max: number) => {
    ctx.font = font(500, 28);
    const lines: { text: string; w: number }[][] = [];
    let line: { text: string; w: number }[] = [];
    let used = 0;
    for (const text of chips) {
      const chipWidth = Math.min(ctx.measureText(text).width + 40, w);
      if (line.length > 0 && used + chipWidth > w) {
        lines.push(line);
        if (lines.length === max) return lines;
        line = [];
        used = 0;
      }
      line.push({ text, w: chipWidth });
      used += chipWidth + CHIP_GAP;
    }
    if (line.length > 0 && lines.length < max) lines.push(line);
    return lines;
  };
  const linesHeight = (count: number) => (count > 0 ? count * (CHIP + CHIP_GAP) - CHIP_GAP : 0);

  const noteLines = (w: number) => {
    ctx.font = font(400, 32);
    return wrap(ctx, `“${input.noteExcerpt}”`, w, 4);
  };

  /** Beside the calendar: the summary, then as many lines of chips as the calendar is tall. */
  const columnWidth = (cell: number) => inner - cell * 7 - COLUMN_GAP;
  const columnChipLines = (cell: number, parts: Set<SnapshotPart>) => {
    if (!parts.has('activities')) return 0;
    // The column starts level with the first row of beans, under the weekday letters.
    const free = calendarHeight(cell) - 40 - summaryHeight(columnWidth(cell)) - GAP;
    return Math.max(0, Math.floor((free + CHIP_GAP) / (CHIP + CHIP_GAP)));
  };

  const stack = (heights: number[]) =>
    heights.reduce((sum, h) => sum + h, 0) + GAP * Math.max(0, heights.length - 1);

  const measure = (plan: Plan, parts: Set<SnapshotPart>): number => {
    const heights = [HEADER];
    if (parts.has('mood')) {
      if (plan.beside) {
        heights.push(calendarHeight(plan.cell));
      } else {
        heights.push(calendarHeight(plan.cell), summaryHeight(inner));
        if (parts.has('activities')) heights.push(linesHeight(chipLines(inner, 2).length));
      }
    } else if (parts.has('activities')) {
      heights.push(linesHeight(chipLines(inner, 3).length));
    }
    if (parts.has('photos')) heights.push(plan.photoHeight);
    if (parts.has('highlights')) heights.push(highlights.length * HIGHLIGHT);
    if (parts.has('note')) heights.push(noteLines(inner).length * NOTE_LINE);
    return stack(heights);
  };

  // --- Choosing a plan: a big calendar across the page if there is room, else a smaller one
  // with the summary beside it; big photos before small ones. Only then is a part left out. ----

  const photoHeights = wanted.has('mood') ? [340, 280, 220, 180] : [480, 400, 320, 240];
  const plans: Plan[] = [];
  for (const cell of [Math.floor(inner / 7), 124, 116]) {
    for (const photoHeight of photoHeights) plans.push({ cell, beside: false, photoHeight });
  }
  for (const cell of [88, 80, 72]) {
    for (const photoHeight of photoHeights) plans.push({ cell, beside: true, photoHeight });
  }
  const parts = new Set(wanted);
  const omitted: SnapshotPart[] = [];
  let plan = plans.find((candidate) => measure(candidate, parts) <= room);
  for (const part of LEAVE_OUT) {
    if (plan) break;
    if (!parts.delete(part)) continue;
    omitted.push(part);
    plan = plans.find((candidate) => measure(candidate, parts) <= room);
  }
  plan ??= plans[plans.length - 1] as Plan;

  // Room left over (a story is tall) goes to the photos: up to their average height at this
  // width, so that they show more of themselves rather than less, and never past 3:4.
  if (parts.has('photos')) {
    const w = (inner - PHOTO_GAP * (photos.length - 1)) / photos.length;
    const natural =
      photos.reduce((sum, { image }) => sum + (w * image.height) / Math.max(image.width, 1), 0) /
      photos.length;
    const tallest = Math.min(natural, (w * 4) / 3);
    const slack = room - measure(plan, parts);
    const grown = Math.floor(Math.min(plan.photoHeight + slack, tallest));
    plan = { ...plan, photoHeight: Math.max(plan.photoHeight, grown) };
  }

  // --- Drawing ---------------------------------------------------------------------------------------

  const drawHeader = (y: number) => {
    ctx.fillStyle = p.low;
    ctx.font = font(600, 28);
    ctx.fillText(monthName(review.month).toUpperCase(), PAD, y + 30);
    ctx.fillStyle = p.ink;
    ctx.font = font(680, 64);
    const title = review.title.trim() || `My ${monthName(review.month).split(' ')[0]}`;
    ctx.fillText(wrap(ctx, title, inner, 1)[0] ?? title, PAD, y + 108);
  };

  const drawCalendar = (x: number, y: number, cell: number) => {
    const bean = Math.round(cell * 0.72);
    ctx.font = font(600, 22);
    ctx.fillStyle = p.low;
    ctx.textAlign = 'center';
    weekdayNames(input.weekStart, 'narrow').forEach((name, i) =>
      ctx.fillText(name, x + cell * i + cell / 2, y + 24),
    );
    ctx.textAlign = 'left';
    rows.forEach((row, r) =>
      row.forEach((date, c) => {
        if (!date) return;
        const day = input.days.get(date);
        const left = x + c * cell + (cell - bean) / 2;
        const top = y + 40 + r * cell + (cell - bean) / 2;
        drawBean(ctx, p, day?.mood ?? null, familyOf(day?.mood ?? null), left, top, bean);
        if (day?.highlight) {
          ctx.fillStyle = p.family('butter', 'base');
          ctx.beginPath();
          ctx.arc(left + bean - 4, top + 6, Math.max(5, bean / 10), 0, Math.PI * 2);
          ctx.fill();
        }
      }),
    );
  };

  /** The mood bar and the summary line; returns the height used. */
  const drawSummary = (x: number, y: number, w: number) => {
    let top = y;
    if (totalMoods > 0) {
      let left = x;
      for (const mood of input.moods) {
        const count = summary.moods[mood.value] ?? 0;
        if (!count) continue;
        const part = (count / totalMoods) * w;
        ctx.fillStyle = p.family(mood.family, 'base');
        roundRect(ctx, left, top, Math.max(part - 4, 4), 28, 14);
        ctx.fill();
        left += part;
      }
      top += 28 + 20;
    }
    ctx.fillStyle = p.mid;
    for (const line of summaryLines(w)) {
      ctx.font = font(500, 26);
      ctx.fillText(line, x, top + 26);
      top += LINE;
    }
    return top - y;
  };

  const drawChips = (x: number, y: number, lines: { text: string; w: number }[][]) => {
    ctx.font = font(500, 28);
    lines.forEach((line, i) => {
      let left = x;
      const top = y + i * (CHIP + CHIP_GAP);
      for (const chip of line) {
        ctx.fillStyle = p.sunken;
        roundRect(ctx, left, top, chip.w, CHIP, CHIP / 2);
        ctx.fill();
        ctx.fillStyle = p.ink;
        ctx.fillText(wrap(ctx, chip.text, chip.w - 40, 1)[0] ?? chip.text, left + 20, top + 36);
        left += chip.w + CHIP_GAP;
      }
    });
  };

  const drawPhotos = (y: number, h: number) => {
    const w = (inner - PHOTO_GAP * (photos.length - 1)) / photos.length;
    photos.forEach(({ image }, i) => {
      const x = PAD + i * (w + PHOTO_GAP);
      ctx.save();
      roundRect(ctx, x, y, w, h, 18);
      ctx.clip();
      const scale = Math.max(w / image.width, h / image.height);
      const dw = image.width * scale;
      const dh = image.height * scale;
      ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      ctx.restore();
    });
  };

  const drawHighlights = (y: number) => {
    ctx.font = font(500, 28);
    highlights.forEach((day, i) => {
      const base = y + i * HIGHLIGHT + 34;
      ctx.fillStyle = p.family('butter', 'base');
      ctx.beginPath();
      ctx.arc(PAD + 10, base - 9, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.ink;
      const label = `${shortDate(day.date)}  ${day.excerpt}`;
      ctx.fillText(wrap(ctx, label, inner - 36, 1)[0] ?? label, PAD + 36, base);
    });
  };

  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, width, height);
  let y = PAD;
  drawHeader(y);
  y += HEADER + GAP;
  if (parts.has('mood')) {
    drawCalendar(PAD, y, plan.cell);
    if (plan.beside) {
      const x = PAD + plan.cell * 7 + COLUMN_GAP;
      const w = columnWidth(plan.cell);
      const used = drawSummary(x, y + 40, w);
      const lines = chipLines(w, columnChipLines(plan.cell, parts));
      drawChips(x, y + 40 + used + GAP, lines);
      y += calendarHeight(plan.cell) + GAP;
    } else {
      y += calendarHeight(plan.cell) + GAP;
      y += drawSummary(PAD, y, inner) + GAP;
      if (parts.has('activities')) {
        const lines = chipLines(inner, 2);
        drawChips(PAD, y, lines);
        y += linesHeight(lines.length) + GAP;
      }
    }
  } else if (parts.has('activities')) {
    const lines = chipLines(inner, 3);
    drawChips(PAD, y, lines);
    y += linesHeight(lines.length) + GAP;
  }
  if (parts.has('photos')) {
    drawPhotos(y, plan.photoHeight);
    y += plan.photoHeight + GAP;
  }
  if (parts.has('highlights')) {
    drawHighlights(y);
    y += highlights.length * HIGHLIGHT + GAP;
  }
  if (parts.has('note')) {
    ctx.font = font(400, 32);
    ctx.fillStyle = p.mid;
    noteLines(inner).forEach((line, i) => ctx.fillText(line, PAD, y + 32 + i * NOTE_LINE));
  }
  // A small bean in the corner: the journal's mark.
  drawBean(ctx, p, 4, 'mint', width - PAD - 44, height - PAD - 44, 44);

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((made) => (made ? resolve(made) : reject(new Error('No image'))), 'image/png'),
  );
  return { blob, omitted };
}

export const snapshotName = (month: string): string => `journal-${month}.png`;
