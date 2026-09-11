/**
 * The entry point. It mounts React and nothing else.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens/tokens.css';
import './ui/app.css';
import { App } from './ui/App.js';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html is missing the #root element the app mounts into.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
