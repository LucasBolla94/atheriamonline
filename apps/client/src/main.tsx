import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens/tokens.css';
import './ui/app.css';
import { LandingPage } from './ui/LandingPage.js';

// Preserve already-issued recovery links after separating the public site.
if (new URLSearchParams(window.location.search).has('reset')) {
  window.location.replace(`/play/${window.location.search}`);
} else {
  const container = document.getElementById('root');
  if (container === null) throw new Error('Missing application root.');
  createRoot(container).render(
    <StrictMode>
      <LandingPage />
    </StrictMode>,
  );
}
