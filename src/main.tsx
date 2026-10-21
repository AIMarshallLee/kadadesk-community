import React from 'react';
import { createRoot } from 'react-dom/client';
import WorkspaceApp from './WorkspaceApp';
import './style.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><WorkspaceApp/></React.StrictMode>
);
