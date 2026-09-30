import { describe, expect, it } from 'vitest';
import { manifestDoc, missingFrom, readManifest, sameVersions } from './manifest';

const DAY = 'k_day0000000000000000000';
const EVENT = 'r_event00000000000000000';
const PERSON = 'r_person0000000000000000';
const OTHER = 'r_manifest00000000000000';

describe('a manifest', () => {
  it('reads back what a device wrote', () => {
    const records = new Map([
      [DAY, 3],
      [EVENT, 1],
    ]);
    expect(readManifest(manifestDoc(records, 1700))).toEqual({ updatedAt: 1700, records });
  });

  it('is nothing but a manifest', () => {
    expect(readManifest({ kind: 'day', records: { [DAY]: 1 } })).toBeNull();
  });

  it('keeps only what it can trust from another device', () => {
    const doc = {
      kind: 'manifest',
      v: 1,
      updatedAt: 'yesterday',
      records: { [DAY]: 2, [EVENT]: -1, [PERSON]: 1.5, not_an_id: 4, b_file00000000000000000: 1 },
    };
    expect(readManifest(doc)).toEqual({ updatedAt: 0, records: new Map([[DAY, 2]]) });
    // A later format lists its records another way: nothing here to check them by.
    expect(readManifest({ ...doc, v: 2 })?.records.size).toBe(0);
  });
});

describe('what a manifest shows missing', () => {
  const manifest = {
    updatedAt: 0,
    records: new Map([
      [DAY, 3],
      [EVENT, 2],
      [PERSON, 1],
    ]),
  };

  it('is every record this device lacks, or has an older version of', () => {
    const has = new Map([
      [DAY, 3],
      [EVENT, 1],
    ]);
    expect(missingFrom(manifest, (id) => has.get(id) ?? 0)).toEqual([EVENT, PERSON]);
  });

  it('is nothing once this device has those versions or later ones', () => {
    const has = new Map([
      [DAY, 4],
      [EVENT, 2],
      [PERSON, 1],
    ]);
    expect(missingFrom(manifest, (id) => has.get(id) ?? 0)).toEqual([]);
  });
});

describe('two lists of versions', () => {
  const list = new Map([
    [DAY, 3],
    [EVENT, 1],
    [OTHER, 7],
  ]);
  const none = () => false;
  const manifests = (id: string) => id === OTHER;

  it('are the same with the same versions of the same records', () => {
    expect(sameVersions(list, new Map(list), none)).toBe(true);
  });

  it('differ by a version, or by a record either one has', () => {
    expect(sameVersions(list, new Map([...list, [DAY, 4]]), none)).toBe(false);
    expect(sameVersions(list, new Map([...list, [PERSON, 1]]), none)).toBe(false);
    expect(sameVersions(new Map([...list, [PERSON, 1]]), list, none)).toBe(false);
  });

  it('leave out what they are told to: another device’s manifest moving on', () => {
    expect(sameVersions(list, new Map([...list, [OTHER, 8]]), manifests)).toBe(true);
    const without = new Map(list);
    without.delete(OTHER);
    expect(sameVersions(list, without, manifests)).toBe(true);
    expect(sameVersions(without, list, manifests)).toBe(true);
  });
});
