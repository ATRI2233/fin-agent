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

// ©¤©¤ Types ©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤
interface Conversation {
  id: string;
  title: string;
  hapi_session_id?: string;
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

// ©¤©¤ API Helpers ©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤
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

// ©¤©¤ Message Bubble Component ©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤
function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';
  const isWorkflowStatus = msg.extra_data?.type === 'workflow_status';
  const isWorkflowResult = msg.extra_data?.type === 'workflow_result';
  const isWorkflowError = msg.extra_data?.type === 'workflow_error';

  // Workflow status: compact display with spinner
  if (isWorkflowStatus) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 12px' }}>
          <SyncOutlined spin style={{ color: '#6B8EC4', fontSize: 12 }} />
          {msg.agent && (
            <Tag color="blue" style={{ fontSize: 10, margin: 0 }}>
              {msg.agent}
            </Tag>
          )}
          <Text style={{ color: '#888', fontSize: 12 }}>{msg.content}</Text>
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
            background: isUser ? '#6B8EC4' : isSystem ? '#525252' : isWorkflowResult ? '#52c41a' : '#1890ff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {isUser ? (
            <UserOutlined style={{ color: '#fff', fontSize: 14 }} />
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
            background: isUser ? '#1a3a5c' : isSystem ? '#2a2a2a' : isWorkflowResult ? '#1a2e1a' : '#1e1e1e',
            border: '1px solid',
            borderColor: isUser ? '#2a4a6c' : isSystem ? '#3a3a3a' : isWorkflowResult ? '#2a4a2a' : '#2e2e2e',
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
                <Tag color="purple" style={{ fontSize: 11 }}>
                  workflow
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

// ©¤©¤ Main Chat Page ©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤
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

  // ©¤©¤ Load Data ©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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

  // ©¤©¤ Poll for new messages ©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤
  const startPolling = useCallback((conversationId: string, userMessageId: string, pollMode: string) => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }

    let pollCount = 0;
    const maxPolls = 120; // 60 seconds max

    pollingRef.current = setInterval(async () => {
      pollCount++;
      if (pollCount > maxPolls) {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
        }
        setProcessingMessage(false);
        setPendingMessageId(null);
        return;
      }

      try {
        const msgs = await fetchMessages(conversationId);
        setMessages(msgs);

        if (pollMode === 'agent') {
          // Agent mode: look for assistant reply to our message
          const response = msgs.find(
            m => m.role === 'assistant' && m.extra_data?.in_reply_to === userMessageId
          );
          if (response) {
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
            }
            setProcessingMessage(false);
            setPendingMessageId(null);
          }
        } else {
          // Workflow mode: look for workflow_result or workflow_error
          const response = msgs.find(
            m => (m.extra_data?.type === 'workflow_result' || m.extra_data?.type === 'workflow_error')
                 && m.execution_id
          );
          if (response) {
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
            }
            setProcessingMessage(false);
            setPendingMessageId(null);
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 500); // Poll every 500ms
  }, []);

  // ©¤©¤ Conversation Management ©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤
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

  // ©¤©¤ Send Message ©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤
  const handleSend = async () => {
    if (!inputValue.trim() || !currentConversation || processingMessage) return;

    const content = inputValue.trim();
    setInputValue('');
    setSendingMessage(true);
    setProcessingMessage(true);

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

  // ©¤©¤ Render ©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤
  return (
    <div style={{ display: 'flex', height: '100%', background: '#0a0a0a' }}>
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
                    <Tag color="orange" icon={<LoadingOutlined spin />}>
                      Processing
                    </Tag>
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
                messages
                  .filter(msg => msg.extra_data?.type !== 'workflow_status') // Hide workflow status from main view
                  .map((msg) => (
                    <MessageBubble key={msg.id} msg={msg} />
                  ))
              )}
              
              {/* Workflow status indicator */}
              {processingMessage && mode === 'workflow' && (
                <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 16 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 16px', background: '#1a1a2a', borderRadius: 8, border: '1px solid #2a2a4a' }}>
                    <SyncOutlined spin style={{ color: '#6B8EC4' }} />
                    <Text style={{ color: '#888', fontSize: 13 }}>
                      Workflow executing...
                    </Text>
                    {/* Show latest workflow status messages */}
                    {messages
                      .filter(m => m.extra_data?.type === 'workflow_status')
                      .slice(-3)
                      .map(m => (
                        <Tag key={m.id} color="processing" style={{ fontSize: 10 }}>
                          {m.agent || m.content}
                        </Tag>
                      ))
                    }
                  </div>
                </div>
              )}
              
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