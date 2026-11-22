import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Brand } from '../components/Brand';
import { ConnectionNotice } from '../components/ConnectionNotice';
import { Icon } from '../components/Icon';
import { ServerNotifications } from '../components/ServerNotifications';
import type { CoordinatorSession } from '../data/api';
import { useAlertSignal } from '../data/useAlertSignal';
import { useIncidents } from '../data/useIncidents';
import { useMassClusters } from '../data/useMassClusters';
import type { Incident, ChangeEvent } from '../domain/incidents';
import { AlertHeader } from '../features/AlertHeader';
import { Analytics } from '../features/Analytics';
import { AssignTeam } from '../features/AssignTeam';
import { ConnectionPage } from '../features/ConnectionPage';
import { IncidentDetailPage } from '../features/Detail';
import { EventsJournal } from '../features/EventsJournal';
import { IncidentDashboard } from '../features/IncidentDashboard';
import { ProblemClusters } from '../features/ProblemClusters';
import { TeamsDirectory } from '../features/TeamsDirectory';
import { backLabels, incidentHash, readRoute, type Page } from './routes';
import { readLocal, saveLocal } from './connection';

const pages = [
  { id: 'incidents', label: 'Инциденты' }, { id: 'events', label: 'События' },
  { id: 'teams', label: 'Команды' }, { id: 'analytics', label: 'Аналитика' },
  { id: 'problems', label: 'Массовые сбои' },
] as const;
const emptyItems: Incident[] = [];
const emptyEvents: ChangeEvent[] = [];

export function App({ origin, session, offlineOnly, onRetryConnection, onSignOut }: {
  origin: string; session: CoordinatorSession; offlineOnly: boolean; onRetryConnection: () => void; onSignOut?: () => Promise<void>;
}) {
  const data = useIncidents(origin, !session.required, offlineOnly);
  const { snapshot, connected, checked, online, loading, historyEpoch } = data;
  const refresh = offlineOnly ? async () => onRetryConnection() : data.refresh;
  const [route, setRoute] = useState(() => readRoute(location.hash));
  const { page, incidentId } = route;
  const workspace = useRef<HTMLDivElement>(null);
  const originFocus = useRef<HTMLElement | null>(null);
  const lastPage = useRef<Page>('incidents');
  const previousDetail = useRef<string | null>(null);
  const [assignId, setAssignId] = useState<string | null>(null);
  const [teamContext, setTeamContext] = useState<{ name: string; token: number } | null>(null);
  const [now, setNow] = useState(Date.now);
  const workspaceId = session.coordinator ? `${origin}/${encodeURIComponent(session.coordinator.login)}` : origin;
  const profileKey = session.coordinator ? `underctrl.profile.${workspaceId}` : 'underctrl.profile';
  const [profile, setProfile] = useState(() => readLocal(profileKey));
  const readKey = `underctrl.events.read.${workspaceId}`;
  const [lastRead, setLastRead] = useState(() => Number(readLocal(readKey, '0')) || 0);
  const items = snapshot?.items ?? emptyItems;
  const events = snapshot?.events ?? emptyEvents;
  const clock = now + data.clockOffset;
  const mass = useMassClusters(connected, snapshot?.revision, page === 'problems' && !incidentId);
  const { sequence } = useAlertSignal(items, clock, connected && !!snapshot);
  const latest = events[0]?.eventId ?? 0;
  const unread = events.filter(event => event.eventId > lastRead).length;
  const previousEpoch = useRef(historyEpoch);
  const assignment = items.find(item => item.sysId === assignId);

  useEffect(() => {
    const sync = () => setRoute(readRoute(location.hash));
    const shortcuts = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || document.querySelector('dialog[open]')) return;
      const target = pages.find((_, i) => event.code === `Digit${i + 1}`);
      if (target) { event.preventDefault(); location.hash = target.id; }
    };
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    window.addEventListener('keydown', shortcuts);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); window.removeEventListener('keydown', shortcuts); clearInterval(tick); };
  }, []);
  useEffect(() => {
    if (connected && snapshot && (lastRead > latest || previousEpoch.current !== historyEpoch)) {
      previousEpoch.current = historyEpoch;
      setLastRead(0);
      saveLocal(readKey, '0');
    }
  }, [connected, snapshot, lastRead, latest, historyEpoch, readKey]);
  useLayoutEffect(() => {
    if (!workspace.current) return;
    if (incidentId) {
      workspace.current.scrollTop = 0;
      document.getElementById('incident-title')?.focus({ preventScroll: true });
    } else if (previousDetail.current && lastPage.current === page) {
      workspace.current.scrollTop = Number(history.state?.scrollTop ?? 0);
      originFocus.current?.focus({ preventScroll: true });
    } else workspace.current.scrollTop = 0;
    previousDetail.current = incidentId;
    lastPage.current = page;
  }, [incidentId, page]);
  function openIncident(id: string) {
    const hash = incidentHash(id, page);
    if (incidentId) history.replaceState(history.state, '', hash);
    else {
      originFocus.current = document.activeElement as HTMLElement;
      history.replaceState({ ...history.state, scrollTop: workspace.current?.scrollTop ?? 0 }, '', location.href);
      history.pushState({ detail: true }, '', hash);
    }
    setRoute(readRoute(hash));
  }
  function closeIncident() {
    if (history.state?.detail) history.back();
    else location.replace('#' + page);
  }
  function markJournalRead() { setLastRead(latest); saveLocal(readKey, String(latest)); }
  function showConnection() {
    history.pushState({ connection: true }, '', '#settings');
    setRoute(readRoute('#settings'));
  }
  const profileTitle = profile || session.coordinator?.displayName || 'Дежурная смена';
  const initials = profileTitle.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toLocaleUpperCase('ru');
  if (page === 'settings') return <ConnectionPage origin={origin} name={profile} onSignOut={onSignOut} onBack={() => history.state?.connection ? history.back() : location.replace('#incidents')} onConnect={(address, name) => {
    saveLocal(profileKey, name);
    setProfile(name);
    history.replaceState(null, '', '#incidents');
    if (address !== origin) location.reload();
    else { setRoute(readRoute('#incidents')); void refresh(); }
  }} />;

  return <div className={`app desktop-workspace page-${page}${incidentId ? ' page-incident-detail' : ''}`}>
    <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>К содержанию</a>
    <aside className="sidebar">
      <a href="#incidents" className="brand-link" aria-label="UnderCtrl · Инциденты"><Brand /></a>
      <nav aria-label="Рабочая область"><p className="nav-caption">РАБОЧАЯ ОБЛАСТЬ</p>
        {pages.map((link, i) => <a key={link.id} href={'#' + link.id} className={`nav-item ${page === link.id ? 'selected' : ''}`} title={`${link.label} (Alt+${i + 1})`} aria-label={link.label} aria-current={page === link.id ? 'page' : undefined}>
          <img src={`/design/${link.id}.svg`} alt="" /><span className="nav-label">{link.label}</span>{link.id === 'problems' && !!mass.view?.items.length && <b className="nav-count">{mass.view.items.length}</b>}
        </a>)}
      </nav>
      <div className="sidebar-bottom"><div className="sidebar-tools"><ServerNotifications connected={connected} revision={snapshot?.revision} onOpen={openIncident} /><button className="icon-button" title="Обновить данные" aria-label="Обновить данные" disabled={loading} onClick={() => void refresh()}><Icon name="refresh" size={16} /></button></div>
        <button className="sidebar-profile" onClick={showConnection} aria-label="Профиль и подключение" title="Профиль и подключение"><span className="avatar">{initials}</span><span className="profile-copy"><strong>{profileTitle}</strong><small>Координатор</small></span></button>
      </div>
    </aside>
    <div className="workspace" ref={workspace}><main id="main" className="main" tabIndex={-1}>
      {(!online || checked && !connected) && <ConnectionNotice online={offlineOnly ? navigator.onLine : online} snapshot={snapshot} loading={loading} onRetry={refresh} onConfigure={showConnection} />}
      {snapshot?.source.error && <div className="notice notice-warning" role="alert"><Icon name="alert" /><div><strong>Источник данных не обновляется</strong><p>{snapshot.source.error}. Предыдущий корректный снимок сохранён.</p></div></div>}
      <AlertHeader items={items} now={clock} status={snapshot ? 'ready' : checked || !online ? 'offline' : 'loading'} onOpen={openIncident} onJournal={() => { location.hash = 'events'; }} signalSequence={sequence} />
      <div className="screen-content" hidden={!!incidentId}>
        {page === 'incidents' && <IncidentDashboard snapshot={snapshot} now={clock} connected={connected} loading={loading} onOpen={openIncident} onAssign={setAssignId} teamContext={teamContext} />}
        {page === 'events' && <EventsJournal events={events} now={clock} loading={loading} connected={connected} onOpen={openIncident} historyEpoch={historyEpoch} unread={unread} onMarkRead={markJournalRead} />}
        {page === 'teams' && <TeamsDirectory items={items} now={clock} revision={snapshot?.revision ?? 0} connected={connected} loading={loading} onTeam={name => { setTeamContext({ name, token: Date.now() }); location.hash = 'incidents'; }} onOpen={openIncident} />}
        {page === 'analytics' && <Analytics snapshot={snapshot} now={clock} connected={connected} loading={loading} historyEpoch={historyEpoch} />}
        {page === 'problems' && <ProblemClusters workspace={mass} snapshot={snapshot} connected={connected} onOpen={openIncident} onAccept={data.accept} />}
      </div>
      {incidentId && <IncidentDetailPage key={incidentId} incidentKey={incidentId} snapshot={snapshot} online={online && (connected || !checked)} now={clock} onBack={closeIncident} backLabel={backLabels[page]} onAssign={setAssignId} />}
    </main></div>
    {assignment && snapshot && connected && <AssignTeam key={assignment.sysId} item={assignment} snapshot={snapshot} onClose={() => setAssignId(null)} onAccept={data.accept} />}
  </div>;
}
