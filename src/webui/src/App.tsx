import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Link, useLocation } from 'react-router-dom';
import { Layout, ConfigProvider, theme } from 'antd';
import type { MenuProps } from 'antd';
import { useUiStore } from './store/useUiStore';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  DashboardOutlined,
  RobotOutlined,
  ToolOutlined,
  SettingOutlined,
  BranchesOutlined,
} from '@ant-design/icons';
import './styles/theme.css';

import Sidebar, { SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH } from './components/layout/Sidebar';
import HeaderBar from './components/layout/HeaderBar';
import AppContent from './components/layout/AppContent';

/* ─── Sidebar menu items ────────────────────────────────────────────── */
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
    key: 'agents-group',
    label: 'Configuration',
    icon: <SettingOutlined />,
    children: [
      { key: '/agents', icon: <RobotOutlined />, label: <Link to="/agents">Agents</Link> },
      { key: '/tools', icon: <ToolOutlined />, label: <Link to="/tools">Tools</Link> },
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

  const agentsPaths = ['/agents', '/tools', '/workflows'];
  // Sidebar submenu state: follow the current route by default, but
  // also let the user click to expand/collapse (so navigating from
  // `/` (Dashboard) into the Configuration submenu actually opens it).
  // The previous `openKeys` was a derived constant that re-collapsed on
  // every render, and the empty `onOpenChange` swallowed clicks — so
  // users landing on Dashboard could never open the submenu by clicking.
  const [openKeys, setOpenKeys] = useState<string[]>(
    agentsPaths.includes(location.pathname) ? ['agents-group'] : [],
  );
  useEffect(() => {
    if (agentsPaths.includes(location.pathname)) {
      setOpenKeys((prev) => (prev.includes('agents-group') ? prev : [...prev, 'agents-group']));
    }
  }, [location.pathname]);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sidebar
        collapsed={collapsed}
        toggleSidebar={toggleSidebar}
        openKeys={openKeys}
        setOpenKeys={setOpenKeys}
        menuItems={menuItems}
      />
      <Layout style={{ marginLeft: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH, transition: 'margin-left 0.2s' }}>
        <HeaderBar collapsed={collapsed} toggleSidebar={toggleSidebar} />
        <AppContent />
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
