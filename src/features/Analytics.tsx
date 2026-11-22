import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { api } from '../data/api';
import { useEventHistory } from '../data/useEventHistory';
import type { Snapshot } from '../domain/incidents';
import { personalChartData } from '../domain/personalCharts';
import type { PersonalStatistics } from '../domain/personalStatistics';
import { buildShiftStatistics, durationLabel, moscowInput, parseMoscowInput } from '../domain/shiftStatistics';
import { downloadShiftReport } from '../reports/downloadShiftReport';
import { PersonalCharts } from './PersonalCharts';

const NO_EVENTS: Snapshot['events'] = [];
const MINUTE = 60_000;
const SHIFT_LENGTH = 12 * 60 * MINUTE;
const PAGE_SIZE = 8;
const assignmentTime = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
});

type Period = { start: string; end: string };
type Format = 'pdf' | 'xlsx';

interface Props {
  snapshot: Snapshot | null;
  now: number;
  connected: boolean;
  loading: boolean;
  historyEpoch: number;
}

export function Analytics({ snapshot, now, connected, loading, historyEpoch }: Props) {
  const minute = Math.floor(now / MINUTE) * MINUTE;
  const [openedAt] = useState(minute);
  const [fixed, setFixed] = useState<Period | null>(null);
  const [draft, setDraft] = useState<Period | null>(null);
  const [validation, setValidation] = useState('');
  const [exporting, setExporting] = useState<Format | null>(null);
  const [exportError, setExportError] = useState('');
  const [attempt, setAttempt] = useState(0);

  // The API's upper bound is exclusive. Live mode includes the current minute.
  const period = fixed ?? { start: moscowInput(Math.min(openedAt, minute) - SHIFT_LENGTH), end: moscowInput(minute + MINUTE) };
  const fields = draft ?? period;
  const start = parseMoscowInput(period.start)!;
  const end = parseMoscowInput(period.end)!;
  const dirty = fields.start !== period.start || fields.end !== period.end;
  const scope = JSON.stringify([historyEpoch, start, fixed ? end : 'live']);

  const [result, setResult] = useState<{ scope: string; stats: PersonalStatistics } | null>(null);
  const [shiftError, setShiftError] = useState('');
  const [pending, setPending] = useState(false);
  const stats = result?.scope === scope ? result.stats : null;
  const chartData = useMemo(() => stats && personalChartData(stats), [stats]);

  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    setPending(true);
    setShiftError('');
    api.shiftStatistics(start, end, controller.signal).then(stats => {
      if (!controller.signal.aborted) setResult({ scope, stats });
    }).catch(error => {
      if (!controller.signal.aborted) setShiftError(error instanceof Error ? error.message : 'Не удалось загрузить статистику смены.');
    }).finally(() => {
      if (!controller.signal.aborted) setPending(false);
    });
    return () => controller.abort();
  }, [start, end, scope, connected, snapshot?.revision, attempt]);

  const liveEvents = snapshot?.events ?? NO_EVENTS;
  const history = useEventHistory({ period: 'all', connected, now, since: start, events: liveEvents, historyEpoch });
  // Only repeat the historical queue reconstruction on a new snapshot, archive
  // page or minute. A clock correction can move a manually chosen start ahead.
  const snapshotTime = Date.parse(snapshot?.serverTime ?? '') || 0;
  const asOf = Math.min(now, Math.max(start + 1, minute, snapshotTime + 1));
  const general = useMemo(() => start < asOf
    ? buildShiftStatistics(snapshot?.items ?? [], [...history.archive, ...liveEvents], start, end, asOf)
    : null, [snapshot?.items, history.archive, liveEvents, start, end, asOf]);
  const pendingHistory = connected && (history.loading || !history.settled && !history.failed);
  const generalAvailable = Boolean(snapshot && general && !pendingHistory);
  const canExport = Boolean(stats && general && !exporting && !dirty && !pending && !shiftError && connected);

  function applyPeriod() {
    const from = parseMoscowInput(fields.start);
    const to = parseMoscowInput(fields.end);
    if (from === null || to === null || from >= to || from >= now) {
      setValidation('Начало должно быть раньше конца и текущего времени.');
      return;
    }
    setFixed(fields);
    setDraft(null);
    setValidation('');
    setExportError('');
    setAttempt(previous => previous + 1);
  }

  function resetPeriod() {
    setDraft(null);
    setFixed(null);
    setValidation('');
    setExportError('');
  }

  async function download(format: Format) {
    if (!canExport || !stats || !general) return;
    setExporting(format);
    setExportError('');
    try {
      await downloadShiftReport(format, { ...general, generatedAt: now }, {
        revision: snapshot?.revision ?? 0, connected, historyIncomplete: history.failed || !history.settled,
        updatedAt: snapshot?.updatedAt ?? '', sourceStale: Boolean(snapshot?.source.error), personal: stats, generalAvailable,
      });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Не удалось подготовить отчёт. Повторите скачивание.');
    } finally {
      setExporting(null);
    }
  }

  const queueRows = [
    ['Ожидают распределения', general?.coordinator.atEnd],
    ['Критических без команды', general?.coordinator.critical],
    ['Ждут больше 8 минут', general?.waitingOver8],
  ] as const;

  return <section className="shift-statistics" aria-labelledby="shift-title">
    <header className="surface shift-controls">
      <h1 id="shift-title">Статистика смены</h1>
      <form className="shift-range" onSubmit={event => { event.preventDefault(); applyPeriod(); }}>
        <label>Начало периода<input type="datetime-local" value={fields.start} required onChange={event => setDraft({ ...fields, start: event.target.value })}/></label>
        <label>Конец периода<input type="datetime-local" value={fields.end} required onChange={event => setDraft({ ...fields, end: event.target.value })}/></label>
        <button className="button secondary" type="submit">Рассчитать</button>
      </form>
      <div className="shift-export" aria-label="Скачать отчёт">
        <span>Скачать отчёт</span>
        {(['pdf', 'xlsx'] as const).map(format => <button className="button secondary" key={format} disabled={!canExport} onClick={() => void download(format)}>
          <Icon name="spark" size={16}/>{exporting === format ? 'Готовим…' : format === 'pdf' ? 'PDF' : 'EXCEL'}
        </button>)}
      </div>
    </header>

    <div className="shift-status">
      {validation && <p role="alert" className="shift-error">{validation}</p>}
      {exportError && <p role="alert" className="shift-error">{exportError}</p>}
      {connected && shiftError && <p role="alert" className="shift-error">Не удалось обновить статистику смены. {shiftError} <button className="text-button" onClick={() => setAttempt(previous => previous + 1)}>Повторить</button></p>}
      {!connected ? <p role="status">{loading ? 'Загружаем данные смены…' : stats ? 'Нет соединения. Показана последняя полученная статистика.' : 'Статистика смены недоступна без соединения с сервером.'}</p>
        : pending && !stats ? <p role="status">Загружаем статистику смены…</p>
        : dirty ? <p>Нажмите «Рассчитать», чтобы применить новый период.</p>
        : <p>{fixed ? 'Выбранный период' : 'По текущую минуту'} · МСК</p>}
      {(fixed || draft) && <button className="text-button" onClick={resetPeriod}>Вернуться к текущей смене</button>}
    </div>

    {stats && chartData && <PersonalCharts stats={stats} data={chartData} view="coordination"/>}
    <div className="shift-personal-layout">
      <TransferTable key={scope} stats={stats} loading={connected && pending || loading && !snapshot}/>
      <aside className="surface shift-panel shift-general" aria-labelledby="general-title">
        <h2 id="general-title">Общая очередь</h2><p>На конец выбранного периода</p>
        <dl>{queueRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{generalAvailable ? value : '—'}</dd></div>)}</dl>
        <p className="shift-general-status" role="status">{pendingHistory || loading && !snapshot
          ? 'Загружаем общие данные…'
          : !snapshot ? 'Общие данные пока не загружены.'
          : history.failed ? <>История неполная. <button className="text-button" disabled={!connected} onClick={history.retry}>Повторить</button></>
          : !connected ? 'Последние данные могли устареть.' : 'По снимку и доступной истории'}</p>
      </aside>
    </div>
    {stats && chartData && <>
      <dl className="shift-metrics" aria-label="Показатели смены">
        <div><dt>Распределено</dt><dd>{stats.transferred}</dd></div>
        <div><dt>Среднее время</dt><dd>{durationLabel(stats.averageMs)}</dd></div>
        <div><dt>KPI &lt; 10 минут</dt><dd>{stats.kpiPercent === null ? '—' : stats.kpiPercent.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%'}</dd></div>
        <div><dt>Критических распределено</dt><dd>{stats.critical}</dd></div>
      </dl>
      <PersonalCharts stats={stats} data={chartData} view="reassignments"/>
    </>}
  </section>;
}

function TransferTable({ stats, loading }: { stats: PersonalStatistics | null; loading: boolean }) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  return <section className="surface shift-panel shift-transfers" aria-labelledby="transfers-title">
    <h2 id="transfers-title">Распределения смены</h2>
    {stats?.transfers.length ? <>
      <div className="shift-table-scroll"><table>
        <thead><tr><th>Инцидент</th><th>Команда решения</th><th>Время</th><th>KPI &lt; 10 мин</th></tr></thead>
        <tbody>{stats.transfers.slice(0, limit).map(row => <tr key={row.id}>
          <td><strong>{row.incidentId}</strong><span>{row.title}</span><time dateTime={new Date(row.assignedAt).toISOString()}>{assignmentTime.format(row.assignedAt)} МСК</time></td>
          <td>{row.team}</td><td className="shift-duration">{durationLabel(row.durationMs)}</td>
          <td><span className={`shift-kpi-result ${row.kpiMet === true ? 'is-met' : row.kpiMet === false ? 'is-missed' : 'is-unknown'}`}>{row.kpiMet === null ? 'Нет данных' : row.kpiMet ? 'Выполнен' : 'Не выполнен'}</span></td>
        </tr>)}</tbody>
      </table></div>
      {stats.transfers.length > limit && <button className="text-button" onClick={() => setLimit(current => current + PAGE_SIZE)}>Показать ещё · {stats.transfers.length - limit}</button>}
    </> : <div className="shift-empty" role="status"><Icon name={loading ? 'refresh' : 'inbox'} size={27}/>
      <strong>{loading ? 'Загружаем распределения…' : stats ? 'Нет распределений за период' : 'Распределения ещё не загружены'}</strong>
      {stats && <p>Выберите другой период.</p>}
    </div>}
  </section>;
}
