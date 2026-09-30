/**
 * Settings: how the journal locks and unlocks, what a day asks for (moods, activities, prompts,
 * templates), how it looks on this device, and your data. Security changes that need the account
 * key ask for a fresh passkey prompt first, so an unattended unlocked screen cannot change them.
 */
import { RichTextEditor, type Doc } from '@allenkh/editor';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  forget,
  prepareOnlineUnlock,
  reopenRaw,
  replaceRecoveryPhrase,
  setPassphrase,
  type UnlockTicket,
} from '../account/account';
import { api, type Passkey } from '../api/client';
import { useJournal, useLock } from '../app/context';
import { collectGarbage, queuedUploads } from '../journal/files';
import { BUILT_IN_TEMPLATES, DEFAULT_ACTIVITIES, DEFAULT_PROMPTS } from '../model/defaults';
import { blankTemplate } from '../model/records';
import type { Activities, ActivityGroup, RichText, Template } from '../model/types';
import { wipe } from '../store/db';
import { newRecoveryPhrase } from '../vault/recovery';
import { randomId } from '../vault/ids';
import { Bean } from '../ui/Bean';
import { ErrorText, busyLabel, describe } from '../ui/common';
import { FamilyPicker, IconField, Segmented } from '../ui/fields';
import { groupFamily } from '../ui/pickers';
import { applyTheme, readTheme, type ThemeChoice } from '../app/theme';

function Section(props: { id: string; title: string; children: ReactNode; lede?: string }) {
  return (
    <section className="settings__section" id={props.id} aria-labelledby={`${props.id}-title`}>
      <h2 className="settings__title" id={`${props.id}-title`}>
        {props.title}
      </h2>
      {props.lede ? <p className="hint">{props.lede}</p> : null}
      {props.children}
    </section>
  );
}

export function SettingsScreen({ section }: { section: string | null }) {
  useEffect(() => {
    if (section) document.getElementById(section)?.scrollIntoView({ block: 'start' });
  }, [section]);

  return (
    <article className="page settings">
      <header className="page__head">
        <h1 className="page__title">Settings</h1>
      </header>
      <SecuritySection />
      <MoodsSection />
      <ActivitiesSection />
      <PromptsSection />
      <TemplatesSection />
      <AppearanceSection />
      <DataSection />
    </article>
  );
}

// --- Security -----------------------------------------------------------------------------------

type Ticket = Extract<UnlockTicket, { mode: 'online' }>;

/** A fresh sign-in challenge, kept ready for the next "prove it's you" tap. */
function useFreshTicket(): () => Ticket | null {
  const ticket = useRef<Ticket | null>(null);
  useEffect(() => {
    const refresh = () =>
      void prepareOnlineUnlock()
        .then((next) => (ticket.current = next))
        .catch(() => (ticket.current = null));
    refresh();
    const timer = setInterval(refresh, 4 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  return () => {
    const current = ticket.current;
    ticket.current = null;
    void prepareOnlineUnlock()
      .then((next) => (ticket.current = next))
      .catch(() => undefined);
    return current;
  };
}

function SecuritySection() {
  const journal = useJournal();
  const lock = useLock();
  const settings = journal.settings();
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flow, setFlow] = useState<null | {
    kind: 'passphrase' | 'recovery';
    raw: Uint8Array<ArrayBuffer>;
    akId: string;
  }>(null);
  const takeTicket = useFreshTicket();

  const loadPasskeys = () =>
    api
      .passkeys()
      .then(setPasskeys)
      .catch(() => setPasskeys(null));
  useEffect(() => {
    void loadPasskeys();
  }, []);

  useEffect(() => {
    if (!flow) return undefined;
    return () => forget(flow.raw);
  }, [flow]);

  const prove = (kind: 'passphrase' | 'recovery') => {
    const ticket = takeTicket();
    if (!ticket) {
      setError('Connect to the internet to change this.');
      return;
    }
    setBusy(true);
    setError(null);
    reopenRaw(ticket)
      .then(({ raw, akId }) => setFlow({ kind, raw, akId }))
      .catch((caught: unknown) => setError(describe(caught)))
      .finally(() => setBusy(false));
  };

  return (
    <Section
      id="security"
      title="Security"
      lede="Your journal is encrypted with a key only your devices hold. These are the ways to unlock it."
    >
      <h3 className="settings__sub">Passkeys</h3>
      {passkeys === null ? (
        <p className="faint">Connect to see your passkeys.</p>
      ) : (
        <ul className="settings__list">
          {passkeys.map((passkey) => (
            <li key={passkey.id} className="settings__row">
              <input
                key={passkey.label}
                className="bare-input"
                aria-label="Passkey name"
                defaultValue={passkey.label || 'Passkey'}
                onBlur={(event) => {
                  const label = event.target.value.trim();
                  if (label && label !== passkey.label)
                    void api.renamePasskey(passkey.id, label).then(loadPasskeys);
                }}
              />
              <span className="faint">
                {passkey.unlocks ? 'unlocks' : 'signs in only'}
                {passkey.lastUsedAt
                  ? ` · used ${new Date(passkey.lastUsedAt).toLocaleDateString()}`
                  : ''}
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${passkey.label || 'passkey'}`}
                onClick={() => {
                  if (
                    !confirm(
                      'Remove this passkey? Its device will need the recovery phrase to unlock again.',
                    )
                  )
                    return;
                  api
                    .removePasskey(passkey.id)
                    .then(loadPasskeys)
                    .catch((caught: unknown) => setError(describe(caught)));
                }}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">
        To add a device, open the journal there and choose “Use recovery phrase”: it gets its own
        passkey. Apple devices signed in to the same Apple Account share passkeys automatically.
      </p>

      {flow?.kind === 'recovery' ? (
        <NewRecoveryPhrase
          onDone={async (phrase) => {
            await replaceRecoveryPhrase(flow.raw, flow.akId, phrase);
            setFlow(null);
          }}
          onCancel={() => setFlow(null)}
        />
      ) : flow?.kind === 'passphrase' ? (
        <NewPassphrase
          onDone={async (passphrase) => {
            await setPassphrase(flow.raw, flow.akId, passphrase);
            setFlow(null);
          }}
          onCancel={() => setFlow(null)}
        />
      ) : (
        <div className="settings__actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => prove('recovery')}
          >
            New recovery phrase
          </button>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => prove('passphrase')}
          >
            Set a passphrase
          </button>
        </div>
      )}
      <ErrorText error={error} />

      <h3 className="settings__sub">Locking</h3>
      <label className="settings__row">
        <span>Lock after the app has been in the background for</span>
        <select
          className="input input--inline"
          value={settings.autoLockMinutes}
          onChange={(event) =>
            void journal.updateSettings((s) => ({
              ...s,
              autoLockMinutes: Number(event.target.value),
            }))
          }
        >
          {[1, 5, 15, 30, 60].map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes} {minutes === 1 ? 'minute' : 'minutes'}
            </option>
          ))}
        </select>
      </label>
      <div className="settings__actions">
        <button type="button" className="button" onClick={lock}>
          Lock now
        </button>
        <button
          type="button"
          className="button button--danger"
          onClick={() => {
            if (
              !confirm(
                'Remove the journal from this device? Everything synced stays on the server; changes not yet synced are lost.',
              )
            ) {
              return;
            }
            void journal
              .close()
              .then(() => api.logout().catch(() => undefined))
              .then(() => wipe())
              .then(() => location.reload());
          }}
        >
          Remove from this device
        </button>
      </div>
    </Section>
  );
}

function NewRecoveryPhrase(props: {
  onDone: (phrase: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [phrase] = useState(newRecoveryPhrase);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="card settings__flow">
      <p>Your new recovery phrase. Once you save it, the old one stops working. Write it down.</p>
      <ol className="phrase">
        {phrase.split(' ').map((word, index) => (
          <li key={index}>
            <span className="phrase__n">{index + 1}</span>
            <span className="phrase__word">{word}</span>
          </li>
        ))}
      </ol>
      <label className="check">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
        />
        <span>I’ve written down all 24 words</span>
      </label>
      <div className="settings__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={!saved || busy}
          onClick={() => {
            setBusy(true);
            props
              .onDone(phrase)
              .catch((caught: unknown) => setError(describe(caught)))
              .finally(() => setBusy(false));
          }}
        >
          {busyLabel(busy, 'Replace the old phrase', 'Saving…')}
        </button>
        <button type="button" className="button button--quiet" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
      <ErrorText error={error} />
    </div>
  );
}

function NewPassphrase(props: {
  onDone: (passphrase: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="card settings__flow stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (first.length < 12)
          return setError('Use at least 12 characters: a few words are easiest.');
        if (first !== second) return setError('The two passphrases don’t match.');
        setBusy(true);
        setError(null);
        props
          .onDone(first)
          .catch((caught: unknown) => setError(describe(caught)))
          .finally(() => setBusy(false));
      }}
    >
      <p className="hint">
        For a browser that can sign in with a passkey but not unlock with one. Long and memorable
        beats short and clever.
      </p>
      <input
        className="input"
        type="password"
        autoComplete="new-password"
        aria-label="Passphrase"
        placeholder="Passphrase"
        value={first}
        onChange={(event) => setFirst(event.target.value)}
      />
      <input
        className="input"
        type="password"
        autoComplete="new-password"
        aria-label="Passphrase again"
        placeholder="Again"
        value={second}
        onChange={(event) => setSecond(event.target.value)}
      />
      <div className="settings__actions">
        <button type="submit" className="button button--primary" disabled={busy}>
          {busyLabel(busy, 'Save passphrase', 'Stretching it…')}
        </button>
        <button type="button" className="button button--quiet" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
      <ErrorText error={error} />
    </form>
  );
}

// --- What a day asks for --------------------------------------------------------------------------

function MoodsSection() {
  const journal = useJournal();
  const moods = journal.settings().moods;
  return (
    <Section
      id="moods"
      title="Moods"
      lede="Five beans, great to awful. Name them and colour them your way."
    >
      <ul className="settings__list">
        {moods.map((mood) => (
          <li key={mood.value} className="settings__row">
            <Bean mood={mood.value} family={mood.family} size={36} />
            <input
              key={mood.label}
              className="bare-input"
              aria-label={`Name for mood ${mood.value}`}
              defaultValue={mood.label}
              onBlur={(event) => {
                const label = event.target.value.trim();
                if (!label || label === mood.label) return;
                void journal.updateSettings((s) => ({
                  ...s,
                  moods: s.moods.map((m) => (m.value === mood.value ? { ...m, label } : m)),
                }));
              }}
            />
            <FamilyPicker
              value={mood.family}
              label={`Colour for ${mood.label}`}
              onChange={(family) =>
                void journal.updateSettings((s) => ({
                  ...s,
                  moods: s.moods.map((m) => (m.value === mood.value ? { ...m, family } : m)),
                }))
              }
            />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

function ActivitiesSection() {
  const journal = useJournal();
  const activities = journal.activities();
  const change = (update: (groups: ActivityGroup[]) => ActivityGroup[]) =>
    void journal.updateActivities((a: Activities) => ({ ...a, groups: update(a.groups) }));
  const changeGroup = (groupId: string, update: (group: ActivityGroup) => ActivityGroup) =>
    change((groups) => groups.map((group) => (group.id === groupId ? update(group) : group)));

  return (
    <Section
      id="activities"
      title="Activities"
      lede="What you can tick on a day. Archiving hides one from new days but keeps it on old ones."
    >
      {activities.groups.map((group, index) => (
        <div key={group.id} className="activity-editor" data-family={groupFamily(index)}>
          <div className="activity-editor__head">
            <input
              key={group.name}
              className="bare-input activity-editor__name"
              aria-label="Group name"
              defaultValue={group.name}
              onBlur={(event) =>
                event.target.value !== group.name &&
                changeGroup(group.id, (g) => ({ ...g, name: event.target.value }))
              }
            />
            <button
              type="button"
              className="icon-button"
              aria-label="Move group up"
              onClick={() => change((g) => move(g, index, index - 1))}
            >
              <ArrowUp aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Move group down"
              onClick={() => change((g) => move(g, index, index + 1))}
            >
              <ArrowDown aria-hidden="true" />
            </button>
          </div>
          <ul className="settings__list">
            {group.items.map((item, itemIndex) => (
              <li
                key={item.id}
                className="settings__row"
                data-archived={item.archived || undefined}
              >
                <IconField
                  value={item.icon}
                  label={`Icon for ${item.name}`}
                  onChange={(icon) =>
                    changeGroup(group.id, (g) => ({
                      ...g,
                      items: g.items.map((other) =>
                        other.id === item.id ? { ...other, icon: icon || '•' } : other,
                      ),
                    }))
                  }
                />
                <input
                  key={item.name}
                  className="bare-input"
                  aria-label="Activity name"
                  defaultValue={item.name}
                  onBlur={(event) =>
                    event.target.value.trim() &&
                    event.target.value !== item.name &&
                    changeGroup(group.id, (g) => ({
                      ...g,
                      items: g.items.map((other) =>
                        other.id === item.id
                          ? { ...other, name: event.target.value.trim() }
                          : other,
                      ),
                    }))
                  }
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${item.name} up`}
                  onClick={() =>
                    changeGroup(group.id, (g) => ({
                      ...g,
                      items: move(g.items, itemIndex, itemIndex - 1),
                    }))
                  }
                >
                  <ArrowUp aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() =>
                    changeGroup(group.id, (g) => ({
                      ...g,
                      items: g.items.map((other) =>
                        other.id === item.id ? { ...other, archived: !other.archived } : other,
                      ),
                    }))
                  }
                >
                  {item.archived ? 'Restore' : 'Archive'}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="chip chip--add"
            onClick={() =>
              changeGroup(group.id, (g) => ({
                ...g,
                items: [
                  ...g.items,
                  { id: randomId(), name: 'new activity', icon: '✨', archived: false },
                ],
              }))
            }
          >
            <Plus aria-hidden="true" /> Add activity
          </button>
        </div>
      ))}
      <div className="settings__actions">
        <button
          type="button"
          className="button"
          onClick={() =>
            change((groups) => [...groups, { id: randomId(), name: 'New group', items: [] }])
          }
        >
          <Plus aria-hidden="true" /> Add group
        </button>
        {activities.createdAt > 0 ? (
          <button
            type="button"
            className="button button--quiet"
            onClick={() => {
              const missing = DEFAULT_ACTIVITIES.filter(
                (g) => !activities.groups.some((own) => own.id === g.id),
              );
              if (missing.length === 0) return;
              change((groups) => [...groups, ...missing]);
            }}
          >
            Bring back default groups
          </button>
        ) : null}
      </div>
    </Section>
  );
}

function PromptsSection() {
  const journal = useJournal();
  const prompts = journal.settings().prompts;
  return (
    <Section
      id="prompts"
      title="Prompts"
      lede="Questions an empty day asks, one per line. A different one each day."
    >
      <textarea
        key={prompts.join('\n')}
        className="input"
        rows={Math.min(14, prompts.length + 2)}
        aria-label="Prompts, one per line"
        defaultValue={prompts.join('\n')}
        onBlur={(event) => {
          const next = event.target.value
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
          if (next.join('\n') !== prompts.join('\n'))
            void journal.updateSettings((s) => ({ ...s, prompts: next }));
        }}
      />
      <button
        type="button"
        className="button button--quiet"
        onClick={() => void journal.updateSettings((s) => ({ ...s, prompts: DEFAULT_PROMPTS }))}
      >
        Reset to the defaults
      </button>
    </Section>
  );
}

function TemplatesSection() {
  const journal = useJournal();
  const [open, setOpen] = useState<string | null>(null);
  const templates = journal.templates();
  return (
    <Section
      id="templates"
      title="Templates"
      lede="Shapes for a day's writing, offered when a day is empty."
    >
      <ul className="settings__list">
        {BUILT_IN_TEMPLATES.map((template) => (
          <li key={template.id} className="settings__row">
            <span aria-hidden="true">{template.icon}</span>
            <span>{template.name}</span>
            <span className="faint">built in</span>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                const id = journal.save({
                  ...blankTemplate(`${template.name} (mine)`),
                  icon: template.icon,
                  body: structuredClone(template.body),
                });
                setOpen(id);
              }}
            >
              Duplicate
            </button>
          </li>
        ))}
        {templates.map(([id, template]) => (
          <li key={id} className="settings__block">
            <div className="settings__row">
              <IconField
                value={template.icon}
                label="Icon"
                onChange={(icon) =>
                  journal.update<Template>(id, (t) => ({ ...t, icon: icon || '📄' }))
                }
              />
              <input
                key={template.name}
                className="bare-input"
                aria-label="Template name"
                defaultValue={template.name}
                onBlur={(event) =>
                  event.target.value !== template.name &&
                  journal.update<Template>(id, (t) => ({ ...t, name: event.target.value }))
                }
              />
              <button
                type="button"
                className="button button--quiet"
                onClick={() => setOpen(open === id ? null : id)}
              >
                {open === id ? 'Done' : 'Edit'}
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Delete ${template.name}`}
                onClick={() => confirm(`Delete “${template.name}”?`) && journal.remove(id)}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </div>
            {open === id ? (
              <RichTextEditor
                label={`Template ${template.name}`}
                value={template.body as Doc}
                onChange={(body) =>
                  journal.update<Template>(id, (t) => ({
                    ...t,
                    body: (body as RichText | null) ?? {
                      type: 'doc',
                      content: [{ type: 'paragraph' }],
                    },
                  }))
                }
              />
            ) : null}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="chip chip--add"
        onClick={() => setOpen(journal.save(blankTemplate()))}
      >
        <Plus aria-hidden="true" /> New template
      </button>
    </Section>
  );
}

// --- This device --------------------------------------------------------------------------------

function AppearanceSection() {
  const journal = useJournal();
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const settings = journal.settings();
  return (
    <Section id="appearance" title="Appearance">
      <div className="settings__row">
        <span>Theme on this device</span>
        <Segmented
          label="Theme"
          value={theme}
          options={[
            { value: 'auto', label: 'Automatic' },
            { value: 'day', label: 'Light' },
            { value: 'night', label: 'Dark' },
          ]}
          onChange={(choice) => {
            setTheme(choice);
            applyTheme(choice);
          }}
        />
      </div>
      <div className="settings__row">
        <span>Weeks start on</span>
        <Segmented
          label="Weeks start on"
          value={settings.weekStart}
          options={[
            { value: 1, label: 'Monday' },
            { value: 0, label: 'Sunday' },
          ]}
          onChange={(weekStart) => void journal.updateSettings((s) => ({ ...s, weekStart }))}
        />
      </div>
    </Section>
  );
}

function DataSection() {
  const journal = useJournal();
  const status = journal.status;
  const [queued, setQueued] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    void queuedUploads().then(setQueued);
  }, [status.lastSyncedAt]);

  const exportJson = () => {
    const records = [...journal.everything()].map(([id, record]) => ({ id, ...record }));
    const blob = new Blob(
      [JSON.stringify({ exportedAt: new Date().toISOString(), version: 1, records }, null, 2)],
      {
        type: 'application/json',
      },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `journal-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <Section id="data" title="Your data">
      <p className="muted">
        {status.lastSyncedAt
          ? `Last synced ${new Date(status.lastSyncedAt).toLocaleString()}`
          : 'Not synced yet'}
        {status.pending ? ` · ${status.pending} changes waiting` : ''}
        {queued ? ` · ${queued} photo files waiting to upload` : ''}
        {status.unreadable ? ` · ${status.unreadable} records this device can’t open` : ''}
      </p>
      <div className="settings__actions">
        <button type="button" className="button" onClick={() => void journal.syncNow()}>
          Sync now
        </button>
        <button type="button" className="button" onClick={exportJson}>
          Export everything (JSON)
        </button>
        <button
          type="button"
          className="button button--quiet"
          disabled={status.pending > 0 || status.state !== 'idle'}
          onClick={() => {
            const records = [...journal.everything()].map(([, record]) => record);
            collectGarbage(records)
              .then((removed) =>
                setMessage(removed ? `Removed ${removed} unused files.` : 'Nothing to clean up.'),
              )
              .catch((caught: unknown) => setMessage(describe(caught)));
          }}
        >
          Clean up unused photos
        </button>
      </div>
      <p className="hint">
        The export is your journal, readable: keep it somewhere safe. It holds your words and
        settings; photos stay in the app.
      </p>
      {message ? <p className="muted">{message}</p> : null}
      <p className="hint">
        Everything is encrypted on your devices with a key the server never sees (AES-256, unlocked
        with your passkey). The server stores only ciphertext.
      </p>
    </Section>
  );
}
