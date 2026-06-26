// ── Exported stubs ──

export function autoLogAnalysis(result: {
  symbol: string;
  direction: string;
  confidence: number;
  key_prices?: any;
  reasons?: string;
  source_signals?: any;
}) {
  // no-op
}

export function recallMemory(symbol: string, limit = 5): any[] {
  return [];
}

export function verifyOutcome(analysisId: number, actualPrice: number) {
  return { analysis_id: analysisId, was_correct: null, deviation_pct: null };
}

export function getExperienceSummary(days = 7): string {
  return "[记忆系统已关闭]";
}

export function addRule(rule: string, confidence: number, source = "auto") {
  // no-op
}

export function updateRuleAccuracy(ruleId: number, wasCorrect: boolean) {
  // no-op
}

export function listRules(activeOnly = true): any[] {
  return [];
}

export function getSignalWeights(): any[] {
  return [];
}

export function getJudgments(symbol: string, limit = 10): any[] {
  return [];
}

export function getAllExperience(minConfidence = 0): any[] {
  return [];
}
