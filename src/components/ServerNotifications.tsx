import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type NotificationPage, type ServerNotification } from '../data/api';
import { Icon } from './Icon';
import { Dialog, Empty, dateTime } from './ui';
import './server-notifications.css';

const IMPORTANT = new Set(['critical.raised', 'coordinator.assigned', 'critical.resolved']);
const MAX_TOASTS = 3;

function notificationIcon(type: string) {
  if (type === 'critical.raised') return 'alert';
  if (type === 'critical.resolved') return 'circleCheck';
  if (type === 'coordinator.assigned') return 'userPlus';
  return 'bell';
}

// Keep already loaded archive pages only when their boundary still overlaps
// the new head. A burst larger than one page starts a new cursor chain.
function replaceHead(previous: NotificationPage | null, page: NotificationPage): NotificationPage {
  const last = page.items.at(-1);
  if (!last || !page.nextCursor || !previous) return page;
  const index = previous.items.findIndex(item => item.id === last.id);
  if (index < 0) return page;
  return { ...page, items: [...page.items, ...previous.items.slice(index + 1)], nextCursor: previous.nextCursor };
}

interface Props {
  connected: boolean;
  revision?: number;
  onOpen: (key: string) => void;
}

export function ServerNotifications({ connected, revision, onOpen }: Props) {
  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState<NotificationPage | null>(null);
  const [toasts, setToasts] = useState<ServerNotification[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [headError, setHeadError] = useState(false);
  const [actionError, setActionError] = useState('');
  const [morePending, setMorePending] = useState(false);
  const [savingIds, setSavingIds] = useState<number[]>([]);
  const highWater = useRef<{ revision: number; id: number } | null>(null);
  const moreRequest = useRef<AbortController | null>(null);
  const mutations = useRef(new Map<number, AbortController>());
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  const dismiss = useCallback((id: number) => setToasts(previous => previous.filter(item => item.id !== id)), []);

  useEffect(() => {
    if (!connected || revision === undefined) return;
    const controller = new AbortController();
    api.notifications(undefined, controller.signal).then(page => {
      if (controller.signal.aborted) return;
      const prior = highWater.current;
      const newest = page.items[0]?.id ?? 0;
      const reset = prior !== null && (revision < prior.revision || newest < prior.id);
      if (reset) {
        moreRequest.current?.abort();
        moreRequest.current = null;
        setMorePending(false);
        setToasts([]);
      } else if (prior && newest > prior.id) {
        const incoming = page.items.filter(row => row.id > prior.id && !row.isRead && IMPORTANT.has(row.type));
        if (incoming.length) setToasts(previous => [...incoming, ...previous].slice(0, MAX_TOASTS));
      }
      highWater.current = { revision, id: newest };
      setFeed(previous => replaceHead(reset ? null : previous, page));
      setHeadError(false);
    }).catch(() => { if (!controller.signal.aborted) setHeadError(true); });
    return () => controller.abort();
  }, [connected, revision, attempt]);

  useEffect(() => {
    if (!connected) return;
    // Read receipts from other clients do not increment the snapshot revision.
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [connected, refresh]);

  useEffect(() => {
    const pending = mutations.current;
    return () => {
      moreRequest.current?.abort();
      pending.forEach(request => request.abort());
    };
  }, []);

  async function loadMore() {
    const cursor = feed?.nextCursor;
    if (!connected || !cursor || moreRequest.current) return;
    const controller = new AbortController();
    moreRequest.current = controller;
    setMorePending(true);
    setActionError('');
    try {
      const page = await api.notifications(cursor, controller.signal);
      if (controller.signal.aborted) return;
      setFeed(previous => previous?.nextCursor === cursor ? {
        ...previous, nextCursor: page.nextCursor, items: [...previous.items, ...page.items],
      } : previous);
    } catch {
      if (!controller.signal.aborted) setActionError('Не удалось загрузить предыдущие уведомления. Повторите загрузку.');
    } finally {
      if (moreRequest.current === controller) {
        moreRequest.current = null;
        if (!controller.signal.aborted) setMorePending(false);
      }
    }
  }

  async function markRead(row: ServerNotification) {
    if (!connected || row.isRead || mutations.current.has(row.id)) return;
    const controller = new AbortController();
    mutations.current.set(row.id, controller);
    setSavingIds([...mutations.current.keys()]);
    setActionError('');
    try {
      await api.markNotificationRead(row.id, controller.signal);
      if (controller.signal.aborted) return;
      setFeed(previous => {
        if (!previous) return previous;
        const wasUnread = previous.items.some(item => item.id === row.id && !item.isRead);
        return {
          ...previous, unreadCount: Math.max(0, previous.unreadCount - Number(wasUnread)),
          items: previous.items.map(item => item.id === row.id ? { ...item, isRead: true } : item),
        };
      });
      dismiss(row.id);
      refresh();
    } catch {
      if (!controller.signal.aborted) setActionError('Не удалось сохранить отметку о прочтении. Повторите действие.');
    } finally {
      mutations.current.delete(row.id);
      if (!controller.signal.aborted) setSavingIds([...mutations.current.keys()]);
    }
  }

  function showIncident(row: ServerNotification) {
    const key = row.sysId || row.incidentId;
    if (!key) return;
    void markRead(row);
    dismiss(row.id);
    setOpen(false);
    onOpen(key);
  }

  const unread = feed?.unreadCount ?? 0;
  return <>
    <button type="button" className="icon-button server-notification-trigger" aria-haspopup="dialog" aria-expanded={open}
      aria-label={`Уведомления сервера, непрочитанных: ${unread}`} title="Уведомления сервера"
      onClick={() => { setOpen(true); refresh(); }}>
      <Icon name="bell" size={16}/>
      {unread > 0 && <span aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
    </button>
    {open && createPortal(<Dialog title="Уведомления" className="server-notifications-dialog" onClose={() => setOpen(false)}>
      {feed && <p className="server-notification-summary">Непрочитанных · {unread}</p>}
      {!connected && <p role="status" className="server-notification-status">Нет соединения с сервером.</p>}
      {connected && headError && <p className="server-notification-error" role="alert">Не удалось обновить уведомления. <button className="text-button" onClick={refresh}>Повторить</button></p>}
      {actionError && <p className="server-notification-error" role="alert">{actionError}</p>}
      {feed?.items.length ? <ul className="server-notification-list">{feed.items.map(row =>
        <li key={row.id} className={row.isRead ? '' : 'is-unread'}>
          <span className={`server-notification-symbol symbol-${notificationIcon(row.type)}`}><Icon name={notificationIcon(row.type)} size={18}/></span>
          <div><strong>{row.title}</strong><p>{row.body}</p><time dateTime={row.createdAt}>{dateTime(row.createdAt)} МСК</time>
            <div className="server-notification-actions">
              {(row.sysId || row.incidentId) && <button className="text-button" onClick={() => showIncident(row)}>Открыть инцидент</button>}
              {!row.isRead && <button className="text-button" disabled={!connected || savingIds.includes(row.id)} onClick={() => void markRead(row)}>Отметить прочитанным</button>}
            </div>
          </div>
        </li>)}</ul> : <Empty icon="bell" title={feed ? 'Уведомлений пока нет' : connected && !headError ? 'Загружаем уведомления…' : 'Лента недоступна'}>
        {feed ? 'Здесь появятся критические инциденты, назначения координаторам и изменения источника.' : ''}
      </Empty>}
      {feed?.nextCursor && <button className="button secondary" disabled={!connected || morePending} onClick={() => void loadMore()}>{morePending ? 'Загружаем…' : 'Показать предыдущие'}</button>}
    </Dialog>, document.body)}
    {createPortal(<div className="server-toast-stack" aria-live="polite" aria-relevant="additions">
      {!open && toasts.map(row => <NotificationToast key={row.id} row={row} dismiss={dismiss} onOpen={() => showIncident(row)}/>)}
      {!open && actionError && <div className="server-notification-error server-toast-error" role="alert">{actionError}<button className="icon-button" aria-label="Скрыть сообщение" onClick={() => setActionError('')}><Icon name="close" size={16}/></button></div>}
    </div>, document.body)}
  </>;
}

function NotificationToast({ row, dismiss, onOpen }: { row: ServerNotification; dismiss: (id: number) => void; onOpen: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(row.id), 12_000);
    return () => clearTimeout(timer);
  }, [row.id, dismiss]);
  return <article className="server-notification-toast">
    <span className={`server-notification-symbol symbol-${notificationIcon(row.type)}`}><Icon name={notificationIcon(row.type)} size={19}/></span>
    <button className="server-toast-open" onClick={onOpen}><strong>{row.title}</strong><span>{row.body}</span></button>
    <button className="icon-button" aria-label="Скрыть уведомление" onClick={() => dismiss(row.id)}><Icon name="close" size={16}/></button>
  </article>;
}
