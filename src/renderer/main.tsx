import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ConfigProvider, App as AntdApp, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './styles/global.css';

// 防呆：在浏览器里直接访问 http://localhost:5173 时 preload 不会注入 window.api,
// 任何 IPC 调用都会抛 "Cannot read properties of undefined (reading 'invoke')"。
if (typeof window !== 'undefined' && !window.api) {
  // eslint-disable-next-line no-console
  console.error('[SelfDeploy] window.api 未注入：请在 Electron 应用窗口中运行，而不是浏览器标签页。');
  document.body.innerHTML =
    '<div style="padding:32px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#e6e8ef;background:#0b1020;min-height:100vh">' +
    '<h2>请在 Electron 应用窗口中打开</h2>' +
    '<p>当前页面是渲染层的 Vite 开发服务器，<code>window.api</code> 仅在 Electron 主进程通过 preload 注入后才可用。</p>' +
    '<p>请切换到桌面上标题为 <b>SelfDeploy</b> 的应用窗口进行操作；如果该窗口未打开，重新执行 <code>npm run dev</code> 即可。</p>' +
    '</div>';
  throw new Error('window.api missing — open via Electron, not browser.');
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#7c3aed',
          colorInfo: '#06b6d4',
          colorSuccess: '#10b981',
          colorWarning: '#f59e0b',
          colorError: '#f43f5e',
          colorBgBase: '#0b1020',
          colorTextBase: '#e6e8ef',
          borderRadius: 12,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Helvetica Neue", Helvetica, Arial, sans-serif',
        },
        components: {
          Button: { controlHeight: 36, fontWeight: 500 },
          Input: { controlHeight: 38 },
          Select: { controlHeight: 38 },
          InputNumber: { controlHeight: 38 },
          Table: { headerBg: 'transparent', borderColor: 'rgba(255,255,255,0.06)' },
        },
      }}
    >
      <AntdApp>
        <HashRouter>
          <App />
        </HashRouter>
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
);
