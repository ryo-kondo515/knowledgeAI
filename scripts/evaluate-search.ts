import { evaluateSearch } from "../lib/search-evaluation.ts";

const result = evaluateSearch("hybrid");

console.log(`Search mode: ${result.mode}`);
console.log(`Top1 accuracy: ${formatPercent(result.top1Accuracy)}`);
console.log(`Top3 accuracy: ${formatPercent(result.top3Accuracy)}`);
console.log("");

for (const testCase of result.cases) {
  const status = testCase.top1Hit ? "PASS" : testCase.top3Hit ? "PARTIAL" : "FAIL";

  console.log(`[${status}] ${testCase.query}`);
  console.log(`  expected: ${testCase.expectedTitle}`);
  console.log(`  actual:   ${testCase.topTitles.join(" > ") || "(no results)"}`);
}

if (result.top1Accuracy < 0.8 || result.top3Accuracy < 1) {
  process.exitCode = 1;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}
