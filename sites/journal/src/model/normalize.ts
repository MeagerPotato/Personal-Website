/**
 * Reading a decrypted document as a record: every field checked, every missing one filled with
 * its default. A document is only ever as trustworthy as the device that wrote it (an older
 * version of this app, a bug, a half-finished merge), so nothing past this point has to guess.
 *
 * Fields this version does not know are kept (the spread of `doc` first): writing a record back
 * never drops what a newer version of the app put there.
 */
import { FAMILY_KEYS, type FamilyKey } from '@allenkh/design/tokens';
import type { Doc } from '../journal/merge';
import { DEFAULT_ACTIVITIES, DEFAULT_SETTINGS } from './defaults';
import type {
  Activities,
  ActivityGroup,
  Day,
  FileRef,
  JournalRecord,
  LifeEvent,
  MonthReview,
  MoodDef,
  Person,
  Photo,
  Place,
  RichText,
  Settings,
  Song,
  Template,
} from './types';

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const isObject = (value: unknown): value is Doc =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;
const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const bool = (value: unknown, fallback = false): boolean =>
  typeof value === 'boolean' ? value : fallback;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const family = (value: unknown, fallback: FamilyKey = 'sky'): FamilyKey =>
  FAMILY_KEYS.includes(value as FamilyKey) ? (value as FamilyKey) : fallback;
const date = (value: unknown): string | null =>
  typeof value === 'string' && DATE.test(value) ? value : null;

function list<T>(value: unknown, read: (item: Doc) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    if (!isObject(item)) continue;
    const read_ = read(item);
    if (read_ !== null) out.push(read_);
  }
  return out;
}

export function richText(value: unknown): RichText | null {
  if (!isObject(value) || value['type'] !== 'doc') return null;
  return {
    type: 'doc',
    ...(Array.isArray(value['content']) ? { content: value['content'] } : {}),
  };
}

function fileRef(value: unknown): FileRef | null {
  if (!isObject(value)) return null;
  const id = str(value['id']);
  const key = str(value['key']);
  if (!/^b_[A-Za-z0-9_-]{22}$/.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(key)) return null;
  return { id, key, size: num(value['size']), type: str(value['type'], 'image/jpeg') };
}

function photo(value: Doc): Photo | null {
  const file = fileRef(value['file']);
  const thumb = fileRef(value['thumb']);
  const id = str(value['id']);
  if (!file || !thumb || !id) return null;
  return {
    id,
    file,
    thumb,
    width: num(value['width'], 1),
    height: num(value['height'], 1),
    caption: str(value['caption']),
    takenAt: typeof value['takenAt'] === 'number' ? value['takenAt'] : null,
  };
}

function song(value: unknown): Song | null {
  if (!isObject(value)) return null;
  const title = str(value['title']).trim();
  if (!title) return null;
  const url = str(value['url']);
  return { title, artist: str(value['artist']), url: /^https:\/\//.test(url) ? url : '' };
}

function base(doc: Doc) {
  const conflicts = Array.isArray(doc['conflicts']) ? doc['conflicts'] : undefined;
  return {
    v: 1 as const,
    createdAt: num(doc['createdAt'], num(doc['updatedAt'])),
    updatedAt: num(doc['updatedAt']),
    ...(conflicts?.length ? { conflicts: conflicts as unknown as Day['conflicts'] } : {}),
  };
}

export function readDay(doc: Doc): Day | null {
  const day = date(doc['date']);
  if (!day) return null;
  const mood = num(doc['mood'], NaN);
  return {
    ...(doc as object),
    ...base(doc),
    kind: 'day',
    date: day,
    mood: mood >= 1 && mood <= 5 ? Math.round(mood) : null,
    activities: strings(doc['activities']),
    note: richText(doc['note']),
    photos: list(doc['photos'], photo),
    song: song(doc['song']),
    people: strings(doc['people']),
    places: strings(doc['places']),
    highlight: bool(doc['highlight']),
  };
}

export function readEvent(doc: Doc): LifeEvent | null {
  const start = date(doc['date']);
  if (!start) return null;
  const end = date(doc['endDate']);
  const weight = num(doc['weight'], 1);
  return {
    ...(doc as object),
    ...base(doc),
    kind: 'event',
    title: str(doc['title']),
    date: start,
    endDate: end && end > start ? end : null,
    icon: str(doc['icon'], '✨'),
    family: family(doc['family'], 'butter'),
    note: richText(doc['note']),
    photos: list(doc['photos'], photo),
    people: strings(doc['people']),
    places: strings(doc['places']),
    weight: weight === 3 ? 3 : weight === 2 ? 2 : 1,
  };
}

export function readPerson(doc: Doc): Person | null {
  const name = str(doc['name']).trim();
  if (!name) return null;
  const birthday = str(doc['birthday']);
  return {
    ...(doc as object),
    ...base(doc),
    kind: 'person',
    name,
    icon: str(doc['icon']),
    family: family(doc['family'], 'mint'),
    relation: str(doc['relation']),
    birthday: /^(\d{4}-)?(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(birthday) ? birthday : null,
    note: richText(doc['note']),
    archived: bool(doc['archived']),
  };
}

export function readPlace(doc: Doc): Place | null {
  const name = str(doc['name']).trim();
  if (!name) return null;
  return {
    ...(doc as object),
    ...base(doc),
    kind: 'place',
    name,
    icon: str(doc['icon'], '📍'),
    family: family(doc['family'], 'sky'),
    address: str(doc['address']),
    note: richText(doc['note']),
    archived: bool(doc['archived']),
  };
}

export function readMonth(doc: Doc): MonthReview | null {
  const month = str(doc['month']);
  if (!MONTH.test(month)) return null;
  const share = isObject(doc['share']) ? doc['share'] : {};
  return {
    ...(doc as object),
    ...base(doc),
    kind: 'month',
    month,
    title: str(doc['title']),
    note: richText(doc['note']),
    photos: strings(doc['photos']),
    share: {
      mood: bool(share['mood'], true),
      activities: bool(share['activities'], true),
      highlights: bool(share['highlights'], true),
      photos: bool(share['photos'], true),
      note: bool(share['note'], false),
    },
  };
}

export function readTemplate(doc: Doc): Template | null {
  const body = richText(doc['body']);
  if (!body) return null;
  return {
    ...(doc as object),
    ...base(doc),
    kind: 'template',
    name: str(doc['name'], 'Template'),
    icon: str(doc['icon'], '📄'),
    body,
  };
}

function moods(value: unknown): MoodDef[] {
  const given = list(value, (item) => {
    const mood = num(item['value']);
    if (!Number.isInteger(mood) || mood < 1 || mood > 5) return null;
    return { value: mood, label: str(item['label']), family: family(item['family']) };
  });
  // Always exactly five, great to awful: a missing one comes from the defaults.
  return DEFAULT_SETTINGS.moods.map((fallback) => {
    const found = given.find((mood) => mood.value === fallback.value);
    return found ? { ...found, label: found.label || fallback.label } : fallback;
  });
}

export function readSettings(doc: Doc | null | undefined): Settings {
  const source = doc ?? {};
  const reminder = isObject(source['reminder']) ? source['reminder'] : {};
  const time = str(reminder['time']);
  const prompts = strings(source['prompts']).filter((prompt) => prompt.trim());
  const autoLock = num(source['autoLockMinutes'], DEFAULT_SETTINGS.autoLockMinutes);
  return {
    ...(source as object),
    ...base(source),
    kind: 'settings',
    moods: moods(source['moods']),
    prompts: Array.isArray(source['prompts']) ? prompts : DEFAULT_SETTINGS.prompts,
    reminder: {
      enabled: bool(reminder['enabled']),
      time: TIME.test(time) ? time : DEFAULT_SETTINGS.reminder.time,
    },
    weekStart: source['weekStart'] === 0 ? 0 : 1,
    autoLockMinutes: Math.min(Math.max(Math.round(autoLock), 1), 60),
  };
}

export function readActivities(doc: Doc | null | undefined): Activities {
  const source = doc ?? {};
  const groups = Array.isArray(source['groups'])
    ? list(source['groups'], (item): ActivityGroup | null => {
        const id = str(item['id']);
        if (!id) return null;
        return {
          id,
          name: str(item['name']),
          items: list(item['items'], (activity) => {
            const activityId = str(activity['id']);
            if (!activityId) return null;
            return {
              id: activityId,
              name: str(activity['name']),
              icon: str(activity['icon'], '•'),
              archived: bool(activity['archived']),
            };
          }),
        };
      })
    : DEFAULT_ACTIVITIES;
  return { ...(source as object), ...base(source), kind: 'activities', groups };
}

/** Any document, as whichever record it is (or null if it is none this version knows). */
export function readRecord(doc: Doc): JournalRecord | null {
  switch (doc['kind']) {
    case 'day':
      return readDay(doc);
    case 'event':
      return readEvent(doc);
    case 'person':
      return readPerson(doc);
    case 'place':
      return readPlace(doc);
    case 'month':
      return readMonth(doc);
    case 'template':
      return readTemplate(doc);
    case 'settings':
      return readSettings(doc);
    case 'activities':
      return readActivities(doc);
    default:
      return null;
  }
}

/** A record as a document to seal: plain JSON (undefined fields dropped). */
export const toDoc = (record: JournalRecord): Doc => JSON.parse(JSON.stringify(record)) as Doc;
