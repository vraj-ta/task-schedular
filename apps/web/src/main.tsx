import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App.js';
import { AuthProvider } from './auth/AuthContext.js';
import { ToastProvider } from './components/toast.js';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
