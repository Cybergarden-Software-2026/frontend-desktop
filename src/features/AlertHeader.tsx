import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { KeycapPattern } from '../components/Brand';
import type { Incident } from '../domain/incidents';
import { headerAlerts } from '../domain/operations';
import { detailSla } from './detailPresentation';

interface Props {
  items: Incident[];
  now: number;
  status: 'ready' | 'loading' | 'offline';
  onOpen: (id: string) => void;
  onJournal: () => void;
  signalSequence: number;
}

export function AlertHeader({ items, now, status, onOpen, onJournal, signalSequence }: Props) {
  const alerts = useMemo(() => headerAlerts(items, now), [items, now]);
  const deck = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(3);
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const hasAlerts = alerts.length > 0;
  useEffect(() => {
    const element = deck.current;
    if (!element) return;
    const measure = () => setCapacity(Math.max(1, Math.floor((element.clientWidth + 9) / 229)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasAlerts]);

  const pages = Math.max(1, Math.ceil(alerts.length / capacity));
  const activePage = Math.min(page, pages - 1);
  const first = activePage * capacity;
  const visible = alerts.slice(first, first + capacity);
  useEffect(() => {
    if (paused || pages < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setPage(current => (Math.min(current, pages - 1) + 1) % pages);
    }, 10_000);
    return () => clearInterval(timer);
  }, [pages, paused, activePage]);

  const critical = alerts.some(alert => alert.kind === 'critical');
  const title = hasAlerts ? (critical || alerts.some(alert => alert.kind === 'deadline') ? 'Нужна ваша реакция' : 'Подключите команду')
    : status === 'loading' ? 'Подключаемся' : status === 'offline' ? 'Сервер недоступен' : 'Всё под контролем';
  return <header className={`signal-header ${hasAlerts ? critical ? 'has-critical' : 'has-warning' : 'is-quiet'}`} aria-label="Важные инциденты">
    <KeycapPattern />
    <div className="signal-heading">
      <span className="signal-orbit" aria-hidden="true"><span>{critical ? <img src="/design/alert.svg" alt="" /> : <Icon name={hasAlerts ? 'clock' : status === 'ready' ? 'check' : 'signal'} size={21} />}</span><img className="signal-trace" src="/design/pulse.svg" alt="" /></span>
      <div><small>МТС · ЦЕНТР КООРДИНАЦИИ</small><strong>{title}</strong></div>
    </div>
    {hasAlerts ? <div className="signal-deck" ref={deck} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
      <div className="signal-cards">{visible.map(alert => <button className={`signal-card ${alert.tone}`} key={alert.item.sysId} title={`${alert.item.id} · ${alert.item.header}`} onClick={() => onOpen(alert.item.sysId)}>
        <small>{alert.kind === 'waiting' ? 'Ожидает команды' : alert.reason}</small><strong>{alert.item.header || alert.item.id}</strong><b>{detailSla(alert.item, now).value}</b>
      </button>)}</div>
      <div className="signal-paging"><span>{first + 1}–{first + visible.length} из {alerts.length}</span><span className="signal-progress" aria-hidden="true"><i style={{ width: `${100 * visible.length / alerts.length}%` }} /></span>
        <div><button aria-label="Предыдущие предупреждения" disabled={activePage === 0} onClick={() => setPage(activePage - 1)}><img alt="" src="/design/previous.svg" /></button><button aria-label="Следующие предупреждения" disabled={activePage >= pages - 1} onClick={() => setPage(activePage + 1)}><img alt="" src="/design/next.svg" /></button></div>
      </div>
    </div> : <p className="signal-empty">{status === 'ready' ? 'Нет срочных инцидентов' : status === 'loading' ? 'Получаем актуальную очередь' : 'Данные об инцидентах ещё не загружены'}</p>}
    {signalSequence > 0 && <button key={signalSequence} className="signal-bell" title="Открыть журнал событий" aria-label="Новое важное событие. Открыть журнал" onClick={onJournal}><Icon name="bell" /></button>}
  </header>;
}
