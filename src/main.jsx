import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { MonthYearProvider } from './contexts/MonthYearContext';
import { queryClient } from './services/queryClient';
import { initQueryBridge } from './services/queryBridge';
import '@fontsource-variable/newsreader/wght.css';
import './index.css';
import App from './App.jsx';
import { initLayoutMode } from './utils/layoutMode';

// PWA service worker — auto-update in background
import { registerSW } from 'virtual:pwa-register';
registerSW({ immediate: true });

// Wire cache.js → react-query invalidations once at module load. Idempotent.
initQueryBridge();

// Sets <html data-layout> before first paint for the mobile:/desktop: variants.
initLayoutMode();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <MonthYearProvider>
          <App />
        </MonthYearProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
