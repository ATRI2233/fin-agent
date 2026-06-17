import React, { useState, useCallback } from 'react';
import { Card, Avatar, Tag, Space, Typography, Empty } from 'antd';
import {
  CrownOutlined,
  UserSwitchOutlined,
  CheckCircleFilled,
} from '@ant-design/icons';
import { Handle, Position, NodeProps } from '@xyflow/react';

const { Text } = Typography;

export interface DebateAgent {
  id: string;
  name: string;
  avatar?: string;
  color: string;
  status?: 'idle' | 'thinking' | 'speaking' | 'finished';
}

export interface DebateBlockData {
  agents: DebateAgent[];
  judge: DebateAgent;
  winnerId?: string;
  prompt?: string;
  onAgentChange?: (slotIndex: number, agent: DebateAgent) => void;
  onJudgeChange?: (agent: DebateAgent) => void;
  onPromptChange?: (prompt: string) => void;
  [key: string]: unknown;
}

const AGENT_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f59e0b', // amber
];

const STATUS_COLORS: Record<string, string> = {
  idle: '#6B6B6B',
  thinking: '#8B9DC3',
  speaking: '#6B8E7B',
  finished: '#A0A0A0',
};

const STATUS_LABELS: Record<string, string> = {
  idle: '待机',
  thinking: '思考中',
  speaking: '发言中',
  finished: '已完成',
};

interface AgentSlotProps {
  agent: DebateAgent;
  index: number;
  isWinner?: boolean;
  onChange?: (agent: DebateAgent) => void;
}

const AgentSlot: React.FC<AgentSlotProps> = ({
  agent,
  index,
  isWinner,
  onChange,
}) => {
  const handleClick = useCallback(() => {
    onChange?.(agent);
  }, [agent, onChange]);

  return (
    <Card
      hoverable
      onClick={handleClick}
      style={{
        width: 160,
        textAlign: 'center',
        border: isWinner ? '2px solid #C4A882' : '1px solid rgba(255,255,255,0.10)',
        borderRadius: 12,
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        position: 'relative',
        overflow: 'visible',
      }}
      styles={{
        body: {
          padding: '16px 12px',
        },
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        id={`agent-${index}`}
        style={{
          background: agent.color,
          border: '3px solid #1A1A1A',
          width: 16,
          height: 16,
          top: -8,
          borderRadius: '50%',
        }}
      />

      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Avatar
          size={48}
          style={{
            backgroundColor: agent.color,
            margin: '0 auto',
          }}
        >
          {agent.name.charAt(0)}
        </Avatar>
        <Text strong style={{ fontSize: 14 }}>
          {agent.name}
        </Text>
        <Tag
          color={STATUS_COLORS[agent.status || 'idle']}
          style={{ margin: 0, fontSize: 11 }}
        >
          {STATUS_LABELS[agent.status || 'idle']}
        </Tag>
      </Space>

      <div
        style={{
          position: 'absolute',
          top: -8,
          right: -8,
          background: '#f59e0b',
          borderRadius: '50%',
          width: 24,
          height: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: isWinner ? 1 : 0,
          transform: isWinner ? 'scale(1)' : 'scale(0)',
          transition: 'all 0.3s ease',
        }}
      >
        <CheckCircleFilled style={{ color: '#1A1A1A', fontSize: 14 }} />
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: -24,
          left: '50%',
          transform: 'translateX(-50%)',
          opacity: 0,
          transition: 'opacity 0.2s',
        }}
        className="agent-slot-click-hint"
      >
        <UserSwitchOutlined style={{ color: '#6B6B6B' }} />
      </div>

      <style>{`
        .ant-card-hoverable:hover .agent-slot-click-hint {
          opacity: 1 !important;
        }
      `}</style>
    </Card>
  );
};

interface JudgeSlotProps {
  agent: DebateAgent;
  isWinner?: boolean;
  onChange?: (agent: DebateAgent) => void;
}

const JudgeSlot: React.FC<JudgeSlotProps> = ({ agent, isWinner, onChange }) => {
  return (
    <Card
      hoverable
      onClick={() => onChange?.(agent)}
      style={{
        width: 180,
        textAlign: 'center',
        border: isWinner ? '2px solid #C4A882' : '2px solid #C4A882',
        borderRadius: 12,
        cursor: 'pointer',
        background: 'rgba(196, 168, 130, 0.10)',
        transition: 'all 0.3s ease',
      }}
      styles={{
        body: {
          padding: '16px 12px',
        },
      }}
    >
      <Handle
        type="source"
        position={Position.Bottom}
        id="judge"
        style={{
          background: '#C4A882',
          border: '3px solid #1A1A1A',
          width: 16,
          height: 16,
          bottom: -8,
          borderRadius: '50%',
        }}
      />

      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <Avatar
            size={56}
            style={{
              backgroundColor: '#C4A882',
              margin: '0 auto',
            }}
          >
            {agent.name.charAt(0)}
          </Avatar>
          <CrownOutlined
            style={{
              position: 'absolute',
              top: -12,
              left: '50%',
              transform: 'translateX(-50%)',
              fontSize: 20,
              color: '#C4A882',
              background: '#1A1A1A',
              borderRadius: '50%',
              padding: 2,
            }}
          />
        </div>
        <Text strong style={{ fontSize: 14, color: '#C4A882' }}>
          {agent.name}
        </Text>
        <Tag color="orange" style={{ margin: 0, fontSize: 11 }}>
          裁判
        </Tag>
      </Space>
    </Card>
  );
};

interface DebateBlockProps extends NodeProps {
  data: DebateBlockData;
}

const DebateBlock: React.FC<DebateBlockProps> = ({ data }) => {
  const {
    agents = [],
    judge,
    winnerId,
    prompt = '',
    onAgentChange,
    onJudgeChange,
    onPromptChange,
  } = data;

  const [promptValue, setPromptValue] = useState(prompt);

  const handlePromptChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setPromptValue(value);
      onPromptChange?.(value);
    },
    [onPromptChange]
  );

  const handleAgentChange = useCallback(
    (index: number) => (agent: DebateAgent) => {
      onAgentChange?.(index, agent);
    },
    [onAgentChange]
  );

  if (agents.length === 0) {
    return (
      <Card
        style={{
          background: '#1A1A1A',
          border: '2px dashed rgba(255,255,255,0.10)',
          borderRadius: 16,
          minWidth: 400,
        }}
        styles={{ body: { padding: 24 } }}
      >
        <Empty description="添加辩论 Agent（2-4个）" />
      </Card>
    );
  }

  return (
    <div
      style={{
        background: '#1A1A1A',
        borderRadius: 16,
        padding: 24,
        minWidth: 500,
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      }}
    >
      {/* Agent Slots Row */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 16,
          marginBottom: 32,
          position: 'relative',
        }}
      >
        {agents.map((agent, index) => (
          <div key={agent.id} style={{ position: 'relative' }}>
            <AgentSlot
              agent={agent}
              index={index}
              isWinner={winnerId === agent.id}
              onChange={handleAgentChange(index)}
            />

            {/* Arrow to judge */}
            {index < agents.length && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 2,
                  height: 24,
                  background: `linear-gradient(to bottom, ${AGENT_COLORS[index % AGENT_COLORS.length]}, #C4A882)`,
                }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Arrows Section */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          marginBottom: 8,
        }}
      >
        <svg width="40" height="20" viewBox="0 0 40 20">
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="#C4A882" />
            </marker>
          </defs>
          <line
            x1="20"
            y1="0"
            x2="20"
            y2="15"
            stroke="#C4A882"
            strokeWidth="2"
            markerEnd="url(#arrowhead)"
          />
        </svg>
      </div>

      {/* Judge Slot */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <JudgeSlot agent={judge} isWinner={winnerId === judge.id} onChange={onJudgeChange} />
      </div>

      {/* Winner Highlight Animation */}
      {winnerId && (
        <div
          style={{
            textAlign: 'center',
            marginTop: 16,
            animation: 'pulse 2s infinite',
          }}
        >
          <Tag color="gold" style={{ fontSize: 12 }}>
            胜者: {agents.find((a) => a.id === winnerId)?.name || judge.name}
          </Tag>
        </div>
      )}

      {/* Prompt Editor */}
      <div style={{ marginTop: 24 }}>
        <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
          辩论提示词
        </Text>
        <textarea
          value={promptValue}
          onChange={handlePromptChange}
          placeholder="输入辩论主题或问题..."
          style={{
            width: '100%',
            minHeight: 80,
            padding: 12,
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.10)',
            fontSize: 14,
            fontFamily: 'inherit',
            resize: 'vertical',
            outline: 'none',
            transition: 'border-color 0.2s',
          }}
          onFocus={(e) => (e.target.style.borderColor = '#6366f1')}
          onBlur={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.10)')}
        />
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
};

export default DebateBlock;

export const debateBlockNodeType = 'debateBlock';