import type { ProblemCluster, QueuePage, QueueQuery } from '../domain/operations';
import type { MassExclusion } from '../domain/massProblems.ts';
import type { PersonalStatistics } from '../domain/personalStatistics.ts';
import type { Analysis } from '../domain/incidents';
import { normalizeIncident, normalizeSnapshot, normalizeEvent, type WireEvent, type WireSnapshot } from './wire.ts';

export const API_BASE = '/api/v1';
const SESSION_PATH = '/auth/coordinator/session';
const sessionEvents = new EventTarget();
let sessionVersion = 0;

export interface CoordinatorSession {
  required: boolean;
  authenticated: boolean;
  mode?: 'accounts' | 'shared-key' | 'none';
  coordinator?: { login: string; displayName: string };
}

export type Credentials = { login: string; password: string } | { key: string };

export function onUnauthorized(listener: () => void) {
  sessionEvents.addEventListener('unauthorized', listener);
  return () => sessionEvents.removeEventListener('unauthorized', listener);
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function requestResponse(path: string, init?: RequestInit): Promise<Response> {
  const version = sessionVersion;
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(API_BASE + path, { cache: 'no-store', ...init, headers });
  if (!response.ok) {
    if (response.status === 401 && path !== SESSION_PATH && version === sessionVersion && !init?.signal?.aborted) {
      sessionVersion++;
      sessionEvents.dispatchEvent(new Event('unauthorized'));
    }
    const body = await response.json().catch(() => null);
    throw new ApiError(response.status, body?.error ?? body?.message ?? `Сервер вернул HTTP ${response.status}`);
  }
  return response;
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await requestResponse(path, init)).json();
}

const snapshotRequest = async (path: string, init?: RequestInit) =>
  normalizeSnapshot(await request<WireSnapshot>(path, init));

function validSession(value: CoordinatorSession | null): CoordinatorSession {
  if (typeof value?.required !== 'boolean' || typeof value.authenticated !== 'boolean'
    || (value.mode !== undefined && !['accounts', 'shared-key', 'none'].includes(value.mode))
    || (value.mode !== undefined && value.required !== (value.mode !== 'none'))
    || (!value.required && value.authenticated)
    || (value.mode === 'accounts' && value.authenticated &&
      (typeof value.coordinator?.login !== 'string' || typeof value.coordinator?.displayName !== 'string'))) {
    throw new Error('Некорректный ответ сервера при проверке сессии.');
  }
  return value;
}

export async function coordinatorSession(signal: AbortSignal): Promise<CoordinatorSession> {
  try {
    return validSession(await request<CoordinatorSession>(SESSION_PATH, { signal }));
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
  // Confirm an older API without downloading the whole dashboard before launch.
  const page = await request<{ items: unknown[]; nextCursor: string | null }>('/events?limit=1', { signal });
  if (!Array.isArray(page?.items) || (page.nextCursor !== null && typeof page.nextCursor !== 'string')) {
    throw new Error('Сервер не вернул страницу журнала событий.');
  }
  return { required: false, authenticated: false, mode: 'none' };
}

export async function signInCoordinator(credentials: Credentials, signal: AbortSignal) {
  const result = validSession(await request<CoordinatorSession>(SESSION_PATH, {
    method: 'POST', body: JSON.stringify({ ...credentials, remember: false }), signal,
  }));
  if (!result.authenticated) throw new Error('Сервер не подтвердил вход.');
  sessionVersion++;
  return result;
}

export async function signOutCoordinator(signal: AbortSignal) {
  await requestResponse(SESSION_PATH, { method: 'DELETE', signal });
  sessionVersion++;
}

export interface ServerNotification {
  id: number;
  type: string;
  title: string;
  body: string;
  incidentId: string | null;
  sysId: string | null;
  createdAt: string;
  isRead: boolean;
  readAt: string | null;
}

export interface NotificationPage {
  items: ServerNotification[];
  nextCursor: string | null;
  unreadCount: number;
}

export interface MassClusters {
  revision: number;
  items: ProblemCluster[];
  exclusions: MassExclusion[];
}

export type MassEdit =
  | { action: 'add'; groupId: string; sysIds: string[] }
  | { action: 'exclude'; groupId: string; sysId: string }
  | { action: 'restore'; sysId: string };

interface WireIncidentDetail {
  incident: WireSnapshot['items'][number];
  revision: number;
  details?: { isPresent: boolean };
}

async function eventPage(path: string, limit: number, beforeId?: string, signal?: AbortSignal, afterId?: string) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (beforeId) params.set('beforeId', beforeId);
  if (afterId) params.set('afterId', afterId);
  const page = await request<{ items: WireEvent[]; nextCursor?: string | null }>(path + '?' + params, { signal, cache: 'no-store' });
  return { items: page.items.map(normalizeEvent), nextCursor: page.nextCursor ?? null };
}

export const api = {
  snapshot: (signal?: AbortSignal) => snapshotRequest('/snapshot?view=web', { cache: 'no-store', signal }),
  async incidents(query: QueueQuery): Promise<QueuePage> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...query, page: query.page ?? 1 })) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const page = await request<QueuePage>('/incidents?' + params);
    return { ...page, items: page.items.map(normalizeIncident) };
  },
  async incident(key: string, signal?: AbortSignal) {
    const { incident: raw, revision, details } = await request<WireIncidentDetail>(
      '/incidents/' + encodeURIComponent(key) + '?view=web', { signal },
    );
    return { incident: normalizeIncident(raw), revision, isPresent: details?.isPresent ?? true };
  },
  events: (beforeId?: string, signal?: AbortSignal, afterId?: string) => eventPage('/events', 200, beforeId, signal, afterId),
  incidentEvents: (key: string, beforeId?: string, signal?: AbortSignal) =>
    eventPage('/incidents/' + encodeURIComponent(key) + '/events', 3, beforeId, signal),
  teams: () => request<{ items: { name: string; activeCount: number }[] }>('/teams'),
  assign: (id: string, team: string, expectedRevision: number) =>
    snapshotRequest('/incidents/' + encodeURIComponent(id) + '/assignment', {
      method: 'POST',
      body: JSON.stringify({ team, expectedRevision }),
    }),
  shiftStatistics(from: number, to: number, signal?: AbortSignal) {
    const params = new URLSearchParams({
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    });
    return request<PersonalStatistics>('/statistics/shift?' + params, { signal });
  },
  massClusters: (signal?: AbortSignal) => request<MassClusters>('/problems/clusters', { signal }),
  editMassClusters: (edit: MassEdit, expectedRevision: number) =>
    request<MassClusters>('/problems/clusters', {
      method: 'PATCH',
      body: JSON.stringify({ ...edit, expectedRevision }),
    }),
  analysis: (id: string) => request<Analysis>(`/incidents/${encodeURIComponent(id)}/analysis`),
  notifications(cursor?: string, signal?: AbortSignal) {
    const params = new URLSearchParams({ limit: '30' });
    if (cursor) params.set('cursor', cursor);
    return request<NotificationPage>('/notifications?' + params, { signal, cache: 'no-store' });
  },
  async markNotificationRead(id: number, signal?: AbortSignal): Promise<void> {
    await requestResponse('/notifications/' + id + '/read', { method: 'PUT', signal });
  },
};
