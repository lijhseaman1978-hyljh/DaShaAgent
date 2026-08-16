// agent/reflection/evaluator.ts
// Evaluator 评价器：判断结果是否达到目标。
// 计划书 Step 4-五：创建 Evaluator

import { calculateScore, type QualityScore } from './qualityScore';

export interface Evaluation {
  task: any;
  result: any;
  score: QualityScore;
  pass: boolean;
}

export class Evaluator {
  evaluate(task: any, result: any): Evaluation {
    const score = calculateScore(result);
    return {
      task,
      result,
      score,
      pass: score.overall >= 0.8,
    };
  }
}
