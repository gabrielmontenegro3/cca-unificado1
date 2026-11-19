import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { SessionProvider } from './lib/session';
import { AvisoRelogio } from './components/AvisoRelogio';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
        <AvisoRelogio />
      </SessionProvider>
    </BrowserRouter>
  </React.StrictMode>
);
