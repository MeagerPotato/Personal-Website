/**
 * The studio's entry (pages/studio/[...path].astro loads it, with the stylesheets): the gate
 * (App.tsx) decides between setting up, signing in and the studio.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = document.getElementById('studio');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
