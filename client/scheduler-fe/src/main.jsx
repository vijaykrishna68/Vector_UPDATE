import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted (not Google Fonts CDN): the server's CSP is font-src 'self',
// so these ship as same-origin static files rather than a blocked cross-origin request.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './index.css';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

// main.jsx mounts; App.jsx owns routing, the active run, and the view shell.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
