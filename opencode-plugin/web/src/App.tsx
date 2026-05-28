import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Layout, Menu } from 'antd';
import {
  DashboardOutlined,
  RobotOutlined,
  ThunderboltOutlined,
  CloudServerOutlined,
  ApiOutlined,
  ToolOutlined,
  SafetyOutlined,
  SettingOutlined,
  FileTextOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import AgentsPage from './pages/AgentsPage';
import SkillsPage from './pages/SkillsPage';
import MCPServersPage from './pages/MCPServersPage';
import OHMYEditorPage from './pages/OHMYEditorPage';
import ProvidersPage from './pages/ProvidersPage';
import ToolsPage from './pages/ToolsPage';
import PermissionsPage from './pages/PermissionsPage';
import Dashboard from './pages/Dashboard';
import ConfigRawEditor from './pages/ConfigRawEditor';
import RulesEditor from './pages/RulesEditor';

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: <Link to="/">Dashboard</Link> },
  { key: '/agents', icon: <RobotOutlined />, label: <Link to="/agents">Agents</Link> },
  { key: '/skills', icon: <ThunderboltOutlined />, label: <Link to="/skills">Skills</Link> },
  { key: '/mcp', icon: <CloudServerOutlined />, label: <Link to="/mcp">MCP</Link> },
  { key: '/providers', icon: <ApiOutlined />, label: <Link to="/providers">Providers</Link> },
  { key: '/tools', icon: <ToolOutlined />, label: <Link to="/tools">Tools</Link> },
  { key: '/permissions', icon: <SafetyOutlined />, label: <Link to="/permissions">Permissions</Link> },
  { key: '/config', icon: <SettingOutlined />, label: <Link to="/config">Config</Link> },
  { key: '/rules', icon: <FileTextOutlined />, label: <Link to="/rules">Rules</Link> },
  { key: '/ohmy', icon: <AppstoreOutlined />, label: <Link to="/ohmy">OhMy</Link> },
];

const AppLayout: React.FC = () => {
  const location = useLocation();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible>
        <div style={{ height: 32, margin: 16, background: 'rgba(255, 255, 255, 0.2)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold' }}>
          FinAgent
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
        />
      </Sider>
      <Layout>
        <Header style={{ padding: 0, background: '#fff' }} />
        <Content style={{ margin: '24px 16px', padding: 24, background: '#fff', borderRadius: 8 }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/skills" element={<SkillsPage />} />
            <Route path="/mcp" element={<MCPServersPage />} />
            <Route path="/providers" element={<ProvidersPage />} />
            <Route path="/tools" element={<ToolsPage />} />
            <Route path="/permissions" element={<PermissionsPage />} />
            <Route path="/config" element={<ConfigRawEditor />} />
            <Route path="/rules" element={<RulesEditor />} />
            <Route path="/ohmy" element={<OHMYEditorPage />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
};

const App: React.FC = () => {
  return (
    <Router>
      <AppLayout />
    </Router>
  );
};

export default App;
