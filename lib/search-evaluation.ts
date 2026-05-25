import type { SearchMode } from "./knowledge.ts";
import { createSampleNotes, findRelevantNotes } from "./knowledge.ts";

type SearchEvaluationCase = {
  id: string;
  query: string;
  expectedTitle: string;
  focus: string;
};

type SearchEvaluationResult = {
  mode: SearchMode;
  cases: Array<{
    query: string;
    expectedTitle: string;
    focus: string;
    topTitles: string[];
    top1Hit: boolean;
    top3Hit: boolean;
  }>;
  top1Accuracy: number;
  top3Accuracy: number;
};

const evaluationCases: SearchEvaluationCase[] = [
  {
    id: "rag-grounding",
    query: "RAGでハルシネーションを減らすには？",
    expectedTitle: "RAGでハルシネーションを減らす方法",
    focus: "RAGの根拠提示",
  },
  {
    id: "note-writing",
    query: "メモをあとから検索しやすくする書き方は？",
    expectedTitle: "メモを検索しやすくする書き方",
    focus: "検索されやすいメモ設計",
  },
  {
    id: "product-retention",
    query: "学習メモを継続利用しやすくする機能は？",
    expectedTitle: "個人ナレッジ検索の改善アイデア",
    focus: "継続利用のための機能",
  },
  {
    id: "search-evaluation",
    query: "検索精度や評価方法を確認したい",
    expectedTitle: "検索結果を評価するときの観点",
    focus: "検索評価",
  },
  {
    id: "source-citation",
    query: "引用元を画面に表示する理由",
    expectedTitle: "RAGでハルシネーションを減らす方法",
    focus: "引用表示",
  },
  {
    id: "embedding-vs-keyword",
    query: "Embedding検索とキーワード検索はどう使い分ける？",
    expectedTitle: "Embedding検索とキーワード検索の使い分け",
    focus: "検索方式の使い分け",
  },
  {
    id: "privacy",
    query: "個人メモを外部APIに送るときの注意点",
    expectedTitle: "ローカルファーストで扱う個人メモの注意点",
    focus: "プライバシー",
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
