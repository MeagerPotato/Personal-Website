/**
 * What the journal holds. Every record is a JSON document with a `kind`, sealed as a whole
 * (vault/envelope.ts): the server sees only an id and a size.
 *
 * Adding a field is free (readers fill a default, see normalize.ts); renaming or removing one
 * is a migration. A device never drops fields it does not know: a newer version of the app on
 * another device may have written them.
 */
import type { FamilyKey } from '@allenkh/design/tokens';
import type { ConflictCopy, Json } from '../journal/merge';

/** An editor document (Tiptap/ProseMirror JSON), stored as is. */
export interface RichText {
  type: 'doc';
  content?: Json[];
}

/** A sealed file in R2: its id, and the key that opens it (vault/blob.ts). */
export interface FileRef {
  id: string;
  /** base64url, 32 bytes. Lives only inside sealed records. */
  key: string;
  size: number;
  type: string;
}

export interface Photo {
  /** Random; lets two devices merge photo lists (merge.ts). */
  id: string;
  file: FileRef;
  thumb: FileRef;
  width: number;
  height: number;
  caption: string;
  /** When it was taken, if known (ms). */
  takenAt: number | null;
}

export interface Song {
  title: string;
  artist: string;
  /** A link to it (Apple Music, Spotify, YouTube…), opened in a new tab; never embedded. */
  url: string;
}

interface Base {
  /** Schema version of this kind. */
  v: 1;
  createdAt: number;
  updatedAt: number;
  conflicts?: ConflictCopy[];
}

/** One day: the heart of it. Its id is keyed by its date (vault/ids.ts). */
export interface Day extends Base {
  kind: 'day';
  /** YYYY-MM-DD, in the journal's own calendar (no time zone: a day is the day you lived). */
  date: string;
  /** 1 (awful) … 5 (great), or null when not picked. */
  mood: number | null;
  /** Activity ids (see Activities). */
  activities: string[];
  note: RichText | null;
  photos: Photo[];
  song: Song | null;
  /** Person and place record ids. */
  people: string[];
  places: string[];
  /** A favourite day: starred, and first in line for the month's snapshot. */
  highlight: boolean;
}

/** A life event: a first, a milestone, a trip; the timeline. */
export interface LifeEvent extends Base {
  kind: 'event';
  title: string;
  date: string;
  /** For events that span days (a trip): the last day, inclusive. */
  endDate: string | null;
  icon: string;
  family: FamilyKey;
  note: RichText | null;
  photos: Photo[];
  people: string[];
  places: string[];
  /** 1 an everyday event, 2 notable, 3 a milestone (bigger on the timeline). */
  weight: 1 | 2 | 3;
}

export interface Person extends Base {
  kind: 'person';
  name: string;
  icon: string;
  family: FamilyKey;
  /** "friend", "sister", "lab partner"… */
  relation: string;
  /** MM-DD or YYYY-MM-DD. */
  birthday: string | null;
  note: RichText | null;
  archived: boolean;
}

export interface Place extends Base {
  kind: 'place';
  name: string;
  icon: string;
  family: FamilyKey;
  address: string;
  note: RichText | null;
  archived: boolean;
}

/** The month's review: what gets shared as an image, or kept just for you. */
export interface MonthReview extends Base {
  kind: 'month';
  /** YYYY-MM. Keyed like days. */
  month: string;
  title: string;
  note: RichText | null;
  /** Photo ids (from that month's days) picked for the snapshot, in order. */
  photos: string[];
  /** Which parts the share image shows. */
  share: {
    mood: boolean;
    activities: boolean;
    highlights: boolean;
    photos: boolean;
    note: boolean;
  };
}

export interface Template extends Base {
  kind: 'template';
  name: string;
  icon: string;
  body: RichText;
}

export interface MoodDef {
  /** 1 … 5. */
  value: number;
  label: string;
  family: FamilyKey;
}

export interface Settings extends Base {
  kind: 'settings';
  moods: MoodDef[];
  /** Questions offered when a day is empty. */
  prompts: string[];
  reminder: {
    enabled: boolean;
    /** HH:MM, local time. */
    time: string;
  };
  /** 0 Sunday, 1 Monday. */
  weekStart: 0 | 1;
  /** Minutes in the background before the journal locks itself. */
  autoLockMinutes: number;
}

export interface Activity {
  id: string;
  name: string;
  icon: string;
  archived: boolean;
}

export interface ActivityGroup {
  id: string;
  name: string;
  items: Activity[];
}

export interface Activities extends Base {
  kind: 'activities';
  groups: ActivityGroup[];
}

export type JournalRecord =
  Day | LifeEvent | Person | Place | MonthReview | Template | Settings | Activities;

export type Kind = JournalRecord['kind'];

export type RecordOf<K extends Kind> = Extract<JournalRecord, { kind: K }>;
