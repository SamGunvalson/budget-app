import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { SafeModeProvider } from './contexts/SafeModeContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { MonthYearProvider } from './contexts/MonthYearContext';
import './index.css';
import App from './App.jsx';

// PWA service worker — auto-update in background
import { registerSW } from 'virtual:pwa-register';
registerSW({ immediate: true });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <SafeModeProvider>
        <ThemeProvider>
          <MonthYearProvider>
            <App />
          </MonthYearProvider>
        </ThemeProvider>
      </SafeModeProvider>
    </BrowserRouter>
  </StrictMode>
);
