import '@seams/wallet/react/styles';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SeamsWebProvider } from '@seams/wallet/react';
import { App } from './App';
import { buildSeamsConfig } from './seams/seamsConfig';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root element.');

const seamsConfig = buildSeamsConfig();

createRoot(root).render(
  <StrictMode>
    <SeamsWebProvider config={seamsConfig} theme={{ theme: 'light' }}>
      <App />
    </SeamsWebProvider>
  </StrictMode>,
);
