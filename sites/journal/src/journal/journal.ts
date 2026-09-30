/**
 * The unlocked journal, as the screens see it: typed records to read, and save/delete to change
 * them. Underneath, the replica (replica.ts) keeps this device's sealed copy and syncs it.
 *
 * Saving is instant (memory), sealed to IndexedDB a moment later, and sent to the server a
 * moment after that; the sync status says where things stand. Locking drops the keys and every
 * decrypted record with this object.
 */
import { ApiError, OfflineError, api } from '../api/client';
import { today } from '../model/dates';
import { readActivities, readRecord, readSettings, toDoc } from '../model/normalize';
import { blankDay, blankMonth } from '../model/records';
import { hasEntry } from '../model/stats';
import type {
  Activities,
  Day,
  JournalRecord,
  LifeEvent,
  MonthReview,
  Person,
  Place,
  Settings,
  Template,
} from '../model/types';
import { db, getMeta, setMeta } from '../store/db';
import { replicaStore } from '../store/replicaStore';
import { openJson, sealJson } from '../vault/envelope';
import { dayId, monthId, randomId, singletonId } from '../vault/ids';
import type { AccountKeys } from '../vault/keys';
import type { Doc } from './merge';
import { uploadQueued } from './files';
import { manifestDoc, missingFrom, readManifest, sameVersions, type Manifest } from './manifest';
import { Replica, type Codec } from './replica';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'signed-out' | 'error';

export interface SyncStatus {
  state: SyncState;
  lastSyncedAt: number | null;
  /** Changes on this device the server has not confirmed yet. */
  pending: number;
  /** Records sealed with a key this device does not have (never overwritten). */
  unreadable: number;
  /** Records the server has gone back on: this device keeps its own version (replica.ts). */
  behind: number;
  /** Records another device's manifest lists at a later version than this device has. */
  withheld: number;
  message: string | null;
}

interface Index {
  days: Map<string, Day>;
  months: Map<string, MonthReview>;
  events: Map<string, LifeEvent>;
  people: Map<string, Person>;
  places: Map<string, Place>;
  templates: Map<string, Template>;
  settings: Settings;
  activities: Activities;
}

const emptyIndex = (): Index => ({
  days: new Map(),
  months: new Map(),
  events: new Map(),
  people: new Map(),
  places: new Map(),
  templates: new Map(),
  settings: readSettings(null),
  activities: readActivities(null),
});

const FLUSH_MS = 400;
const SYNC_AFTER_WRITE_MS = 1500;
const SYNC_EVERY_MS = 60_000;
const RETRY_MS = [5_000, 15_000, 60_000, 300_000];
/** At most one manifest this often, after the first of a session (publishManifest). */
const MANIFEST_EVERY_MS = 10 * 60_000;
/** At most one repair this often: each reads the whole log (replica.ts, repair). */
const REPAIR_EVERY_MS = 10 * 60_000;

export class Journal {
  private version = 0;
  /** Bumped when a record changes (not the sync status); the lists below are cached by it. */
  private recordsVersion = 0;
  private readonly lists = new Map<string, unknown>();
  private listsAt = -1;
  private readonly index: Index = emptyIndex();
  /** Where each record id sits in the index, so a change can move or remove it. */
  private readonly placed = new Map<string, { kind: JournalRecord['kind']; key: string }>();
  private readonly listeners = new Set<() => void>();
  /** Keyed ids already computed ('day:2026-09-29' → k_…): HMACs are cheap, not free. */
  private readonly ids = new Map<string, string>();
  /** Every device's manifest this device can read, this one's included (manifest.ts). */
  private readonly manifests = new Map<string, Manifest>();
  /** Whether this session has published its manifest yet: the first is not paced. */
  private manifestPaced = false;
  /** When this session last tried to put back what the server lost (0: never). */
  private repairedAt = 0;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private everyTimer: ReturnType<typeof setInterval> | undefined;
  private failures = 0;
  private closed = false;
  /** The date the server was last told is written (reportWritten). */
  private writtenReported: string | null = null;
  private syncStatus: SyncStatus = {
    state: 'idle',
    lastSyncedAt: null,
    pending: 0,
    unreadable: 0,
    behind: 0,
    withheld: 0,
    message: null,
  };

  private constructor(
    readonly keys: AccountKeys,
    private readonly replica: Replica,
    /** This device's own manifest: a random id, one per device (and per account key). */
    private readonly manifestId: string,
  ) {
    this.reindex(null);
    replica.subscribe((ids) => {
      if (this.reindex(ids)) this.recordsVersion += 1;
      this.changed();
    });
  }

  /** Opens this device's copy with the keys just unlocked, and starts syncing. */
  static async open(keys: AccountKeys, online: boolean): Promise<Journal> {
    // A different account key means the journal was set up again from scratch: whatever this
    // device kept belongs to the old one and can never be opened. Start clean.
    if ((await getMeta<string>('akId')) !== keys.akId) {
      const tx = (await db()).transaction(
        ['records', 'pending', 'files', 'uploads', 'meta'],
        'readwrite',
      );
      await Promise.all([
        tx.objectStore('records').clear(),
        tx.objectStore('pending').clear(),
        tx.objectStore('files').clear(),
        tx.objectStore('uploads').clear(),
        tx.objectStore('meta').delete('cursor'),
        tx.objectStore('meta').delete('manifestId'),
        tx.objectStore('meta').put(keys.akId, 'akId'),
        tx.done,
      ]);
    }
    const codec: Codec = {
      seal: (id, rev, doc) => sealJson(keys, { id, rev }, doc),
      open: (id, rev, sealed) => openJson<Doc>(keys, { id, rev }, sealed),
    };
    const replica = await Replica.open(replicaStore, { pull: api.pull, push: api.push }, codec);
    let manifestId = await getMeta<string>('manifestId');
    if (!manifestId) {
      manifestId = randomId();
      await setMeta('manifestId', manifestId);
    }
    const journal = new Journal(keys, replica, manifestId);
    journal.start(online);
    return journal;
  }

  // --- For React: useSyncExternalStore(journal.subscribe, journal.snapshot) --------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Changes whenever anything visible changes (records or sync status). */
  snapshot = (): number => this.version;

  private changed(): void {
    this.version += 1;
    const { pending, unreadable, behind } = this.replica.status;
    this.syncStatus = { ...this.syncStatus, pending, unreadable, behind };
    for (const listener of this.listeners) listener();
  }

  // --- Reading ---------------------------------------------------------------------------------

  /**
   * Files the given records (or all of them) into the index by kind, and the manifests aside.
   * Whether any of them was a journal record: a manifest alone changes nothing on a screen.
   */
  private reindex(ids: readonly string[] | null): boolean {
    const index = this.index;
    const todo = ids ?? [...this.replica.entries()].map(([id]) => id);
    let records = false;
    for (const id of todo) {
      const was = this.placed.get(id);
      if (was) {
        records = true;
        this.placed.delete(id);
        if (was.kind === 'settings') index.settings = readSettings(null);
        else if (was.kind === 'activities') index.activities = readActivities(null);
        else index[mapOf(was.kind)].delete(was.key);
      }
      const doc = this.replica.get(id);
      const manifest = doc ? readManifest(doc) : null;
      if (manifest) {
        this.manifests.set(id, manifest);
        continue;
      }
      this.manifests.delete(id);
      const record = doc ? readRecord(doc) : null;
      if (!record) continue;
      records = true;
      let key = id;
      switch (record.kind) {
        case 'day':
          key = record.date;
          index.days.set(key, record);
          break;
        case 'month':
          key = record.month;
          index.months.set(key, record);
          break;
        case 'event':
          index.events.set(key, record);
          break;
        case 'person':
          index.people.set(key, record);
          break;
        case 'place':
          index.places.set(key, record);
          break;
        case 'template':
          index.templates.set(key, record);
          break;
        case 'settings':
          index.settings = record;
          break;
        case 'activities':
          index.activities = record;
          break;
      }
      if (record.kind === 'day' || record.kind === 'month')
        this.ids.set(`${record.kind}:${key}`, id);
      this.placed.set(id, { kind: record.kind, key });
    }
    return records;
  }

  /**
   * A list made from the index, made once per change of the records: the same array until
   * something changes, so a screen can memoise on it. Read-only: sort a copy.
   */
  private list<T>(name: string, make: () => T): T {
    if (this.listsAt !== this.recordsVersion) {
      this.lists.clear();
      this.listsAt = this.recordsVersion;
    }
    if (!this.lists.has(name)) this.lists.set(name, make());
    return this.lists.get(name) as T;
  }

  day(date: string): Day | null {
    return this.index.days.get(date) ?? null;
  }

  /** Every day written, oldest first. */
  days(): readonly Day[] {
    return this.list('days', () =>
      [...this.index.days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    );
  }

  month(month: string): MonthReview | null {
    return this.index.months.get(month) ?? null;
  }

  events(): readonly [string, LifeEvent][] {
    return this.list('events', () => [...this.index.events]);
  }

  event(id: string): LifeEvent | null {
    return this.index.events.get(id) ?? null;
  }

  people(): readonly [string, Person][] {
    return this.list('people', () => [...this.index.people]);
  }

  person(id: string): Person | null {
    return this.index.people.get(id) ?? null;
  }

  places(): readonly [string, Place][] {
    return this.list('places', () => [...this.index.places]);
  }

  place(id: string): Place | null {
    return this.index.places.get(id) ?? null;
  }

  templates(): readonly [string, Template][] {
    return this.list('templates', () => [...this.index.templates]);
  }

  settings(): Settings {
    return this.index.settings;
  }

  activities(): Activities {
    return this.index.activities;
  }

  /** Every record this device can read, with its id (export, clean-up). */
  *everything(): IterableIterator<[string, JournalRecord]> {
    for (const [id, doc] of this.replica.entries()) {
      const record = readRecord(doc);
      if (record) yield [id, record];
    }
  }

  get status(): SyncStatus {
    return this.syncStatus;
  }

  // --- Writing ---------------------------------------------------------------------------------

  private stamp<T extends JournalRecord>(record: T): T {
    const now = Date.now();
    return { ...record, createdAt: record.createdAt || now, updatedAt: now };
  }

  private write(id: string, record: JournalRecord | null): void {
    this.replica.write(id, record ? toDoc(this.stamp(record)) : null);
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.replica.flush(), FLUSH_MS);
    this.syncSoon(SYNC_AFTER_WRITE_MS);
  }

  private async keyed(name: string, make: () => Promise<string>): Promise<string> {
    let id = this.ids.get(name);
    if (!id) {
      id = await make();
      this.ids.set(name, id);
    }
    return id;
  }

  /**
   * Changes a day. `change` gets the day as it is at the moment of writing (never a copy read
   * before an await), so two quick edits (a mood, then an activity) both land.
   */
  async updateDay(date: string, change: (day: Day) => Day): Promise<void> {
    const id = await this.keyed(`day:${date}`, () => dayId(this.keys, date));
    const next = change(this.day(date) ?? blankDay(date));
    this.write(id, next);
    if (date === today() && hasEntry(next)) this.reportWritten(date);
  }

  /**
   * Tells the server, once a day, that today is written, so no device is reminded to write it.
   * The server learns nothing new: it sees every sync already. Offline, the next edit tries again.
   */
  private reportWritten(date: string): void {
    if (this.writtenReported === date) return;
    this.writtenReported = date;
    api.markWritten(date).catch(() => {
      if (this.writtenReported === date) this.writtenReported = null;
    });
  }

  async updateMonth(month: string, change: (review: MonthReview) => MonthReview): Promise<void> {
    const id = await this.keyed(`month:${month}`, () => monthId(this.keys, month));
    this.write(id, change(this.month(month) ?? blankMonth(month)));
  }

  async updateSettings(change: (settings: Settings) => Settings): Promise<void> {
    const id = await this.keyed('settings', () => singletonId(this.keys, 'settings'));
    this.write(id, change(this.settings()));
  }

  async updateActivities(change: (activities: Activities) => Activities): Promise<void> {
    const id = await this.keyed('activities', () => singletonId(this.keys, 'activities'));
    this.write(id, change(this.activities()));
  }

  /** Events, people, places, templates: a new one gets a random id, returned. */
  save(record: LifeEvent | Person | Place | Template, id: string = randomId()): string {
    this.write(id, record);
    return id;
  }

  /** Changes an event, person, place or template as it is right now. */
  update<T extends LifeEvent | Person | Place | Template>(
    id: string,
    change: (record: T) => T,
  ): void {
    const current = this.replica.get(id);
    const record = current ? readRecord(current) : null;
    if (!record) return;
    this.write(id, change(record as T));
  }

  remove(id: string): void {
    this.write(id, null);
  }

  // --- Sync ------------------------------------------------------------------------------------

  private setStatus(patch: Partial<SyncStatus>): void {
    this.syncStatus = { ...this.syncStatus, ...patch };
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  private readonly onOnline = () => this.syncSoon(0);
  private readonly onOffline = () => this.setStatus({ state: 'offline', message: null });
  private readonly onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      void this.replica.flush();
    } else if (Date.now() - (this.syncStatus.lastSyncedAt ?? 0) > 30_000) {
      this.syncSoon(0);
    }
  };

  private start(online: boolean): void {
    addEventListener('online', this.onOnline);
    addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onVisibility);
    addEventListener('pagehide', this.onVisibility);
    this.everyTimer = setInterval(() => {
      if (document.visibilityState === 'visible') this.syncSoon(0);
    }, SYNC_EVERY_MS);
    this.changed();
    if (online) this.syncSoon(0);
    else this.unreachable();
  }

  /**
   * The server could not be reached. If the browser knows it is offline, its 'online' event
   * calls us back. If it believes it is online (a captive portal, a flaky network, the server
   * down), nothing will: try again, backing off.
   */
  private unreachable(): void {
    this.setStatus({ state: 'offline', message: null });
    if (navigator.onLine) this.retrySoon();
  }

  private retrySoon(): void {
    this.failures += 1;
    this.syncSoon(RETRY_MS[Math.min(this.failures - 1, RETRY_MS.length - 1)] ?? 60_000);
  }

  syncSoon(delay: number): void {
    if (this.closed) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => void this.syncNow(), delay);
  }

  async syncNow(): Promise<void> {
    if (this.closed || this.syncStatus.state === 'signed-out') return;
    clearTimeout(this.syncTimer);
    this.setStatus({ state: 'syncing' });
    try {
      await this.replica.sync();
      // Not worth failing a sync over: the next one says it all again.
      await this.publishManifest().catch(() => undefined);
      // The server has gone back on something this device has: put back what it lost.
      if (this.replica.status.behind > 0 && Date.now() - this.repairedAt >= REPAIR_EVERY_MS) {
        this.repairedAt = Date.now();
        await this.replica.repair().catch(() => undefined);
      }
      const withheld = this.withheld();
      void uploadQueued();
      this.failures = 0;
      this.setStatus({
        state: 'idle',
        lastSyncedAt: Date.now(),
        message: null,
        behind: this.replica.status.behind,
        withheld,
      });
    } catch (error) {
      if (error instanceof OfflineError) {
        this.unreachable();
        return;
      }
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        this.setStatus({ state: 'signed-out', message: 'Sign in again to sync.' });
        return;
      }
      this.setStatus({
        state: 'error',
        message: error instanceof Error ? error.message : 'Sync failed',
      });
      this.retrySoon();
    }
  }

  /** How many records another device's manifest lists at a later version than this one has. */
  private withheld(): number {
    const missing = new Set<string>();
    for (const [id, manifest] of this.manifests) {
      if (id === this.manifestId) continue;
      for (const record of missingFrom(manifest, (of) => this.replica.revision(of))) {
        missing.add(record);
      }
    }
    return missing.size;
  }

  /**
   * Publishes this device's manifest (manifest.ts) when what the server has confirmed to it has
   * changed: at the first sync of a session, then at most every ten minutes, so a day of writing
   * makes a few manifests and not one per sync. Other devices' manifests are listed, but a change
   * to one of them alone is no reason to publish: every device would answer every other, for ever.
   */
  private async publishManifest(): Promise<void> {
    const own = this.manifests.get(this.manifestId);
    const records = new Map(this.replica.versions());
    records.delete(this.manifestId);
    if (own) {
      if (sameVersions(records, own.records, (id) => this.manifests.has(id))) return;
      const since = Date.now() - own.updatedAt;
      if (this.manifestPaced && since >= 0 && since < MANIFEST_EVERY_MS) return;
    }
    this.manifestPaced = true;
    // Refused when the server has gone back on it: the repair that follows puts it back.
    await this.replica.publish(this.manifestId, manifestDoc(records, Date.now()));
  }

  /** After signing in again (a fresh session): sync picks up where it stopped. */
  resume(): void {
    this.setStatus({ state: 'idle', message: null });
    this.syncSoon(0);
  }

  /** Locks: saves what is typed, stops syncing, and lets go of the keys (with this object). */
  async close(): Promise<void> {
    if (this.closed) return;
    clearTimeout(this.flushTimer);
    await this.replica.flush();
    this.closed = true;
    clearTimeout(this.syncTimer);
    clearInterval(this.everyTimer);
    removeEventListener('online', this.onOnline);
    removeEventListener('offline', this.onOffline);
    document.removeEventListener('visibilitychange', this.onVisibility);
    removeEventListener('pagehide', this.onVisibility);
    this.listeners.clear();
  }
}

type MapKind = 'days' | 'months' | 'events' | 'people' | 'places' | 'templates';

function mapOf(kind: Exclude<JournalRecord['kind'], 'settings' | 'activities'>): MapKind {
  const maps = {
    day: 'days',
    month: 'months',
    event: 'events',
    person: 'people',
    place: 'places',
    template: 'templates',
  } as const;
  return maps[kind];
}
