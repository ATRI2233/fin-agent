/** Generic renderer — JSON preview fallback for unrecognized data types. */

import type { RendererProps } from './index';

function formatContent(content: unknown): string {
  if (content === null || content === undefined) return '—';
  let obj: unknown;
  if (typeof content === 'string') {
    try {
      obj = JSON.parse(content);
    } catch {
      obj = content;
    }
  } else {
    obj = content;
  }
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return '[Data too large to display]';
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
