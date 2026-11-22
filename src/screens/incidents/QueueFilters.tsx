import { useEffect, useRef, useState } from 'react';
import { STATES, type Sla } from '../../domain/incidents';

export interface Filters {
  priority: string;
  status: string;
  sla: Sla | '';
  team: string;
}

export const emptyFilters: Filters = { priority: '', status: '', sla: '', team: '' };

const slaLabels: Record<Sla, string> = {
  late: 'Просрочен',
  soon: 'До дедлайна ≤ 30 мин',
  normal: 'До дедлайна > 30 мин',
  unknown: 'Срок не указан',
  research: 'Исследование',
  restored: 'Устранён',
  closed: 'Закрыт',
};

export function activeFilterLabels(filters: Filters) {
  const { priority, status, sla, team } = filters;
  return [
    priority && 'P' + (5 - Number(priority)),
    status && STATES[status as keyof typeof STATES],
    sla && 'SLA · ' + slaLabels[sla],
    team === '__unassigned__' ? 'Без команды' : team,
  ].filter(Boolean);
}

interface Props {
  value: Filters;
  onChange: (value: Filters) => void;
  teams: string[];
}

export function QueueFilters({ value, onChange, teams }: Props) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstSelect = useRef<HTMLSelectElement>(null);
  const count = activeFilterLabels(value).length;

  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!open) return;
    firstSelect.current?.focus({ preventScroll: true });
    function outside(event: PointerEvent) {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') close();
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return <div className="queue-filter-anchor" ref={anchor}
    onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button className={`queue-filter-button ${count ? 'active' : ''}`} aria-label={count ? `Фильтры: ${count}` : 'Фильтры'}
      ref={trigger} aria-expanded={open} aria-controls="queue-filter-panel" onClick={() => setOpen(!open)}>
      <img src="./design/filters.svg" alt="" width="17" height="17"/>{count > 0 && <b>{count}</b>}
    </button>
    {open && <div className="queue-filter-panel" id="queue-filter-panel" role="region" aria-label="Фильтры очереди">
      <header><strong>Фильтры</strong><button className="text-button" onClick={() => onChange(emptyFilters)}>Сбросить</button></header>
      <label className="field"><span>Приоритет</span><select ref={firstSelect} aria-label="Фильтр по приоритету"
        value={value.priority} onChange={e => onChange({ ...value, priority: e.target.value })}>
        <option value="">Все приоритеты</option><option value="4">P1 · Критический</option>
        <option value="3">P2 · Высокий</option><option value="2">P3 · Средний</option><option value="1">P4 · Низкий</option>
      </select></label>
      <label className="field"><span>Статус</span><select aria-label="Фильтр по статусу" value={value.status}
        onChange={e => onChange({ ...value, status: e.target.value })}>
        <option value="">Все статусы</option>
        {Object.entries(STATES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      <label className="field"><span>SLA</span><select aria-label="Фильтр по SLA" value={value.sla}
        onChange={e => onChange({ ...value, sla: e.target.value as Filters['sla'] })}>
        <option value="">Любой срок</option>
        {Object.entries(slaLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      <label className="field"><span>Команда</span><select aria-label="Фильтр по команде" value={value.team}
        onChange={e => onChange({ ...value, team: e.target.value })}>
        <option value="">Все команды</option><option value="__unassigned__">Без команды</option>
        {teams.map(name => <option key={name}>{name}</option>)}
      </select></label>
      <button className="button primary" onClick={close}>Готово</button>
    </div>}
  </div>;
}
