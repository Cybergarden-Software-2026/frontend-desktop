import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { Dialog, Team } from '../components/ui';
import { api, ApiError } from '../data/api';
import type { Analysis, Incident, Snapshot } from '../domain/incidents';
import { canAssign } from '../domain/operations';

interface Props {
  item: Incident;
  snapshot: Snapshot;
  onClose: () => void;
  onAccept: (snapshot: Snapshot) => void;
  note?: string;
}

export function AssignTeam({ item, snapshot, onClose, onAccept, note }: Props) {
  const [teams, setTeams] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<{ team: string; previous: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState(false);
  const [directoryAttempt, setDirectoryAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const { sysId, assignedGroupName } = item;
  const revision = snapshot.revision;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setDirectoryError(false);
    api.teams().then(directory => {
      if (active) setTeams(directory.items.map(({ name }) => name).sort((a, b) => a.localeCompare(b, 'ru')));
    }).catch(() => {
      if (!active) return;
      setTeams([]);
      setDirectoryError(true);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sysId, directoryAttempt]);

  useEffect(() => {
    let active = true;
    api.analysis(sysId).then(value => {
      if (active) setAnalysis(value.revision === revision ? value : null);
    }).catch(() => { if (active) setAnalysis(null); });
    return () => { active = false; };
  }, [sysId, revision]);

  const candidate = analysis?.revision === revision
    ? analysis.candidates.find(row => teams.includes(row.team) && row.evidenceIds.length > 0) : undefined;
  const currentSelection = selected?.previous === assignedGroupName ? selected.team : '';
  const wasChanged = selected !== null && selected.previous !== assignedGroupName;
  const value = selected || review ? currentSelection : candidate?.team ?? '';
  const needle = query.trim().toLocaleLowerCase('ru');
  const filtered = teams.filter(name => name.toLocaleLowerCase('ru').includes(needle));
  const ordered = candidate && filtered.includes(candidate.team)
    ? [candidate.team, ...filtered.filter(name => name !== candidate.team)] : filtered;
  const allowed = canAssign(item);
  const saveEnabled = allowed && !loading && !saving && !refreshRequired
    && teams.includes(value) && value !== assignedGroupName;

  async function reloadAfterConflict() {
    try {
      const latest = await api.snapshot();
      onAccept(latest);
      setRefreshRequired(false);
    } catch {
      setRefreshRequired(true);
      setError('Не удалось получить актуальную команду. Обновите данные перед назначением.');
    }
  }

  async function save() {
    if (pending.current || !saveEnabled) return;
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      const updated = await api.assign(sysId, value, revision);
      onAccept(updated);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось назначить команду.');
      if (reason instanceof ApiError && reason.status === 409) {
        setReview(true);
        setSelected(null);
        await reloadAfterConflict();
      }
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  const footer = <footer className="assignment-footer">
    <button className="button secondary" disabled={saving} onClick={onClose}>Отмена</button>
    <button className="button primary" disabled={!saveEnabled} onClick={() => void save()}>
      {saving ? 'Сохраняем…' : 'Сохранить'}
    </button>
  </footer>;

  return <Dialog title={`Назначить команду · ${item.id}`} className="assignment-dialog" footer={footer}
    onClose={() => { if (!pending.current) onClose(); }}>
    <div className="assignment-intro">
      <h3>{item.header}</h3><p>Выберите команду, которая продолжит работу с инцидентом.</p>
      <p className="assignment-current-team">Текущая команда · <strong>{assignedGroupName || 'Не назначена'}</strong></p>
      {note && <p className="assignment-context-note">{note}</p>}
    </div>
    <label className="search-field assignment-search"><Icon name="search" size={17}/>
      <input aria-label="Найти команду для назначения" placeholder="Найти команду" value={query}
        onChange={event => setQuery(event.target.value)}/>
    </label>
    {loading ? <p className="loading-text" role="status">Загружаем команды…</p>
      : directoryError ? <p className="form-error" role="alert">Не удалось загрузить справочник команд.
        <button className="text-button" onClick={() => setDirectoryAttempt(n => n + 1)}>Повторить</button></p>
      : <>
        {!candidate && <p className="assignment-note">Рекомендации нет: недостаточно подтверждённых похожих случаев. Выберите команду самостоятельно.</p>}
        {wasChanged && <p className="assignment-note" role="status">Текущая команда изменилась. Проверьте назначение и выберите команду ещё раз.</p>}
        <div className="assignment-options" role="radiogroup" aria-label="Команда для назначения">
          {ordered.map(name => <label className={`assignment-option ${value === name ? 'selected' : ''}`} key={name}>
            <input type="radio" name="assignment" checked={value === name} disabled={saving || !allowed || refreshRequired}
              onChange={() => { setSelected({ team: name, previous: assignedGroupName }); setError(''); }}/>
            <span><Team name={name}/>{name === candidate?.team && <>
              <span className="recommendation-label"><Icon name="spark" size={14}/>Рекомендация · {analysis?.provider === 'llm' ? 'ИИ' : 'по правилам'}</span>
              <small>{candidate.reason}</small><small>Похожие случаи: {candidate.evidenceIds.join(', ')}</small>
            </>}</span>
          </label>)}
          {!ordered.length && <p className="assignment-note">Команды не найдены.</p>}
        </div>
      </>}
    {!allowed && <p className="form-error" role="status">Нельзя назначить завершённый или закрытый инцидент.</p>}
    {error && <p className="form-error" role="alert">{error}{refreshRequired &&
      <button className="text-button" onClick={() => void reloadAfterConflict()}>Обновить данные</button>}</p>}
  </Dialog>;
}
