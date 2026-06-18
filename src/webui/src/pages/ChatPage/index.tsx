/**
 * `ChatPage` — the chat UI route at `/chat`.
 *
 * Composes the smaller modules in this folder:
 * - `ConversationSidebar` — left-rail conversation list
 * - `MessageThread` — scrollable message list + auto-scroll
 * - `ChatInput` — mode toggle + agent/workflow + composer
 * - `hooks/useConversations` — list + create + delete (page wrapper)
 * - `hooks/useMessages` — load + send + SSE state (page wrapper)
 * - `hooks/useConversationStream` — used by `useMessages`
 *
 * Top-level state owned here (UI-only):
 * - `mode`, `selectedAgent`, `selectedWorkflow` — composer targeting
 * - `inputValue` — textarea scratch space
 *
 * All HTTP / network state goes through hooks — this file contains no
 * raw `fetch(` calls (verified by `npm run check:slop` in CI).
 *
 * The scroll handle is held by `MessageThread` internally; we trigger
 * it imperatively via `messageThreadRef.current?.requestScroll()`
 * before sending a message so the new row lands visible.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  LoadingOutlined,
  MessageOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

import { listSessions } from '../../api/sessions';
import type { SessionInfo } from '../../types/session';
import { useAgents } from '../../hooks/useAgents';
import { useWorkflows } from '../../hooks/useWorkflows';
import ChatInput, { type ChatMode } from './ChatInput';
import ConversationSidebar from './ConversationSidebar';
import {
  MessageThread,
  type MessageThreadHandle,
} from './MessageThread';
import { useChatConversations } from './hooks/useChatConversations';
import { useMessages } from './hooks/useMessages';

const { Text } = Typography;

export default function ChatPage() {
  // Composer state — owned by the page so `handleSend` can read it
  // directly without prop drilling through `ChatInput`.
  const [inputValue, setInputValue] = useState('');
  const [mode, setMode] = useState<ChatMode>('agent');
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);

  // Page-specific hooks .
  const {
    conversations,
    currentConversation,
    setCurrentConversation,
    createConversation,
    deleteConversation,
  } = useChatConversations();
  const {
    messages,
    loadMessages,
    sendMessage,
    processingMessage,
    sendingMessage,
    stopStream,
  } = useMessages();

  // Registry data (hooks — read-only). `useFetch` returns
  // `data: T | null`, so coalesce to [] before passing downstream.
  const { data: agentsRaw } = useAgents();
  const { data: workflowsRaw } = useWorkflows();
  const agents = agentsRaw ?? [];
  const workflows = workflowsRaw ?? [];

  // Sessions grouped by conversation id (for per-row sidebar sub-lists).
  const [sessionsByConversation, setSessionsByConversation] = useState<Record<string, SessionInfo[]>>({});
  // Which conversations have their session sub-list expanded in the sidebar.
  const [expandedConversations, setExpandedConversations] = useState<string[]>([]);

  const fetchSessionsForConversation = (conversationId: string) => {
    listSessions({ conversation_id: conversationId })
      .then((res) => {
        setSessionsByConversation((prev) => ({
          ...prev,
          [conversationId]: res.sessions ?? [],
        }));
      })
      .catch(() => { /* ignore */ });
  };

  const handleConversationExpand = (conversationId: string) => {
    setExpandedConversations((prev) =>
      prev.includes(conversationId)
        ? prev.filter((id) => id !== conversationId)
        : [...prev, conversationId]
    );
    // Lazy-fetch sessions for this conversation if not yet loaded
    if (!sessionsByConversation[conversationId]) {
      fetchSessionsForConversation(conversationId);
    }
  };

  const handleSessionClick = (session: SessionInfo) => {
    // Find which conversation this session belongs to
    const convId = Object.entries(sessionsByConversation).find(
      ([, sessions]) => sessions.some((s) => s.session_id === session.session_id)
    )?.[0];
    if (convId) {
      const conv = conversations.find((c) => c.id === convId);
      if (conv) {
        setCurrentConversation(conv);
        loadMessages(conv.id);
      }
    }
  };

  // Imperative handle for MessageThread so we can request a scroll on send.
  const messageThreadRef = useRef<MessageThreadHandle>(null);

  const handleSend = async (): Promise<void> => {
    const content = inputValue.trim();
    if (!content || !currentConversation) return;

    // Validate that a target is selected before sending
    if (mode === 'agent' && !selectedAgent) {
      message.warning('请先选择一个 Agent');
      return;
    }
    if (mode === 'workflow' && !selectedWorkflow) {
      message.warning('请先选择一个 Workflow');
      return;
    }

    setInputValue('');
    messageThreadRef.current?.requestScroll();
    await sendMessage({
      content,
      mode,
      agent: mode === 'agent' ? selectedAgent : undefined,
      workflow_id: mode === 'workflow' ? selectedWorkflow : null,
    });
  };

  return (
    <div
      style={{
        display: 'flex',
        height: 'calc(100vh - 52px)',
        background: '#0a0a0a',
        overflow: 'hidden',
      }}
    >
      <ConversationSidebar
        conversations={conversations}
        currentId={currentConversation?.id ?? null}
        sessionsByConversation={sessionsByConversation}
        expandedConversations={new Set(expandedConversations)}
        onConversationExpand={handleConversationExpand}
        onSessionClick={handleSessionClick}
        onSelect={setCurrentConversation}
        onCreate={createConversation}
        onDelete={deleteConversation}
      />

      {/* Main Chat Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {currentConversation ? (
          <>
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
                    <Tag color="blue">{selectedAgent || 'Select agent'}</Tag>
                  ) : (
                    <Tag color="purple">
                      {workflows.find((w) => w.id === selectedWorkflow)?.name ||
                        'Select workflow'}
                    </Tag>
                  )}
                  {processingMessage && (
                    <Space size={8}>
                      <Tag color="orange" icon={<LoadingOutlined spin />}>
                        Processing
                      </Tag>
                      <Button size="small" danger onClick={() => stopStream()}>
                        取消
                      </Button>
                    </Space>
                  )}
                </div>
              </div>

              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  void loadMessages(currentConversation.id);
                }}
              >
                Refresh
              </Button>
            </div>

            <MessageThread
              ref={messageThreadRef}
              messages={messages}
              showWorkflowIndicator={processingMessage && mode === 'workflow'}
            />

            <ChatInput
              onSend={() => {
                void handleSend();
              }}
              onInputChange={setInputValue}
              inputValue={inputValue}
              agents={agents}
              workflows={workflows}
              mode={mode}
              onModeChange={setMode}
              selectedAgent={selectedAgent}
              onAgentChange={setSelectedAgent}
              selectedWorkflow={selectedWorkflow}
              onWorkflowChange={setSelectedWorkflow}
              processingMessage={processingMessage}
              sendingMessage={sendingMessage}
            />
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
              onClick={() => {
                void createConversation();
              }}
            >
              New Conversation
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}