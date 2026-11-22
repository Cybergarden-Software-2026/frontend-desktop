import { useState, type FormEvent } from 'react';
import { ApiError, type Credentials } from '../data/api';
import { ConnectionPanel } from './ConnectionPage';

interface Props {
  origin: string;
  accounts: boolean;
  check: 'checking' | 'failed' | 'ready';
  expired: boolean;
  onSettings: () => void;
  onRetry: () => void;
  onLogin: (credentials: Credentials) => Promise<void>;
}

export function LoginPage({ origin, accounts, check, expired, onSettings, onRetry, onLogin }: Props) {
  const [useKey, setUseKey] = useState(false);
  const [login, setLogin] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const passwordLogin = accounts && !useKey;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || check !== 'ready') return;
    setBusy(true);
    setError('');
    try {
      await onLogin(passwordLogin ? { login: login.trim(), password: secret } : { key: secret.trim() });
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 401
        ? 'Неверные данные для входа.'
        : 'Не удалось войти. Проверьте подключение и повторите.');
    } finally { setBusy(false); }
  }

  return <ConnectionPanel titleId="login-title">
    <form className="connection-form" onSubmit={submit} aria-busy={busy || check === 'checking'}>
      <button type="button" className="connection-back" disabled={busy} onClick={onSettings}>Профиль и подключение</button>
      <h1 id="login-title">Вход координатора</h1>
      <p>{origin}</p>
      {check === 'checking' && <p role="status">Проверяем сессию…</p>}
      {check === 'failed' && <>
        <p role="alert" className="form-error">Не удалось проверить сессию на сервере.</p>
        <button type="button" className="connection-submit" onClick={onRetry}>Повторить</button>
      </>}
      {check === 'ready' && <>
        {expired && <p role="status">Сессия завершилась. Войдите снова.</p>}
        {passwordLogin && <label>Логин<input name="username" autoComplete="username" value={login}
          spellCheck={false} required disabled={busy} onChange={event => setLogin(event.target.value)} /></label>}
        <label>{passwordLogin ? 'Пароль' : 'Ключ доступа'}<input type="password"
          name={passwordLogin ? 'password' : 'key'} autoComplete={passwordLogin ? 'current-password' : 'off'}
          value={secret} required disabled={busy} onChange={event => setSecret(event.target.value)} /></label>
        {error && <p role="alert" className="form-error">{error}</p>}
        <button type="submit" className="connection-submit" disabled={busy || !secret || (passwordLogin && !login.trim())}>{busy ? 'Входим…' : 'Войти'}</button>
        {accounts && <button type="button" className="text-button session-action" disabled={busy} onClick={() => {
          setUseKey(!useKey); setSecret(''); setError('');
        }}>{passwordLogin ? 'Войти по ключу доступа' : 'Войти по логину и паролю'}</button>}
      </>}
    </form>
  </ConnectionPanel>;
}
