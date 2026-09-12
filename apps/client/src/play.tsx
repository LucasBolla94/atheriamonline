import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens/tokens.css';
import './ui/app.css';
import { App } from './ui/App.js';

const container = document.getElementById('root');
if (container === null) throw new Error('Missing game root.');
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
