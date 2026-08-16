// agent/reflection/qualityScore.ts
// Quality Score 评分系统：把结果量化。
// 计划书 Step 4-四：创建 Quality Score

export interface QualityScore {
  accuracy: number;
  completeness: number;
  relevance: number;
  format: number;
  overall: number;
}

export function calculateScore(data: any): QualityScore {
  // 基础版：固定高分；未来接入 LLM 或规则评估。
  const score: QualityScore = {
    accuracy: 0.8,
    completeness: 0.8,
    relevance: 0.8,
    format: 0.8,
    overall: 0.8,
  };

  // 简单启发式：结果为空或过短 → 分数降低
  const text = typeof data === 'string' ? data : JSON.stringify(data || '');
  if (!text || text.length < 10) {
    score.completeness = 0.3;
    score.accuracy = 0.3;
  }

  score.overall = (score.accuracy + score.completeness + score.relevance + score.format) / 4;
  return score;
}
