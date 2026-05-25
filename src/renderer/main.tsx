import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ConfigProvider, App as AntdApp, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import { ensureRuntimeApi } from './api/runtime-api';
import './styles/global.css';

ensureRuntimeApi();

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
