/**
 * `ChatPage` — the chat UI route at `/chat`.
 *
 * Composes the smaller modules in this folder:
 * - `ConversationSidebar` — left-rail conversation list
 * - `ChatHeader` — title + target tag + processing badge + Refresh
 * - `MessageThread` — scrollable message list + auto-scroll
 * - `ChatInput` — mode toggle + agent/workflow + composer
 * - `hooks/useChatConversations` — list + create + delete (page wrapper)
 * - `hooks/useMessages` — load + send + SSE state (page wrapper)
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
import { useRef, useState } from 'react';
import { Button, Typography, message } from 'antd';
import { MessageOutlined, PlusOutlined } from '@ant-design/icons';

import { useAgents } from '../../hooks/useAgents';
import { useWorkflows } from '../../hooks/useWorkflows';
import ChatHeader from './ChatHeader';
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

  // Page-specific hooks.
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
    stopPolling,
  } = useMessages();

  // Registry data (hooks — read-only). `useFetch` returns
  // `data: T | null`, so coalesce to [] before passing downstream.
  const { data: agentsRaw } = useAgents();
  const { data: workflowsRaw } = useWorkflows();
  const agents = agentsRaw ?? [];
  const workflows = workflowsRaw ?? [];

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
        onSelect={setCurrentConversation}
        onCreate={createConversation}
        onDelete={deleteConversation}
      />

      {/* Main Chat Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {currentConversation ? (
          <>
            <ChatHeader
              title={currentConversation.title}
              mode={mode}
              selectedAgent={selectedAgent}
              selectedWorkflow={selectedWorkflow}
              workflows={workflows}
              processingMessage={processingMessage}
              onRefresh={() => {
                void loadMessages(currentConversation.id);
              }}
              onCancelStream={() => stopPolling()}
            />

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