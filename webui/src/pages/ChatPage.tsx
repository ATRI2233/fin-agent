import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Typography,
  Button,
  Input,
  Select,
  Space,
  Tag,
  message,
  List,
  Popconfirm,
} from 'antd';
import {
  SendOutlined,
  RobotOutlined,
  UserOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
  BranchesOutlined,
  PlusOutlined,
  DeleteOutlined,
  MessageOutlined,
  LoadingOutlined,
  SyncOutlined,
} from '@ant-design/icons';

const { Text } = Typography;
const { TextArea } = Input;

// ���� Types ����������������������������������������������������������������������������������������������������������������������
interface Conversation {
  id: string;
  title: string;
  current_agent: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agent?: string;
  workflow_id?: string;
  execution_id?: string;
  extra_data?: any;
  created_at: string;
  _struck?: boolean;
}

interface Workflow {
  id: string;
  name: string;
  status: string;
}

interface Agent {
  name: string;
  description: string;
  mode: string;
}

// ���� API Helpers ����������������������������������������������������������������������������������������������������������
const API_V1 = '/api/v1';

async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch(`${API_V1}/conversations`);
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json();
}

async function createConversation(title?: string): Promise<Conversation> {
  const res = await fetch(`${API_V1}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title || 'New Conversation' }),
  });
  if (!res.ok) throw new Error('Failed to create conversation');
  return res.json();
}

async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`${API_V1}/conversations/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete conversation');
}

async function fetchMessages(conversationId: string): Promise<Message[]> {
  const res = await fetch(`${API_V1}/conversations/${conversationId}/messages`);
  if (!res.ok) throw new Error('Failed to fetch messages');
  return res.json();
}

async function sendMessage(
  conversationId: string,
  content: string,
  mode: 'agent' | 'workflow',
  agent?: string,
  workflowId?: string
): Promise<any> {
  const res = await fetch(`${API_V1}/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      mode,
      agent: mode === 'agent' ? agent : undefined,
      workflow_id: mode === 'workflow' ? workflowId : undefined,
    }),
  });
  if (!res.ok) throw new Error('Failed to send message');
  return res.json();
}

async function fetchWorkflows(): Promise<Workflow[]> {
  const res = await fetch(`${API_V1}/workflows`);
  if (!res.ok) throw new Error('Failed to fetch workflows');
  return res.json();
}

async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch(`${API_V1}/agents`);
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json();
}

// ���� Message Bubble Component ��������������������������������������������������������������������������������
function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';
  const msgType = msg.extra_data?.type;
  const isWorkflowStart = msgType === 'workflow_start';
  const isWorkflowStatus = msgType === 'workflow_status';
  const isWorkflowResult = msgType === 'workflow_result';
  const isWorkflowError = msgType === 'workflow_error';
  const isStruck = msg._struck;

  // Workflow status: compact inline display with status indicator
  if (isWorkflowStatus || isWorkflowStart) {
    const statusText = msg.extra_data?.status || '';
    const isCompleted = statusText === 'completed';
    const isFailed = statusText === 'failed';
    const iconColor = isFailed ? '#ff4d4f' : isCompleted ? '#52c41a' : '#6B8EC4';

    return (
      <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 6, opacity: isStruck ? 0.5 : 1 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 12px' }}>
          {isStruck ? (
            <span style={{ position: 'relative', display: 'inline-flex', width: 12, height: 12 }}>
              <SyncOutlined style={{ color: '#555', fontSize: 12 }} />
              <span style={{ position: 'absolute', top: '50%', left: -1, right: -1, height: 1, background: '#555' }} />
            </span>
          ) : isFailed ? (
            <ThunderboltOutlined style={{ color: iconColor, fontSize: 12 }} />
          ) : isCompleted ? (
            <BranchesOutlined style={{ color: iconColor, fontSize: 12 }} />
          ) : (
            <SyncOutlined spin style={{ color: iconColor, fontSize: 12 }} />
          )}
          {msg.agent && (
            <Tag color={isStruck ? 'default' : isFailed ? 'error' : isCompleted ? 'success' : 'blue'} style={{ fontSize: 10, margin: 0, textDecoration: isStruck ? 'line-through' : 'none' }}>
              {msg.agent}
            </Tag>
          )}
          <Text style={{ color: isStruck ? '#555' : isFailed ? '#ff7875' : '#888', fontSize: 12, textDecoration: isStruck ? 'line-through' : 'none' }}>{msg.content}</Text>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 16,
      }}
    >
      <div
        style={{
          maxWidth: '80%',
          display: 'flex',
          gap: 8,
          flexDirection: isUser ? 'row-reverse' : 'row',
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: isUser ? '#6B8EC4' : isWorkflowError ? '#ff4d4f' : isSystem ? '#525252' : isWorkflowResult ? '#52c41a' : '#1890ff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {isUser ? (
            <UserOutlined style={{ color: '#fff', fontSize: 14 }} />
          ) : isWorkflowError ? (
            <ThunderboltOutlined style={{ color: '#fff', fontSize: 14 }} />
          ) : isSystem ? (
            <ThunderboltOutlined style={{ color: '#fff', fontSize: 14 }} />
          ) : isWorkflowResult ? (
            <BranchesOutlined style={{ color: '#fff', fontSize: 14 }} />
          ) : (
            <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
          )}
        </div>

        <div
          style={{
            padding: '12px 16px',
            borderRadius: 12,
            background: isUser ? '#1a3a5c' : isWorkflowError ? '#2a1a1a' : isSystem ? '#2a2a2a' : isWorkflowResult ? '#1a2e1a' : '#1e1e1e',
            border: '1px solid',
            borderColor: isUser ? '#2a4a6c' : isWorkflowError ? '#4a2a2a' : isSystem ? '#3a3a3a' : isWorkflowResult ? '#2a4a2a' : '#2e2e2e',
          }}
        >
          {/* Agent/Workflow tags */}
          {(msg.agent || msg.workflow_id) && (
            <div style={{ marginBottom: 8, display: 'flex', gap: 4 }}>
              {msg.agent && (
                <Tag color="blue" style={{ fontSize: 11 }}>
                  {msg.agent}
                </Tag>
              )}
              {msg.workflow_id && (
                <Tag color={isWorkflowError ? 'error' : 'purple'} style={{ fontSize: 11 }}>
                  {isWorkflowError ? 'workflow error' : 'workflow'}
                </Tag>
              )}
            </div>
          )}

          {/* Content */}
          <div
            style={{
              color: '#E0E0E0',
              fontSize: 14,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
            }}
          >
            {msg.content}
          </div>

          {/* Node status for workflow results */}
          {isWorkflowResult && msg.extra_data?.nodes && (
            <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid #2a4a2a' }}>
              <Text style={{ color: '#888', fontSize: 11, display: 'block', marginBottom: 4 }}>
                Nodes:
              </Text>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {msg.extra_data.nodes.map((n: any, i: number) => (
                  <Tag
                    key={i}
                    color={n.status === 'completed' ? 'green' : n.status === 'failed' ? 'red' : 'default'}
                    style={{ fontSize: 10 }}
                  >
                    {n.agent} ({n.status})
                  </Tag>
                ))}
              </div>
            </div>
          )}

          {/* Timestamp */}
          <div style={{ marginTop: 8, fontSize: 11, color: '#666' }}>
            {new Date(msg.created_at).toLocaleTimeString()}
          </div>
        </div>
      </div>
    </div>
  );
}

// ���� Main Chat Page ����������������������������������������������������������������������������������������������������
export default function ChatPage() {
  // State
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);

  const [inputValue, setInputValue] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [processingMessage, setProcessingMessage] = useState(false);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);

  // Mode: 'agent' or 'workflow'
  const [mode, setMode] = useState<'agent' | 'workflow'>('agent');
  const [selectedAgent, setSelectedAgent] = useState<string>('fin-orchestrator');
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ���� Load Data ������������������������������������������������������������������������������������������������������
  useEffect(() => {
    loadConversations();
    loadAgents();
    loadWorkflows();
  }, []);

  useEffect(() => {
    if (currentConversation) {
      loadMessages(currentConversation.id);
    }
  }, [currentConversation]);

  // Only auto-scroll when user sends a message or first load
  const shouldAutoScroll = useRef(false);
  useEffect(() => {
    if (shouldAutoScroll.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      shouldAutoScroll.current = false;
    }
  }, [messages]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  const loadConversations = async () => {
    try {
      const data = await fetchConversations();
      setConversations(data);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  };

  const loadAgents = async () => {
    try {
      const data = await fetchAgents();
      setAgents(data);
    } catch (err) {
      console.error('Failed to load agents:', err);
    }
  };

  const loadWorkflows = async () => {
    try {
      const data = await fetchWorkflows();
      setWorkflows(data);
    } catch (err) {
      console.error('Failed to load workflows:', err);
    }
  };

  const loadMessages = async (conversationId: string) => {
    try {
      const data = await fetchMessages(conversationId);
      setMessages(data);
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  };

  // Poll for new messages
  const startPolling = useCallback((conversationId: string, userMessageId: string, pollMode: string) => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }

    let pollCount = 0;
    const maxPolls = 120; // 4 minutes at 2s interval

    const stopPolling = () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      setProcessingMessage(false);
      setPendingMessageId(null);
      setSendingMessage(false);
    };

    pollingRef.current = setInterval(async () => {
      pollCount++;
      if (pollCount > maxPolls) {
        stopPolling();
        return;
      }

      try {
        const msgs = await fetchMessages(conversationId);
        setMessages(msgs);

        // Find the user message index to only look at messages AFTER it
        const userIdx = msgs.findIndex(m => m.id === userMessageId);
        const afterUser = userIdx >= 0 ? msgs.slice(userIdx + 1) : msgs;

        if (pollMode === 'workflow') {
          // For workflow mode: only stop on workflow_result or workflow_error
          const hasWorkflowResult = afterUser.some(m =>
            m.extra_data?.type === 'workflow_result'
          );
          const hasWorkflowError = afterUser.some(m =>
            m.extra_data?.type === 'workflow_error'
          );
          if (hasWorkflowResult || hasWorkflowError) {
            stopPolling();
          }
        } else {
          // For agent mode: stop on any assistant or non-workflow system message
          const hasResponse = afterUser.some(m =>
            m.role === 'assistant' ||
            (m.role === 'system' && m.extra_data?.type !== 'workflow_status' && m.extra_data?.type !== 'workflow_start')
          );
          if (hasResponse) {
            stopPolling();
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 2000);
  }, []);

  // ���� Conversation Management ��������������������������������������������������������������������������
  const handleNewConversation = async () => {
    try {
      const conv = await createConversation();
      setConversations(prev => [conv, ...prev]);
      setCurrentConversation(conv);
      setMessages([]);
    } catch (err) {
      message.error('Failed to create conversation');
    }
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      await deleteConversation(id);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (currentConversation?.id === id) {
        setCurrentConversation(null);
        setMessages([]);
      }
    } catch (err) {
      message.error('Failed to delete conversation');
    }
  };

  // ���� Send Message ������������������������������������������������������������������������������������������������
  const handleSend = async () => {
    if (!inputValue.trim() || !currentConversation || processingMessage) return;

    const content = inputValue.trim();
    setInputValue('');
    setSendingMessage(true);
    setProcessingMessage(true);
    shouldAutoScroll.current = true;

    try {
      const result = await sendMessage(
        currentConversation.id,
        content,
        mode,
        mode === 'agent' ? selectedAgent : undefined,
        mode === 'workflow' ? selectedWorkflow || undefined : undefined
      );

      // Get the user message ID from the response
      const userMessageId = result.user_message?.id;
      if (userMessageId) {
        setPendingMessageId(userMessageId);
        
        // Add user message immediately
        const tempUserMsg: Message = {
          id: userMessageId,
          role: 'user',
          content,
          created_at: new Date().toISOString(),
        };
        setMessages(prev => [...prev, tempUserMsg]);

        // Start polling for response
        startPolling(currentConversation.id, userMessageId, mode);
      }

      // Update conversation in list
      await loadConversations();

    } catch (err) {
      message.error('Failed to send message');
      setProcessingMessage(false);
    } finally {
      setSendingMessage(false);
    }
  };

  // ���� Render ������������������������������������������������������������������������������������������������������������
  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 52px)', background: '#0a0a0a', overflow: 'hidden' }}>
      {/* Sidebar - Conversation List */}
      <div
        style={{
          width: 280,
          background: '#111',
          borderRight: '1px solid #222',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: 16, borderBottom: '1px solid #222' }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleNewConversation}
            style={{ width: '100%' }}
          >
            New Conversation
          </Button>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          <List
            dataSource={conversations}
            renderItem={(conv) => (
              <div
                onClick={() => setCurrentConversation(conv)}
                style={{
                  padding: '12px 16px',
                  cursor: 'pointer',
                  background: currentConversation?.id === conv.id ? '#1a1a1a' : 'transparent',
                  borderBottom: '1px solid #1a1a1a',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#E0E0E0', fontSize: 14 }}>
                    {conv.title}
                  </div>
                  <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>
                    {conv.message_count} messages
                  </div>
                </div>
                <Popconfirm
                  title="Delete this conversation?"
                  onConfirm={(e) => {
                    e?.stopPropagation();
                    handleDeleteConversation(conv.id);
                  }}
                >
                  <Button
                    type="text"
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={(e) => e.stopPropagation()}
                    style={{ color: '#666' }}
                  />
                </Popconfirm>
              </div>
            )}
          />
        </div>
      </div>

      {/* Main Chat Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {currentConversation ? (
          <>
            {/* Header */}
            <div
              style={{
                padding: '12px 24px',
                borderBottom: '1px solid #222',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <Text style={{ color: '#F0F0F0', fontSize: 16, fontWeight: 500 }}>
                  {currentConversation.title}
                </Text>
                <div style={{ marginTop: 4 }}>
                  {mode === 'agent' ? (
                    <Tag color="blue">{selectedAgent}</Tag>
                  ) : (
                    <Tag color="purple">
                      {workflows.find(w => w.id === selectedWorkflow)?.name || 'Select workflow'}
                    </Tag>
                  )}
                  {processingMessage && (
                    <Space size={8}>
                      <Tag color="orange" icon={<LoadingOutlined spin />}>
                        Processing
                      </Tag>
                      <Button
                        size="small"
                        danger
                        onClick={() => {
                          if (pollingRef.current) {
                            clearInterval(pollingRef.current);
                            pollingRef.current = null;
                          }
                          setProcessingMessage(false);
                          setPendingMessageId(null);
                          setSendingMessage(false);
                        }}
                      >
                        取消
                      </Button>
                    </Space>
                  )}
                </div>
              </div>

              <Button
                icon={<ReloadOutlined />}
                onClick={() => loadMessages(currentConversation.id)}
              >
                Refresh
              </Button>
            </div>

            {/* Messages */}
            <div
              style={{
                flex: 1,
                overflow: 'auto',
                padding: '24px',
              }}
            >
              {messages.length === 0 ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    gap: 16,
                  }}
                >
                  <RobotOutlined style={{ fontSize: 48, color: '#3A3A3A' }} />
                  <Text style={{ color: '#6B6B6B', fontSize: 16 }}>
                    Start a conversation
                  </Text>
                  <Text style={{ color: '#525252', fontSize: 14 }}>
                    Select an agent or workflow and type your message
                  </Text>
                </div>
              ) : (
                (() => {
                  // Build a map: agent -> latest status from workflow_status messages
                  const agentLatestStatus: Record<string, string> = {};
                  for (const m of messages) {
                    if (m.extra_data?.type === 'workflow_status' && m.agent) {
                      agentLatestStatus[m.agent] = m.extra_data.status || '';
                    }
                  }
                  // If all agents are done, strike through the "workflow_start" too
                  const allAgents = Object.keys(agentLatestStatus);
                  const allDone = allAgents.length > 0 && allAgents.every(
                    a => agentLatestStatus[a] === 'completed' || agentLatestStatus[a] === 'failed'
                  );

                  return messages.map((msg) => {
                    // For "working" messages: strike through if agent has a later status
                    if (msg.extra_data?.type === 'workflow_status' && msg.agent) {
                      const latest = agentLatestStatus[msg.agent];
                      if (latest && latest !== msg.extra_data.status) {
                        const updated = { ...msg, _struck: true, extra_data: { ...msg.extra_data, status: latest } };
                        return <MessageBubble key={msg.id} msg={updated} />;
                      }
                    }
                    // For workflow_start, strike through if all agents done
                    if (msg.extra_data?.type === 'workflow_start' && allDone) {
                      const updated = { ...msg, _struck: true };
                      return <MessageBubble key={msg.id} msg={updated} />;
                    }
                    return <MessageBubble key={msg.id} msg={msg} />;
                  });
                })()
              )}
              
              {/* Workflow status indicator */}
              {processingMessage && mode === 'workflow' && (() => {
                const workflowMsgs = messages.filter(m =>
                  m.extra_data?.type === 'workflow_status' || m.extra_data?.type === 'workflow_start'
                );
                const latestMsg = workflowMsgs[workflowMsgs.length - 1];
                return (
                  <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 16 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 16px', background: '#1a1a2a', borderRadius: 8, border: '1px solid #2a2a4a' }}>
                      <SyncOutlined spin style={{ color: '#6B8EC4' }} />
                      <Text style={{ color: '#E0E0E0', fontSize: 13 }}>
                        {latestMsg?.content || 'Workflow executing...'}
                      </Text>
                      {latestMsg?.agent && (
                        <Tag color="blue" style={{ fontSize: 10 }}>
                          {latestMsg.agent}
                        </Tag>
                      )}
                    </div>
                  </div>
                );
              })()}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div
              style={{
                padding: '16px 24px',
                borderTop: '1px solid #222',
                background: '#111',
              }}
            >
              {/* Mode and Agent/Workflow Selection */}
              <div style={{ marginBottom: 12, display: 'flex', gap: 12 }}>
                <Space.Compact style={{ width: 200 }}>
                  <Button
                    type={mode === 'agent' ? 'primary' : 'default'}
                    onClick={() => setMode('agent')}
                    style={{ flex: 1 }}
                    icon={<RobotOutlined />}
                  >
                    Agent
                  </Button>
                  <Button
                    type={mode === 'workflow' ? 'primary' : 'default'}
                    onClick={() => setMode('workflow')}
                    style={{ flex: 1 }}
                    icon={<BranchesOutlined />}
                  >
                    Workflow
                  </Button>
                </Space.Compact>

                {mode === 'agent' ? (
                  <Select
                    value={selectedAgent}
                    onChange={setSelectedAgent}
                    style={{ width: 250 }}
                    options={agents.map(ag => ({
                      label: ag.name,
                      value: ag.name,
                    }))}
                  />
                ) : (
                  <Select
                    value={selectedWorkflow}
                    onChange={setSelectedWorkflow}
                    style={{ width: 250 }}
                    placeholder="Select workflow"
                    options={workflows.map(wf => ({
                      label: wf.name,
                      value: wf.id,
                    }))}
                  />
                )}
              </div>

              {/* Input */}
              <div style={{ display: 'flex', gap: 12 }}>
                <TextArea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={
                    mode === 'agent'
                      ? 'Type your message...'
                      : 'Describe what you want the workflow to do...'
                  }
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  onPressEnter={(e) => {
                    if (!e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  disabled={processingMessage}
                  style={{
                    background: '#1a1a1a',
                    border: '1px solid #333',
                    color: '#E0E0E0',
                  }}
                />
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={handleSend}
                  loading={sendingMessage}
                  disabled={processingMessage}
                  style={{ height: 'auto' }}
                >
                  Send
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
            }}
          >
            <MessageOutlined style={{ fontSize: 64, color: '#3A3A3A' }} />
            <Text style={{ color: '#6B6B6B', fontSize: 18 }}>
              Select or create a conversation
            </Text>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleNewConversation}
            >
              New Conversation
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}