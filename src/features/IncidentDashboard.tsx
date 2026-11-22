import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Empty, Status, Team } from '../components/ui';
import { Icon } from '../components/Icon';
import { api } from '../data/api';
import { INCIDENT_PAGE_SIZES, readIncidentPageSize, saveIncidentPageSize } from '../data/queuePreferences';
import { IncidentArrivalTracker } from '../domain/alertSignals';
import { belongs, type Group, type Incident, type Snapshot } from '../domain/incidents';
import { canAssign, queryIncidents, QUEUE_GROUPS, type QueuePage } from '../domain/operations';
import { queueSlaTimeBucket } from '../domain/queueSlaRefresh';
import { activeFilterLabels, emptyFilters, QueueFilters, type Filters } from '../screens/incidents/QueueFilters';
import { detailSla, resolutionLabel } from './detailPresentation';

interface Props {
  snapshot: Snapshot | null;
  now: number;
  connected: boolean;
  loading: boolean;
  onOpen: (id: string) => void;
  onAssign: (id: string) => void;
  teamContext: { name: string; token: number } | null;
}

const noItems: Incident[] = [];
const slaLabels = {
  late: 'Просрочен', soon: 'Истекает', normal: 'Осталось', restored: 'Устранён',
  closed: 'Остановлен', unknown: 'Срок не указан', research: 'Исследование',
};

function QueueSla({ item, now }: { item: Incident; now: number }) {
  const { kind, value } = detailSla(item, now);
  const tone = kind === 'restored' || kind === 'closed' ? 'stopped' : kind;
  return <span className={`queue-sla ${tone}`}><strong>{value}</strong><small>{slaLabels[kind]}</small></span>;
}

function useQueueChanges(snapshot: Snapshot | null) {
  const arrivalTracker = useRef(new IncidentArrivalTracker());
  const lastEvent = useRef<number | null>(null);
  const [expiry, setExpiry] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!snapshot) return;
    const fresh: Record<string, number> = {};
    const until = Date.now() + 6000;
    for (const id of arrivalTracker.current.update(snapshot.items)) fresh[id] = until;
    for (const event of snapshot.events) {
      if (lastEvent.current === null || event.eventId <= lastEvent.current) continue;
      for (const field of event.fields) fresh[event.sysId + '.' + field] = until;
    }
    lastEvent.current = snapshot.events.reduce((latest, event) => Math.max(latest, event.eventId), 0);
    if (Object.keys(fresh).length) setExpiry(previous => ({ ...previous, ...fresh }));
  }, [snapshot]);

  useEffect(() => {
    if (!Object.keys(expiry).length) return;
    const timer = setTimeout(() => {
      setExpiry(previous => Object.fromEntries(Object.entries(previous).filter(([, time]) => time > Date.now())));
    }, Math.max(0, Math.min(...Object.values(expiry)) - Date.now()) + 10);
    return () => clearTimeout(timer);
  }, [expiry]);
  return expiry;
}

export function IncidentDashboard({ snapshot, now, connected, loading, onOpen, onAssign, teamContext }: Props) {
  const items = snapshot?.items ?? noItems;
  const revision = snapshot?.revision ?? 0;
  const [group, setGroup] = useState<Group>('all');
  const [search, setSearch] = useState('');
  const [q, setQueryText] = useState('');
  const [sort, setSort] = useState('priority');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(readIncidentPageSize);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [response, setResponse] = useState<{ query: typeof query; data: QueuePage } | null>(null);
  const [failed, setFailed] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [retry, setRetry] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const expiry = useQueueChanges(snapshot);

  useEffect(() => {
    const timer = setTimeout(() => { setQueryText(search.trim()); setPage(1); }, 220);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (teamContext) {
      setGroup('all');
      setFilters({ ...emptyFilters, team: teamContext.name });
      setSearch('');
      setQueryText('');
      setPage(1);
    }
  }, [teamContext]);
  useEffect(() => {
    function find(event: KeyboardEvent) {
      const input = searchRef.current;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f'
        && input?.getClientRects().length && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        input.focus();
        input.select();
      }
    }
    window.addEventListener('keydown', find);
    return () => window.removeEventListener('keydown', find);
  }, []);

  const query = useMemo(() => ({ group, q, sort, page, pageSize, ...filters }), [group, q, sort, page, pageSize, filters]);
  const slaBucket = queueSlaTimeBucket(filters.sla, now);

  useEffect(() => {
    if (!connected) { setFetching(false); return; }
    let current = true;
    setFetching(true);
    setFailed(false);
    api.incidents(query).then(data => {
      if (!current) return;
      if (data.revision < revision) throw new Error('Устаревшая страница');
      setResponse({ query, data });
    }).catch(() => { if (current) setFailed(true); })
      .finally(() => { if (current) setFetching(false); });
    return () => { current = false; };
  }, [query, revision, connected, slaBucket, retry]);

  // Only time-based filters need the clock for local pagination.
  const filterTime = filters.sla ? now : 0;
  const cached = useMemo(() => queryIncidents(items, query, revision, filterTime), [items, query, revision, filterTime]);
  const result = connected && !failed && response?.query === query && response.data.revision === revision
    ? response.data : cached;
  const waiting = !snapshot && (loading || fetching);
  const totals = useMemo(() => new Map(QUEUE_GROUPS.map(({ id }) => [id, items.filter(item => belongs(item, id)).length])), [items]);
  const teams = useMemo(() => [...new Set([...items.map(i => i.assignedGroupName), filters.team])]
    .filter(name => name && name !== '__unassigned__').sort((a, b) => a.localeCompare(b, 'ru')), [items, filters.team]);
  const active = activeFilterLabels(filters);

  function changeFilters(value: Filters) {
    setFilters(value);
    setPage(1);
  }
  function cell(item: Incident, fields: string[], children: ReactNode) {
    const stamp = Math.max(0, ...fields.map(field => expiry[item.sysId + '.' + field] ?? 0));
    return <div key={stamp} className={`live-field ${stamp ? 'field-changed' : ''}`}>{children}</div>;
  }

  return <section className="incident-queue surface" aria-busy={fetching} aria-labelledby="queue-title">
    <header className="incident-queue-heading"><h2 id="queue-title">Очередь инцидентов</h2></header>
    <div className="incident-queue-toolbar">
      <div className="incident-tabs" role="group" aria-label="Группы инцидентов">
        {QUEUE_GROUPS.map(({ id, title }) => <button key={id} aria-pressed={group === id}
          onClick={() => { setGroup(id); setPage(1); }}><span>{title}</span><b>{totals.get(id)}</b></button>)}
      </div>
      <div className="queue-search-controls">
        <label className="search-field incident-search"><img src="./design/search.svg" alt="" width="17" height="17"/>
          <input type="search" ref={searchRef} maxLength={200} aria-label="Найти инцидент" placeholder="Найти инцидент"
            value={search} onChange={e => setSearch(e.target.value)}/>
        </label>
        <QueueFilters value={filters} onChange={changeFilters} teams={teams}/>
      </div>
    </div>
    {active.length > 0 && <div className="queue-active-filters"><span>Применено фильтров: {active.length}</span>
      {active.map(label => <span key={label}>{label}</span>)}
      <button className="text-button" onClick={() => changeFilters(emptyFilters)}>Сбросить</button></div>}
    {failed && connected && <p className="queue-cache-note" role="status">
      Не удалось загрузить страницу. Показаны последние сохранённые данные.{' '}
      <button className="text-button" onClick={() => setRetry(value => value + 1)}>Повторить</button>
    </p>}
    <div className="incident-table-wrap">
      <table className="incident-table" aria-label="Очередь инцидентов">
        <colgroup>{[29.2, 12.5, 23.9, 17.4, 17].map(width => <col key={width} style={{ width: width + '%' }}/>)}</colgroup>
        <thead><tr><th scope="col">Инцидент</th><th scope="col" aria-sort={sort === 'priority' ? 'descending' : 'none'}>
          <button className="table-sort" aria-label="Сортировать по приоритету" onClick={() => { setSort('priority'); setPage(1); }}>Приоритет</button>
        </th><th scope="col">Статус</th><th scope="col" aria-sort={sort === 'deadline' ? 'ascending' : 'none'}>
          <button className="table-sort" aria-label="Сортировать по сроку решения" onClick={() => { setSort(sort === 'deadline' ? 'priority' : 'deadline'); setPage(1); }}>SLA</button>
        </th><th scope="col">Команда</th></tr></thead>
        <tbody>{waiting ? Array.from({ length: Math.min(9, pageSize) }, (_, index) => <tr key={index} className="queue-skeleton"><td colSpan={5}><span/></td></tr>)
          : result.items.map(item => {
            const isNew = Boolean(expiry[item.sysId]);
            const assignable = connected && canAssign(item);
            const mark = resolutionLabel(item, now);
            const subtitle = [item.productName, item.service].filter(Boolean).join(' · ') || item.shortDescription || item.description;
            return <tr key={item.sysId} className={`${belongs(item, 'critical') ? 'row-critical' : ''} ${isNew ? 'incident-arrival' : ''}`}
              data-new-incident={isNew || undefined} tabIndex={0} aria-label={`Открыть инцидент ${item.id}`}
              onClick={() => onOpen(item.sysId)} onKeyDown={e => {
                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(item.sysId); }
              }}>
              <td>{cell(item, ['header', 'description', 'shortDescription', 'productName', 'service'], <div className="queue-incident-copy">
                <span className="incident-id">{item.id}</span><strong title={item.header}>{item.header}</strong>
                <small title={subtitle}>{subtitle}</small></div>)}</td>
              <td>{cell(item, ['priorityId', 'priority'], <span className={`queue-priority level-${item.priorityId}`}
                title={item.priority}>{item.priorityId >= 1 && item.priorityId <= 4 ? 'P' + (5 - item.priorityId) : '—'}</span>)}</td>
              <td>{cell(item, ['stateEnum', 'stateId', 'state'], <><Status item={item}/>{mark && <small className="queue-summary-status">{mark}</small>}</>)}</td>
              <td>{cell(item, ['deadline'], <QueueSla item={item} now={now}/>)}</td>
              <td>{cell(item, ['assignedGroupName'], <div className="queue-team-cell">
                {assignable ? <button className={item.assignedGroupName ? 'queue-assigned-team' : 'assign-team-button'}
                  aria-label={`${item.assignedGroupName ? 'Сменить' : 'Назначить'} команду для ${item.id}`}
                  title={item.assignedGroupName ? 'Сменить команду · ' + item.assignedGroupName : 'Назначить команду'}
                  onClick={event => { event.stopPropagation(); onAssign(item.sysId); }}>
                  {item.assignedGroupName ? <Team name={item.assignedGroupName}/> : <>Назначить <img src="./design/assign.svg" alt="" width="16" height="16"/></>}
                </button> : item.assignedGroupName ? <Team name={item.assignedGroupName}/> : <span className="muted">Не назначена</span>}
              </div>)}</td>
            </tr>;
          })}</tbody>
      </table>
    </div>
    {!waiting && !result.items.length && <Empty icon="search" title={snapshot ? 'Инциденты не найдены' : 'Нет данных для показа'}>
      {snapshot ? 'Попробуйте другую группу или поисковый запрос.' : 'Очередь появится после подключения к серверу.'}
    </Empty>}
    <footer className="incident-pagination">
      <span>{result.total ? `${(result.page - 1) * result.pageSize + 1}–${Math.min(result.page * result.pageSize, result.total)} из ${result.total}` : '0 инцидентов'}</span>
      <label>На странице <select aria-label="Инцидентов на странице" value={pageSize}
        onChange={e => { setPageSize(saveIncidentPageSize(e.target.value)); setPage(1); }}>
        {INCIDENT_PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
      </select></label>
      <div className="pagination">
        <button className="icon-button" aria-label="Предыдущая страница" disabled={result.page <= 1 || waiting}
          onClick={() => setPage(result.page - 1)}><Icon name="left" size={17}/></button>
        <span>{result.page} / {result.totalPages}</span>
        <button className="icon-button" aria-label="Следующая страница" disabled={result.page >= result.totalPages || waiting}
          onClick={() => setPage(result.page + 1)}><Icon name="right" size={17}/></button>
      </div>
    </footer>
  </section>;
}
