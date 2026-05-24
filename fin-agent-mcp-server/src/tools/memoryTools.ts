import { ToolRegistration } from "../types.js";
import { recallMemory, autoLogAnalysis, verifyOutcome, getExperienceSummary, addRule, listRules, updateRuleAccuracy } from "../memory/memoryStore.js";

export function registerMemoryRecall(): ToolRegistration {
  return {
    name: "memory_recall",
    description:
      "查询某个标的的历史判断记录，同时返回近7天经验总结。每次分析前调用。参数: symbol, limit(可选,默认5)",
    inputSchema: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "股票代码",
        },
        limit: {
          type: "number",
          description: "返回条数，默认 5",
          default: 5,
        },
      },
      required: ["symbol"],
    },
    handler: async (request: any) => {
      const args = request.params.arguments || {};
      const symbol = args.symbol;
      const limit = args.limit || 5;

      try {
        const results = recallMemory(symbol, limit);
        const summary = getExperienceSummary(7);
        return {
          content: [{ type: "text", text: JSON.stringify({ recall: results, experience_context: summary }, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
          isError: true,
        };
      }
    },
  };
}

export function registerMemoryVerify(): ToolRegistration {
  return {
    name: "memory_verify",
    description:
      "事后验证：输入 analysis_id 和当前实际价格，自动对比判断是否正确，写入 market_outcomes。参数: analysis_id, actual_price",
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
    handler: async (request: any) => {
      const args = request.params.arguments || {};

      try {
        const result = verifyOutcome(args.analysis_id, args.actual_price);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
          isError: true,
        };
      }
    },
  };
}

export function registerExperienceSummary(): ToolRegistration {
  return {
    name: "experience_summary",
    description:
      "输出近N天命中率、信号源准确率、有效经验规则。周度复盘时调用。参数: days(可选,默认7)",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "回顾天数，默认 7",
          default: 7,
        },
      },
    },
    handler: async (request: any) => {
      const args = request.params.arguments || {};
      const days = args.days || 7;

      try {
        const text = getExperienceSummary(days);
        return {
          content: [{ type: "text", text: JSON.stringify({ summary: text }, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
          isError: true,
        };
      }
    },
  };
}

export function registerRuleManage(): ToolRegistration {
  return {
    name: "rule_manage",
    description:
      "管理经验规则。action: add(新增规则) | list(列出所有) | update(更新命中/失误计数)。参数: action, rule, confidence, rule_id, was_correct",
    inputSchema: {
      type: "object",
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
          description: "置信度 0-1（add时可选，默认0.5）",
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
    handler: async (request: any) => {
      const args = request.params.arguments || {};

      try {
        switch (args.action) {
          case "add":
            addRule(args.rule!, args.confidence || 0.5);
            return { content: [{ type: "text", text: JSON.stringify({ status: "rule_added", rule: args.rule }) }] };
          case "list":
            return { content: [{ type: "text", text: JSON.stringify({ rules: listRules() }, null, 2) }] };
          case "update":
            updateRuleAccuracy(args.rule_id!, args.was_correct!);
            return { content: [{ type: "text", text: JSON.stringify({ status: "updated" }) }] };
          default:
            throw new Error(`unknown action: ${args.action}`);
        }
      } catch (err: any) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
          isError: true,
        };
      }
    },
  };
}