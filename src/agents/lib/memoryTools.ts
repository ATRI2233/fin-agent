import { ToolRegistration } from "./types.js";

/** Wraps a handler function with standardized error handling */
function wrapHandler<T>(handlerFn: (args: Record<string, any>) => T) {
  return (request: any) => {
    const args = request.params.arguments || {};
    try {
      const result = handlerFn(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
    }
  };
}

export function registerMemoryRecall(): ToolRegistration {
  return {
    name: "memory_recall",
    description:
      "查询某个标的的历史判断记录，同时返回7天经验总结。每次分析前调用。参数: symbol, limit(可选，默认5)",
    inputSchema: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "股票代码",
        },
        limit: {
          type: "number",
          description: "返回条数，默认5",
          default: 5,
        },
      },
      required: ["symbol"],
    },
    handler: wrapHandler((args) => {
      const symbol = args.symbol;
      const limit = args.limit || 5;
      return { recall: [], experience_context: "[记忆系统已关闭]" };
    }),
  };
}

export function registerMemoryVerify(): ToolRegistration {
  return {
    name: "memory_verify",
    description:
      "事后验证：输入: analysis_id 和当前实际价格，自动对比判断是否正确，写入market_outcomes。参数: analysis_id, actual_price",
    inputSchema: {
      type: "object",
      properties: {
        analysis_id: {
          type: "number",
          description: "分析记录 ID",
        },
        actual_price: {
          type: "number",
          description: "当前实际价格",
        },
      },
      required: ["analysis_id", "actual_price"],
    },
    handler: wrapHandler((args) => {
      return { analysis_id: args.analysis_id, was_correct: null, deviation_pct: null, skipped: true };
    }),
  };
}

export function registerExperienceSummary(): ToolRegistration {
  return {
    name: "experience_summary",
    description:
      "输出近N天命中率、信号源准确率、有效经验规则。周度复盘时调用。参数: days(可选，默认7)",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "回顾天数，默认7",
          default: 7,
        },
      },
    },
    handler: wrapHandler((args) => {
      const days = args.days || 7;
      return { summary: "[记忆系统已关闭]" };
    }),
  };
}

export function registerRuleManage(): ToolRegistration {
  return {
    name: "rule_manage",
    description:
      "管理经验规则。action: add(新增规则) | list(列出所有) | update(更新命中/失误计数)。参数: action, rule, confidence, rule_id, was_correct",
    inputSchema: {
      type: "object",
      if: {
        properties: { action: { const: "add" } },
        required: ["action"],
      },
      then: {
        required: ["rule"],
      },
      properties: {
        action: {
          type: "string",
          enum: ["add", "list", "update"],
          description: "操作类型",
        },
        rule: {
          type: "string",
          description: "规则内容（add时必填）",
        },
        confidence: {
          type: "number",
          description: "置信度0-1（add时可选，默认0.5）",
        },
        rule_id: {
          type: "number",
          description: "规则ID（update时必填）",
        },
        was_correct: {
          type: "boolean",
          description: "是否命中（update时必填）",
        },
      },
      required: ["action"],
    },
    handler: wrapHandler((args) => {
      switch (args.action) {
        case "list":
          return { rules: [] };
        case "add":
          return { status: "memory_disabled", rule: args.rule };
        case "update":
          return { status: "memory_disabled" };
        default:
          throw new Error(`unknown action: ${args.action}`);
      }
    }),
  };
}

export function registerMemorySave(): ToolRegistration {
  return {
    name: "memory_save",
    description: "保存当前分析结果到记忆系统。参数: symbol, direction, confidence, key_prices, reasons, source_signals",
    inputSchema: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "股票代码",
        },
        direction: {
          type: "string",
          enum: ["bullish", "bearish", "neutral"],
          description: "判断方向",
        },
        confidence: {
          type: "number",
          description: "置信度0-100",
        },
        key_prices: {
          type: "object",
          description: "关键价格 (支撑位/阻力位等)",
        },
        reasons: {
          type: "string",
          description: "判断理由",
        },
        source_signals: {
          type: "object",
          description: "来源信号 (各agent的分析结果)",
        },
      },
      required: ["symbol", "direction", "confidence"],
    },
    handler: wrapHandler((args) => {
      return { status: "memory_disabled", symbol: args.symbol };
    }),
  };
}
