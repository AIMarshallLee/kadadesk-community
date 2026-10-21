import React from 'react';
import { createRoot } from 'react-dom/client';
import MomentsCenter from './MomentsCenter';
import './style.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><main className="site"><nav className="site-nav"><strong>咔哒 KADAdesk</strong><span>社区源码版 · 本地多账号朋友圈助手</span></nav><MomentsCenter/><footer>本地运行 · 人工发布 · 不连接微信私有协议 · <a href="https://github.com/AIMarshallLee/kadadesk-community" target="_blank" rel="noreferrer">GitHub 社区</a></footer></main></React.StrictMode>
);
