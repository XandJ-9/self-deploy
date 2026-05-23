import { CloudServerOutlined, FolderOpenOutlined, RocketOutlined, HistoryOutlined } from '@ant-design/icons';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import ServersPage from './pages/ServersPage';
import ProjectsPage from './pages/ProjectsPage';
import DeployPage from './pages/DeployPage';
import HistoryPage from './pages/HistoryPage';

const navItems = [
  { key: '/servers', icon: <CloudServerOutlined />, label: '服务器' },
  { key: '/projects', icon: <FolderOpenOutlined />, label: '项目' },
  { key: '/deploy', icon: <RocketOutlined />, label: '部署' },
  { key: '/history', icon: <HistoryOutlined />, label: '历史' },
];

export default function App() {
  const { pathname } = useLocation();
  const activeKey = navItems.find((i) => pathname.startsWith(i.key))?.key ?? '/servers';

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="brand">
          <div className="brand-logo">S</div>
          <div>
            <div className="brand-name">SelfDeploy</div>
            <div className="brand-sub">本地 → 服务器</div>
          </div>
        </div>
        {navItems.map((item) => (
          <Link
            key={item.key}
            to={item.key}
            className={`nav-item ${activeKey === item.key ? 'active' : ''}`}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        ))}
        <div className="sidebar-footer">v0.1.0 · MIT</div>
      </aside>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to="/servers" replace />} />
          <Route path="/servers" element={<ServersPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/deploy" element={<DeployPage />} />
          <Route path="/history" element={<HistoryPage />} />
        </Routes>
      </main>
    </div>
  );
}
