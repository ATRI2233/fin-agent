import React from 'react';
import { useLocation } from 'react-router-dom';
import { Layout, Tooltip } from 'antd';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';

const { Header } = Layout;

interface HeaderBarProps {
  collapsed: boolean;
  toggleSidebar: () => void;
}

const HeaderBar: React.FC<HeaderBarProps> = ({ collapsed, toggleSidebar }) => {
  const location = useLocation();

  const pageName = () => {
    const path = location.pathname;
    if (path === '/') return 'Dashboard';
    if (path === '/framework') return 'Framework';
    if (path === '/chat') return 'Chat';
    if (path === '/agents') return 'Agents';
    if (path === '/tools') return 'Tools';
    if (path.startsWith('/workflows')) return 'Workflows';
    const SLICE_START = 2;
    return path.replace('/', '').charAt(0).toUpperCase() + path.slice(SLICE_START);
  };

  return (
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
  );
};

export default HeaderBar;
