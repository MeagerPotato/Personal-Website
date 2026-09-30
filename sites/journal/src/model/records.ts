/** Blank records: what a new day, event, person or place starts as before its first save. */
import type { FamilyKey } from '@allenkh/design/tokens';
import type { Day, LifeEvent, MonthReview, Person, Place, Template } from './types';

const fresh = { v: 1 as const, createdAt: 0, updatedAt: 0 };

export const blankDay = (date: string): Day => ({
  ...fresh,
  kind: 'day',
  date,
  mood: null,
  activities: [],
  note: null,
  photos: [],
  song: null,
  people: [],
  places: [],
  highlight: false,
});

export const blankEvent = (date: string): LifeEvent => ({
  ...fresh,
  kind: 'event',
  title: '',
  date,
  endDate: null,
  icon: '✨',
  family: 'butter',
  note: null,
  photos: [],
  people: [],
  places: [],
  weight: 1,
});

export const blankPerson = (name = '', family: FamilyKey = 'mint'): Person => ({
  ...fresh,
  kind: 'person',
  name,
  icon: '',
  family,
  relation: '',
  birthday: null,
  note: null,
  archived: false,
});

export const blankPlace = (name = '', family: FamilyKey = 'sky'): Place => ({
  ...fresh,
  kind: 'place',
  name,
  icon: '📍',
  family,
  address: '',
  note: null,
  archived: false,
});

export const blankMonth = (month: string): MonthReview => ({
  ...fresh,
  kind: 'month',
  month,
  title: '',
  note: null,
  photos: [],
  share: { mood: true, activities: true, highlights: true, photos: true, note: false },
});

export const blankTemplate = (name = 'New template'): Template => ({
  ...fresh,
  kind: 'template',
  name,
  icon: '📄',
  body: { type: 'doc', content: [{ type: 'paragraph' }] },
});
