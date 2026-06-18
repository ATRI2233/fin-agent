/** Generic renderer — JSON preview fallback for unrecognized data types. */

import { Typography } from 'antd';
import type { RendererProps } from './index';

const { Text } = Typography;

function formatContent(content: unknown): string {
  if (content === null || content === undefined) return '—';
  try {
    const obj = typeof content === 'string' ? JSON.parse(content) : content;
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(content);
  }
}

export function GenericRenderer({ content }: RendererProps) {
  return (
    <pre
      style={{
        margin: 0,
        fontSize: 12,
        color: '#B0B0B0',
        maxHeight: 220,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
        lineHeight: 1.6,
      }}
    >
      {formatContent(content)}
    </pre>
  );
}
