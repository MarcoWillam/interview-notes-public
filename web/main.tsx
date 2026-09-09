import React from 'react';
import { createRoot } from 'react-dom/client';
import '../app/globals.css';
import { RemoteWorkspace } from '../components/interview/remote-workspace';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RemoteWorkspace />
  </React.StrictMode>,
);
