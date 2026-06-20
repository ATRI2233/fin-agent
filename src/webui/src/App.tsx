import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Layout, Menu, ConfigProvider, theme, Tooltip, Spin } from 'antd';
import type { MenuProps } from 'antd';
import { useUiStore } from './store/useUiStore';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
  BranchesOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SendOutlined,
  DatabaseOutlined,
  FolderOutlined,
} from '@ant-design/icons';
import './styles/theme.css';

/* ─── Lazy-loaded page chunks ───────────────────────────────────────── */
const FrameworkPage = React.lazy(() => import('./pages/FrameworkPage'));
const AgentsPage = React.lazy(() => import('./pages/AgentsPage'));
const SkillsPage = React.lazy(() => import('./pages/SkillsPage'));
const MCPServersPage = React.lazy(() => import('./pages/MCPServersPage'));
const ProvidersPage = React.lazy(() => import('./pages/ProvidersPage'));
const ToolsPage = React.lazy(() => import('./pages/ToolsPage'));
const PermissionsPage = React.lazy(() => import('./pages/PermissionsPage'));
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const ConfigRawEditor = React.lazy(() => import('./pages/ConfigRawEditor'));
const RulesEditor = React.lazy(() => import('./pages/RulesEditor'));
const WorkflowList = React.lazy(() => import('./pages/WorkflowList'));
const WorkflowEditor = React.lazy(() => import('./pages/WorkflowEditor'));
const WorkflowSettings = React.lazy(() => import('./pages/WorkflowSettings'));
const WorkflowMonitor = React.lazy(() => import('./pages/WorkflowMonitor'));
const ChatPage = React.lazy(() => import('./pages/ChatPage'));

const { Header, Sider, Content } = Layout;

type MenuItem = Required<MenuProps>['items'][number];

const menuItems: MenuItem[] = [
  {
    key: '/',
    icon: <DashboardOutlined />,
    label: <Link to="/">Dashboard</Link>,
  },
  {
    key: '/framework',
    icon: <BranchesOutlined />,
    label: <Link to="/framework">Framework</Link>,
  },
  {
    key: '/chat',
    icon: <SendOutlined />,
    label: <Link to="/chat">Chat</Link>,
  },
  {
    key: '/info',
    icon: <DatabaseOutlined />,
    label: <Link to="/info">信息中心</Link>,
  },
  {
    key: 'agents-group',
    label: 'Configuration',
    icon: <SettingOutlined />,
    children: [
      { key: '/agents', icon: <RobotOutlined />, label: <Link to="/agents">Agents</Link> },
      { key: '/skills', icon: <ThunderboltOutlined />, label: <Link to="/skills">Skills</Link> },
      { key: '/mcp', icon: <CloudServerOutlined />, label: <Link to="/mcp">MCP Servers</Link> },
      { key: '/providers', icon: <ApiOutlined />, label: <Link to="/providers">Providers</Link> },
      { key: '/tools', icon: <ToolOutlined />, label: <Link to="/tools">Tools</Link> },
      { key: '/permissions', icon: <SafetyOutlined />, label: <Link to="/permissions">Permissions</Link> },
      { key: '/config', icon: <FileTextOutlined />, label: <Link to="/config">Config</Link> },
      { key: '/rules', icon: <FileTextOutlined />, label: <Link to="/rules">Rules</Link> },
      { key: '/workflows', icon: <BranchesOutlined />, label: <Link to="/workflows">Workflows</Link> },
    ],
  },
];

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,        // 30 seconds considered fresh
      retry: 2,                  // retry 2 times on failure
      refetchOnWindowFocus: true,
    },
    mutations: {
      onError: (error) => {
        console.error('[Mutation Error]', error);
      },
    },
  },
});

const AppLayout: React.FC = () => {
  const location = useLocation();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  const agentsPaths = ['/agents', '/skills', '/mcp', '/providers', '/tools', '/permissions', '/config', '/rules', '/workflows'];
  const openKeys = agentsPaths.includes(location.pathname) ? ['agents-group'] : [];

  const pageName = () => {
    const path = location.pathname;
    if (path === '/') return 'Dashboard';
    if (path === '/framework') return 'Framework';
    if (path === '/chat') return 'Chat';
    if (path === '/agents') return 'Agents';
    if (path === '/skills') return 'Skills';
    if (path === '/mcp') return 'MCP Servers';
    if (path === '/providers') return 'Providers';
    if (path === '/tools') return 'Tools';
    if (path === '/permissions') return 'Permissions';
    if (path === '/config') return 'Config';
    if (path === '/rules') return 'Rules';
    if (path.startsWith('/workflows')) return 'Workflows';
    if (path === '/info') return '信息中心';
    if (path === '/info/settings') return '维护设置';
    return path.replace('/', '').charAt(0).toUpperCase() + path.slice(2);
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* Sidebar */}
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={toggleSidebar}
        width={260}
        collapsedWidth={72}
        style={{
          background: '#1A1A1A',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
        }}
        trigger={null}
      >
        {/* Logo Area */}
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '0' : '0 20px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            gap: 12,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: '#6B8EC4',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          {!collapsed && (
            <div>
              <div
                style={{
                  fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
                  fontSize: 16,
                  fontWeight: 600,
                  color: '#F0F0F0',
                  lineHeight: 1.2,
                  letterSpacing: '-0.01em',
                }}
              >
                FIN-AGENT
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: '#6B6B6B',
                  letterSpacing: '0.04em',
                }}
              >
                Analytics
              </div>
            </div>
          )}
        </div>

        {/* Navigation Menu */}
        <div style={{ flex: 1, overflow: 'auto', paddingTop: 8 }}>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[location.pathname]}
            openKeys={openKeys}
            onOpenChange={() => {
              /* keep submenus controlled by route; no user-toggle needed */
            }}
            items={menuItems}
            style={{
              background: 'transparent',
              borderRight: 'none',
            }}
          />
        </div>

        {/* Sidebar Footer */}
        {!collapsed && (
          <div
            style={{
              padding: '12px 20px',
              borderTop: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#5A9E7B',
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  color: '#B0B0B0',
                }}
              >
                System Online
              </span>
            </div>
            <div
              style={{
                fontSize: 10,
                color: '#6B6B6B',
                textAlign: 'center',
                marginTop: 8,
              }}
            >
              v1.0.0
            </div>
          </div>
        )}
      </Sider>

      {/* Main Content Area */}
      <Layout style={{ marginLeft: collapsed ? 72 : 260, transition: 'margin-left 0.2s' }}>
        {/* Top Header Bar */}
        <Header
          style={{
            padding: '0 24px',
            background: '#1A1A1A',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 52,
            position: 'sticky',
            top: 0,
            zIndex: 50,
          }}
        >
          {/* Left: Collapse Button + Page Name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Tooltip title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              <div
                onClick={toggleSidebar}
                style={{
                  cursor: 'pointer',
                color: '#6B6B6B',
                fontSize: 16,
                padding: '4px 6px',
                borderRadius: 4,
                transition: 'color 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#F0F0F0';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#6B6B6B';
              }}
              >
                {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              </div>
            </Tooltip>
            <div
              style={{
                fontSize: 14,
                color: '#B0B0B0',
                fontWeight: 400,
              }}
            >
              {pageName()}
            </div>
          </div>

          {/* Right: Minimal status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#5A9E7B',
                }}
              />
              <span style={{ fontSize: 11, color: '#787878' }}>
                Live
              </span>
            </div>
          </div>
        </Header>

        {/* Page Content */}
        <Content
          style={{
            margin: 0,
            padding: 0,
            minHeight: 'calc(100vh - 52px)',
            background: '#121212',
          }}
        >
          <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}><Spin size="large" /></div>}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/framework" element={<FrameworkPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/skills" element={<SkillsPage />} />
              <Route path="/mcp" element={<MCPServersPage />} />
              <Route path="/providers" element={<ProvidersPage />} />
              <Route path="/tools" element={<ToolsPage />} />
              <Route path="/permissions" element={<PermissionsPage />} />
              <Route path="/config" element={<ConfigRawEditor />} />
              <Route path="/rules" element={<RulesEditor />} />
              <Route path="/workflows" element={<WorkflowList />} />
              <Route path="/workflows/new/edit" element={<WorkflowEditor />} />
              <Route path="/workflows/:id/edit" element={<WorkflowEditor />} />
              <Route path="/workflows/settings" element={<WorkflowSettings />} />
              <Route path="/workflows/:executionId?" element={<WorkflowMonitor />} />
            </Routes>
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  );
};

const App: React.FC = () => {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#6B8EC4',
          colorBgContainer: '#1A1A1A',
          colorBgElevated: '#222222',
          colorBgLayout: '#121212',
          colorText: '#F0F0F0',
          colorTextSecondary: '#B0B0B0',
          colorTextTertiary: '#787878',
          colorBorder: 'rgba(255,255,255,0.10)',
          colorBorderSecondary: 'rgba(255,255,255,0.06)',
          borderRadius: 10,
          fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif",
          colorSuccess: '#5A9E7B',
          colorWarning: '#D4A85A',
          colorError: '#D47070',
          colorInfo: '#6B8EC4',
          colorLink: '#6B8EC4',
          controlHeight: 38,
        },
        components: {
          Modal: {
            contentBg: '#1A1A1A',
            headerBg: 'transparent',
            titleColor: '#F0F0F0',
            colorIcon: '#B0B0B0',
            colorIconHover: '#F0F0F0',
          },
          Drawer: {
            colorBgElevated: '#1A1A1A',
          },
          Popover: {
            colorBgElevated: '#1A1A1A',
          },
          Dropdown: {
            colorBgElevated: '#1A1A1A',
          },
          Table: {
            headerBg: 'transparent',
            headerColor: '#787878',
            rowHoverBg: '#222222',
            borderColor: 'rgba(255,255,255,0.06)',
          },
          Card: {
            colorBgContainer: '#1A1A1A',
            colorBorderSecondary: 'rgba(255,255,255,0.06)',
          },
          Input: {
            colorBgContainer: '#222222',
            colorBorder: 'rgba(255,255,255,0.10)',
            activeBorderColor: '#6B8EC4',
            hoverBorderColor: 'rgba(255,255,255,0.15)',
          },
          Select: {
            colorBgContainer: '#222222',
            colorBgElevated: '#1A1A1A',
            colorBorder: 'rgba(255,255,255,0.10)',
            optionSelectedBg: 'rgba(107,142,196,0.14)',
          },
          Menu: {
            darkItemBg: 'transparent',
            darkSubMenuItemBg: 'transparent',
            darkItemSelectedBg: 'rgba(107,142,196,0.14)',
            darkItemColor: '#B0B0B0',
            darkItemSelectedColor: '#6B8EC4',
            darkItemHoverColor: '#F0F0F0',
            darkItemHoverBg: '#222222',
          },
          Button: {
            borderRadius: 10,
            controlHeight: 38,
          },
          Tag: {
            borderRadiusSM: 8,
          },
          Message: {
            contentBg: '#1A1A1A',
          },
          Notification: {
            colorBgElevated: '#1A1A1A',
          },
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <Router>
          <AppLayout />
        </Router>
      </QueryClientProvider>
    </ConfigProvider>
  );
};

export default App;
