/**
 * ChatInput — message composer (mode toggle + agent/workflow selector +
 * text area + send button).
 *
 * Extracted from `pages/ChatPage.tsx` (Wave 6.1b). The component is
 * fully controlled — every piece of UI state is owned by the parent
 * (`pages/ChatPage/index.tsx`) and threaded back in as props. The
 * component never fetches; it only emits intent (`onSend`,
 * `onModeChange`, `onInputChange`, …).
 *
 * Required props (per Wave 6.1b spec):
 *   - onSend           () => void                       — fired on click / Enter
 *   - agents           Agent[]                          — registry, for the agent <Select>
 *   - workflows        WorkflowMeta[]                   — registry, for the workflow <Select>
 *   - mode             'agent' | 'workflow'             — current mode
 *   - selectedAgent    string                           — current agent name
 *   - selectedWorkflow string | null                    — current workflow id
 *
 * Required controlling props (kept controlled to match parent state):
 *   - inputValue       string                           — textarea value
 *   - onInputChange    (value: string) => void          — textarea setter
 *   - onModeChange     (mode: 'agent' | 'workflow') => void
 *   - onAgentChange    (value: string) => void
 *   - onWorkflowChange (value: string) => void
 *   - processingMessage boolean                          — disable input + send
 *   - sendingMessage   boolean                          — loading spinner on send
 */
import { Button, Input, Select, Space } from 'antd';
import {
  BranchesOutlined,
  RobotOutlined,
  SendOutlined,
} from '@ant-design/icons';
import type { Agent } from '../../types/agent';
import type { WorkflowMeta } from '../../types/workflow';

const { TextArea } = Input;

export type ChatMode = 'agent' | 'workflow';

export interface ChatInputProps {
  onSend: () => void;
  onInputChange: (value: string) => void;
  inputValue: string;

  agents: Agent[];
  workflows: WorkflowMeta[];

  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;

  selectedAgent: string;
  onAgentChange: (value: string) => void;

  selectedWorkflow: string | null;
  onWorkflowChange: (value: string) => void;

  processingMessage: boolean;
  sendingMessage: boolean;
}

export default function ChatInput({
  onSend,
  onInputChange,
  inputValue,
  agents,
  workflows,
  mode,
  onModeChange,
  selectedAgent,
  onAgentChange,
  selectedWorkflow,
  onWorkflowChange,
  processingMessage,
  sendingMessage,
}: ChatInputProps) {
  return (
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
            onClick={() => onModeChange('agent')}
            style={{ flex: 1 }}
            icon={<RobotOutlined />}
          >
            Agent
          </Button>
          <Button
            type={mode === 'workflow' ? 'primary' : 'default'}
            onClick={() => onModeChange('workflow')}
            style={{ flex: 1 }}
            icon={<BranchesOutlined />}
          >
            Workflow
          </Button>
        </Space.Compact>

        {mode === 'agent' ? (
          <Select
            value={selectedAgent}
            onChange={onAgentChange}
            style={{ width: 250 }}
            options={agents.map((ag) => ({
              label: ag.name,
              value: ag.name,
            }))}
          />
        ) : (
          <Select
            value={selectedWorkflow ?? undefined}
            onChange={onWorkflowChange}
            style={{ width: 250 }}
            placeholder="Select workflow"
            options={workflows.map((wf) => ({
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
          onChange={(e) => onInputChange(e.target.value)}
          placeholder={
            mode === 'agent'
              ? 'Type your message...'
              : 'Describe what you want the workflow to do...'
          }
          autoSize={{ minRows: 1, maxRows: 4 }}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              onSend();
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
          onClick={onSend}
          loading={sendingMessage}
          disabled={processingMessage}
          style={{ height: 'auto' }}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
