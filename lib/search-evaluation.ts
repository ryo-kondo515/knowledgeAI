import type { SearchMode } from "./knowledge.ts";
import { createSampleNotes, findRelevantNotes } from "./knowledge.ts";

type SearchEvaluationCase = {
  query: string;
  expectedTitle: string;
};

type SearchEvaluationResult = {
  mode: SearchMode;
  cases: Array<{
    query: string;
    expectedTitle: string;
    topTitles: string[];
    top1Hit: boolean;
    top3Hit: boolean;
  }>;
  top1Accuracy: number;
  top3Accuracy: number;
};

const evaluationCases: SearchEvaluationCase[] = [
  {
    query: "RAGでハルシネーションを減らすには？",
    expectedTitle: "RAGでハルシネーションを減らす方法",
  },
  {
    query: "メモをあとから検索しやすくする書き方は？",
    expectedTitle: "メモを検索しやすくする書き方",
  },
  {
    query: "学習メモを継続利用しやすくする機能は？",
    expectedTitle: "個人ナレッジ検索の改善アイデア",
  },
  {
    query: "検索精度や評価方法を確認したい",
    expectedTitle: "検索結果を評価するときの観点",
  },
  {
    query: "引用元を画面に表示する理由",
    expectedTitle: "RAGでハルシネーションを減らす方法",
  },
  {
    query: "Embedding検索とキーワード検索はどう使い分ける？",
    expectedTitle: "Embedding検索とキーワード検索の使い分け",
  },
  {
    query: "個人メモを外部APIに送るときの注意点",
    expectedTitle: "ローカルファーストで扱う個人メモの注意点",
  },
];

export function evaluateSearch(mode: SearchMode = "hybrid"): SearchEvaluationResult {
  const notes = createSampleNotes();
  const cases = evaluationCases.map((testCase) => {
    const topTitles = findRelevantNotes(testCase.query, notes, 3, { mode }).map((result) => result.note.title);
    const top1Hit = topTitles[0] === testCase.expectedTitle;
    const top3Hit = topTitles.includes(testCase.expectedTitle);

    return {
      ...testCase,
      topTitles,
      top1Hit,
      top3Hit,
    };
  });

  return {
    mode,
    cases,
    top1Accuracy: calculateAccuracy(cases.map((testCase) => testCase.top1Hit)),
    top3Accuracy: calculateAccuracy(cases.map((testCase) => testCase.top3Hit)),
  };
}

function calculateAccuracy(results: boolean[]) {
  return results.filter(Boolean).length / Math.max(results.length, 1);
}
