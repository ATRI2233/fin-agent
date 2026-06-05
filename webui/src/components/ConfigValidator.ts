export interface ValidationResult {
  valid: boolean;
  error?: string;
  line?: number;
  column?: number;
}

export function validateConfig(content: string): ValidationResult {
  if (!content || content.trim() === '') {
    return { valid: false, error: 'Configuration content is empty' };
  }

  try {
    JSON.parse(content);
    return { valid: true };
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      const match = err.message.match(/position\s+(\d+)/);
      if (match) {
        const pos = parseInt(match[1], 10);
        const lines = content.substring(0, pos).split('\n');
        return {
          valid: false,
          error: err.message,
          line: lines.length,
          column: lines[lines.length - 1].length + 1,
        };
      }
      return { valid: false, error: err.message };
    }
    return { valid: false, error: 'Unknown validation error' };
  }
}
