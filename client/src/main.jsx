import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { StoreProvider } from './store.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './styles.css';

// مرزِ خطا بیرونی‌ترین لایه است تا هیچ خطای رندری به «صفحهٔ سفید» ختم نشود
createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <StoreProvider>
      <App />
    </StoreProvider>
  </ErrorBoundary>
);
