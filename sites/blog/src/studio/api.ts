/**
 * The studio's calls to the blog's API (server/api.ts), typed from the server's own types. Every
 * error arrives as an ApiError with the status and the server's sentence, ready to show.
 */
import type { MailStatus } from '../server/mail';
import type { StoredImage } from '../server/media';
import type { Draft, SeriesInfo, StudioPost, TagInfo } from '../server/posts';
import type { CommentStatus, StudioComment } from '../server/comments';
import type { Subscriber } from '../server/subscribers';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * "The session ended" (a 401 anywhere): the app asks for the passkey again, over whatever is on
 * screen. "Signed in again": whatever waited (a save) goes now.
 */
const signedOutListeners = new Set<() => void>();
const signedInListeners = new Set<() => void>();

const listen = (listeners: Set<() => void>, listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const onSignedOut = (listener: () => void): (() => void) =>
  listen(signedOutListeners, listener);
export const onSignedIn = (listener: () => void): (() => void) =>
  listen(signedInListeners, listener);
export function signedInAgain(): void {
  for (const listener of signedInListeners) listener();
}

/** "/studio/posts?x=1" → "/api/studio/posts/?x=1": the dev server answers only addresses that
 * end in "/" (the API itself takes both). */
export function apiUrl(path: string): string {
  const [route = '', query] = path.split('?');
  return `/api${route.endsWith('/') ? route : `${route}/`}${query === undefined ? '' : `?${query}`}`;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }
  let response: Response;
  try {
    response = await fetch(apiUrl(path), init);
  } catch {
    throw new ApiError(
      0,
      'No connection. Your work is kept here; it saves when the connection is back.',
    );
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) {
      for (const listener of signedOutListeners) listener();
    }
    const message =
      typeof data['error'] === 'string' ? data['error'] : `The server said ${response.status}`;
    throw new ApiError(response.status, message, data);
  }
  return data as T;
}

export type ListedPost = StudioPost;

export interface Overview {
  posts: ListedPost[];
  pendingComments: number;
  mail: MailStatus;
}

export interface Passkey {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
  synced: boolean;
  current: boolean;
}

// WebAuthn options travel as JSON; @simplewebauthn/browser takes them as they come.
type Options = Record<string, unknown>;

export const api = {
  state: () => call<{ setUp: boolean; signedIn: boolean }>('GET', '/auth/state'),
  setupBegin: (token: string) =>
    call<{ challengeId: string; options: Options }>('POST', '/auth/setup/begin', { token }),
  setupFinish: (input: { token: string; challengeId: string; response: unknown; label: string }) =>
    call<{ ok: true }>('POST', '/auth/setup/finish', input),
  loginBegin: () => call<{ challengeId: string; options: Options }>('POST', '/auth/login/begin'),
  loginFinish: (input: { challengeId: string; response: unknown }) =>
    call<{ ok: true }>('POST', '/auth/login/finish', input),
  logout: () => call<{ ok: true }>('POST', '/auth/logout'),

  overview: () => call<Overview>('GET', '/studio/overview'),
  createPost: () => call<StudioPost>('POST', '/studio/posts'),
  post: (id: string) => call<StudioPost>('GET', `/studio/posts/${id}`),
  saveDraft: (id: string, draft: Draft, baseRev: number) =>
    call<{ draftRev: number; draftSavedAt: number }>('PUT', `/studio/posts/${id}/draft`, {
      draft,
      baseRev,
    }),
  publish: (id: string, rev: number) =>
    call<{ slug: string; firstTime: boolean; post: StudioPost }>(
      'POST',
      `/studio/posts/${id}/publish`,
      { rev },
    ),
  unpublish: (id: string) => call<StudioPost>('POST', `/studio/posts/${id}/unpublish`),
  deletePost: (id: string) => call<{ ok: true }>('DELETE', `/studio/posts/${id}`),
  notify: (id: string) => call<{ queued: number }>('POST', `/studio/posts/${id}/notify`),

  upload: (form: FormData) => call<StoredImage>('POST', '/studio/media', form),
  media: (id: string) => call<StoredImage>('GET', `/studio/media/${id}`),

  tags: () => call<TagInfo[]>('GET', '/studio/tags'),
  saveTag: (slug: string, tag: { name: string; family: TagInfo['family']; description: string }) =>
    call<{ ok: true }>('PUT', `/studio/tags/${slug}`, tag),
  deleteTag: (slug: string) => call<{ ok: true }>('DELETE', `/studio/tags/${slug}`),
  series: () => call<SeriesInfo[]>('GET', '/studio/series'),
  createSeries: (series: { title: string; slug: string; description: string }) =>
    call<SeriesInfo>('POST', '/studio/series', series),
  saveSeries: (id: string, series: { title: string; slug: string; description: string }) =>
    call<SeriesInfo>('PUT', `/studio/series/${id}`, series),
  deleteSeries: (id: string) => call<{ ok: true }>('DELETE', `/studio/series/${id}`),

  comments: (status: CommentStatus) =>
    call<StudioComment[]>('GET', `/studio/comments?status=${status}`),
  setCommentStatus: (id: string, status: CommentStatus) =>
    call<{ ok: true }>('POST', `/studio/comments/${id}/status`, { status }),
  reply: (id: string, body: string) =>
    call<{ id: string }>('POST', `/studio/comments/${id}/reply`, { body }),
  deleteComment: (id: string) => call<{ ok: true }>('DELETE', `/studio/comments/${id}`),

  subscribers: () => call<Subscriber[]>('GET', '/studio/subscribers'),
  removeSubscriber: (id: string) => call<{ ok: true }>('DELETE', `/studio/subscribers/${id}`),

  passkeys: () => call<Passkey[]>('GET', '/studio/passkeys'),
  passkeyBegin: () =>
    call<{ challengeId: string; options: Options }>('POST', '/studio/passkeys/begin'),
  passkeyFinish: (input: { challengeId: string; response: unknown; label: string }) =>
    call<{ id: string }>('POST', '/studio/passkeys/finish', input),
  renamePasskey: (id: string, label: string) =>
    call<{ ok: true }>('PATCH', `/studio/passkeys/${id}`, { label }),
  deletePasskey: (id: string) => call<{ ok: true }>('DELETE', `/studio/passkeys/${id}`),
};
