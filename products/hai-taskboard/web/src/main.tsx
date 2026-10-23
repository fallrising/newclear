import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConnectedApp } from './connected/app';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConnectedApp />
  </StrictMode>,
);
