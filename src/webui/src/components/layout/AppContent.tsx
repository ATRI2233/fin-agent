import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout, Spin } from 'antd';

const { Content } = Layout;

const FrameworkPage = React.lazy(() => import('../../pages/FrameworkPage'));
const AgentsPage = React.lazy(() => import('../../pages/AgentsPage'));
const ToolsPage = React.lazy(() => import('../../pages/ToolsPage'));
const Dashboard = React.lazy(() => import('../../pages/Dashboard'));
const WorkflowList = React.lazy(() => import('../../pages/WorkflowList'));
const WorkflowEditor = React.lazy(() => import('../../pages/WorkflowEditor'));
const WorkflowSettings = React.lazy(() => import('../../pages/WorkflowSettings'));
const WorkflowMonitor = React.lazy(() => import('../../pages/WorkflowMonitor'));

const AppContent: React.FC = () => {
  return (
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
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/workflows" element={<WorkflowList />} />
          <Route path="/workflows/new/edit" element={<WorkflowEditor />} />
          <Route path="/workflows/:id/edit" element={<WorkflowEditor />} />
          <Route path="/workflows/settings" element={<WorkflowSettings />} />
          <Route path="/workflows/monitor" element={<WorkflowMonitor />} />
          <Route path="/workflows/monitor/:executionId" element={<WorkflowMonitor />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Content>
  );
};

export default AppContent;
