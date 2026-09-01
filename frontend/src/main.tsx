import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import './lib/i18n'; // initialise i18next avant le premier rendu (voir hooks/useLanguage.ts)

const container = document.getElementById('root');
if (!container) throw new Error("Élément #root introuvable dans index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
