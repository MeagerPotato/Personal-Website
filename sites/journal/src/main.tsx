/**
 * journal.allenkh.com: the app. Styles first (tokens, base, prose, editor, the shared app frame,
 * the journal's own), then the gate (app/App.tsx) decides between setting up, the lock screen
 * and the journal.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'virtual:allenkh/tokens.css';
import '@allenkh/design/styles/base.css';
import '@allenkh/design/styles/prose.css';
import '@allenkh/editor/styles/editor.css';
import '@allenkh/design/styles/app.css';
import './styles/app.css';
import { App } from './app/App';
import { applyTheme, readTheme } from './app/theme';
import { registerServiceWorker } from './pwa';

applyTheme(readTheme());

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

registerServiceWorker();
