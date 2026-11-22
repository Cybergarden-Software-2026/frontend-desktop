import { useState, type FormEvent } from 'react';
import { Brand, KeycapPattern } from '../components/Brand';
import { normalizedOrigin } from '../app/connection';
import { api } from '../data/api';

interface Props {
  origin: string;
  name: string;
  onBack: () => void;
  onConnect: (origin: string, name: string) => void;
}

export function ConnectionPage({ origin, name, onBack, onConnect }: Props) {
  const [address, setAddress] = useState(origin);
  const [displayName, setDisplayName] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function connect(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    let nextOrigin: string;
    try { nextOrigin = normalizedOrigin(address); } catch { setError('Укажите адрес HTTP(S) без пути, логина и пароля.'); return; }
    setBusy(true);
    try {
      if (window.underCtrl) await window.underCtrl.setConnection(nextOrigin);
      else await api.snapshot(AbortSignal.timeout(10_000));
      onConnect(nextOrigin, displayName.trim());
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '';
      setError(`Не удалось подключиться к серверу. ${detail}`);
    } finally { setBusy(false); }
  }
  return <main className="connection-page"><section className="connection-panel" aria-labelledby="connection-title">
    <div className="connection-art"><KeycapPattern /><Brand /><h2>Приближая<br />будущее</h2><div className="connection-orbit" aria-hidden="true"><span><img src="/design/globe.png" alt="" width="64" height="64" /></span><i><img src="/design/spark.svg" alt="" /></i></div></div>
    <form className="connection-form" onSubmit={connect}>
      <button type="button" className="connection-back" onClick={onBack} disabled={busy}>← К рабочей области</button>
      <h1 id="connection-title">Подключение</h1><p>Выберите сервер для рабочей смены.</p>
      <label>Адрес сервера<input name="server" type="url" autoComplete="off" spellCheck={false} required value={address} readOnly={!window.underCtrl} onChange={event => setAddress(event.target.value)} /></label>
      <label>Имя в приложении<input name="profile" placeholder="Дежурная смена" maxLength={64} value={displayName} onChange={event => setDisplayName(event.target.value)} /></label>
      {error && <p role="alert" className="form-error">{error}</p>}
      <button type="submit" className="connection-submit" disabled={busy}>{busy ? 'Проверяем соединение…' : 'Подключиться'}</button>
    </form>
  </section></main>;
}
