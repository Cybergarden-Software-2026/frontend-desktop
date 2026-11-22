import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './reference.css';
import './analytics.css';
import './styles.css';
import './dashboard.css';

import './detail-page.css';
import './events-journal.css';
import './shift-statistics.css';
import './teams-directory.css';
import './mass-problems.css';
import './fonts.css';
import './screens/incidents/incidents.css';
import './desktop.css';
import { defaultOrigin } from './app/connection';

const root = createRoot(document.getElementById('root')!);
async function start() {
  const { origin } = window.underCtrl ? await window.underCtrl.getConnection() : { origin: defaultOrigin };
  root.render(<React.StrictMode><App origin={origin} /></React.StrictMode>);
}
void start().catch(() => root.render(<main className="startup-error"><h1>Не удалось открыть рабочую область</h1><button className="button secondary" onClick={() => location.reload()}>Повторить</button></main>));
