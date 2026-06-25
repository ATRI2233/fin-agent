import React from 'react';
import { useLocation } from 'react-router-dom';
import { Layout, Menu } from 'antd';
import type { MenuProps } from 'antd';

const { Sider } = Layout;

export const SIDEBAR_WIDTH = 260;
export const SIDEBAR_COLLAPSED_WIDTH = 72;

interface SidebarProps {
  collapsed: boolean;
  toggleSidebar: () => void;
  openKeys: string[];
  setOpenKeys: (keys: string[]) => void;
  menuItems: MenuProps['items'];
}

const Sidebar: React.FC<SidebarProps> = ({ collapsed, toggleSidebar, openKeys, setOpenKeys, menuItems }) => {
  const location = useLocation();

  return (
    <Sider
      collapsible
      collapsed={collapsed}
      onCollapse={toggleSidebar}
      width={SIDEBAR_WIDTH}
      collapsedWidth={SIDEBAR_COLLAPSED_WIDTH}
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
          onOpenChange={(keys) => setOpenKeys(keys as string[])}
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
  );
};

export default Sidebar;
