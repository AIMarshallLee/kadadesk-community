import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/noto-sans-sc';
import App from './App';
import Floater from './Floater';
import Notice from './Notice';
import { applyTheme, savedTheme } from './theme';
import './styles.css';
import './topbar.css';

// The floating capsule window loads the same page at #floater and renders only the capsule.
const floaterView = window.location.hash === '#floater';
// The reminder card window loads the same page at #notice.
const noticeView = window.location.hash === '#notice';
// The saved theme is applied before the first paint.
if (!floaterView) applyTheme(savedTheme());
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{floaterView ? <Floater /> : noticeView ? <Notice /> : <App />}</React.StrictMode>);
