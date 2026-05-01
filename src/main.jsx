import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeModeProvider } from './contexts/SafeModeContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { MonthYearProvider } from './contexts/MonthYearContext';
import { queryClient } from './services/queryClient';
import { initQueryBridge } from './services/queryBridge';
import './index.css';
import App from './App.jsx';

// PWA service worker — auto-update in background
import { registerSW } from 'virtual:pwa-register';
registerSW({ immediate: true });

// Wire cache.js → react-query invalidations once at module load. Idempotent.
initQueryBridge();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SafeModeProvider>
          <ThemeProvider>
            <MonthYearProvider>
              <App />
            </MonthYearProvider>
          </ThemeProvider>
        </SafeModeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
