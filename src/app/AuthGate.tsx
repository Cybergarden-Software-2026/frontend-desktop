import { useCallback, useEffect, useState } from 'react';
import { ApiError, coordinatorSession, onUnauthorized, signInCoordinator, signOutCoordinator, type CoordinatorSession, type Credentials } from '../data/api';
import { ConnectionPage } from '../features/ConnectionPage';
import { LoginPage } from '../features/LoginPage';
import { App } from './App';
import { readLocal, saveLocal } from './connection';

const TIMEOUT = 10_000;

function forgetOpenWorkspace(origin: string) {
  try {
    localStorage.removeItem(`underctrl.desktop.open.${origin}`);
    localStorage.removeItem(`underctrl.desktop.snapshot.v1.${origin}`);
  } catch { /* Storage is optional. */ }
}

export function AuthGate({ origin }: { origin: string }) {
  const [session, setSession] = useState<CoordinatorSession | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [expired, setExpired] = useState(false);
  const [settings, setSettings] = useState(false);
  const [offlineAccess, setOfflineAccess] = useState(false);
  const hasAccess = !!session && (!session.required || session.authenticated);
  const checkConnection = useCallback(() => setAttempt(current => current + 1), []);

  function retry() {
    setOfflineAccess(false);
    setFailed(false);
    setSession(null);
    checkConnection();
  }

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT);
    let active = true;
    void coordinatorSession(controller.signal).then(next => {
      if (!active) return;
      if (next.required) forgetOpenWorkspace(origin);
      else saveLocal(`underctrl.desktop.open.${origin}`, 'true');
      setOfflineAccess(false);
      setFailed(false);
      setSession(next);
    }).catch(error => {
      if (!active) return;
      if (error instanceof ApiError && error.status === 401) forgetOpenWorkspace(origin);
      const unavailable = controller.signal.aborted || error instanceof TypeError || (error instanceof ApiError && error.status === 502);
      if (unavailable && readLocal(`underctrl.desktop.open.${origin}`) === 'true') {
        setOfflineAccess(true);
        setSession({ required: false, authenticated: false, mode: 'none' });
      } else {
        setOfflineAccess(false);
        setSession(null);
        setFailed(true);
      }
    }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [origin, attempt]);

  useEffect(() => {
    if (!offlineAccess) return;
    const interval = setInterval(checkConnection, 15_000);
    window.addEventListener('online', checkConnection);
    return () => { clearInterval(interval); window.removeEventListener('online', checkConnection); };
  }, [offlineAccess, checkConnection]);

  useEffect(() => {
    if (!hasAccess) return;
    return onUnauthorized(() => {
      forgetOpenWorkspace(origin);
      history.replaceState(null, '', '#incidents');
      setExpired(true);
      retry();
    });
  }, [hasAccess, origin]);

  async function signIn(credentials: Credentials) {
    const next = await signInCoordinator(credentials, AbortSignal.timeout(TIMEOUT));
    setExpired(false);
    setSession(next);
  }

  async function signOut() {
    await signOutCoordinator(AbortSignal.timeout(TIMEOUT));
    history.replaceState(null, '', '#incidents');
    setExpired(false);
    retry();
  }

  if (settings) return <ConnectionPage origin={origin} name={readLocal('underctrl.profile')}
    onBack={() => setSettings(false)} onConnect={(address, name) => {
      saveLocal('underctrl.profile', name);
      if (address !== origin) { location.reload(); return; }
      setSettings(false);
      retry();
    }} />;

  if (session && hasAccess) return <App key={session.required ? 'protected:' + (session.coordinator?.login ?? '') : 'open'}
    origin={origin} session={session} offlineOnly={offlineAccess} onRetryConnection={checkConnection}
    onSignOut={session.required ? signOut : undefined} />;

  return <LoginPage origin={origin} accounts={session?.mode === 'accounts'} expired={expired}
    check={session ? 'ready' : failed ? 'failed' : 'checking'}
    onLogin={signIn} onRetry={retry} onSettings={() => setSettings(true)} />;
}
