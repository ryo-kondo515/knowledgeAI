# AI駆動開発ハーネス設計

## 目的

このリポジトリを、AIエージェントが調査、実装、検証、修正を安全に回せる開発環境にする。

対象アプリは `Personal Knowledge AI`。個人メモを登録し、検索結果を根拠として回答する local-first RAG notebook である。AI駆動開発の品質は、モデル単体ではなく、仕様、文脈、検証、復旧手段を含むハーネスで担保する。

## 現状

### 既存の強み

- Next.js、React、TypeScript の小さな構成で、AIが全体像を把握しやすい。
- 検索ロジックが `lib/knowledge.ts` に集約されている。
- `scripts/evaluate-search.ts` と `lib/search-evaluation.ts` に検索品質の評価ハーネスがある。
- `npm.cmd run build`、`npm.cmd run lint`、`npm.cmd run eval:search` で最低限の検証が可能。
- OpenAI API が未設定でもローカル回答にフォールバックする設計になっている。

### 現在のリスク

- README、サンプルノート、画面文言、ローカル回答文に文字化けがある。
- 検索評価はあるが、API契約、ローカルストレージ移行、回答生成のテストが未整備。
- AIエージェント向けの作業手順、変更範囲、検証コマンド、受け入れ基準が文書化されていない。
- local embedding は初回モデルロードやネットワーク/キャッシュ状態に影響されるため、CIの必須検証には向かない。
- 仕様と実装がREADMEに依存しているが、README自体が信頼できない状態になっている。

## ハーネス全体像

```text
Human steer
  - ゴール
  - 変更してよい範囲
  - 品質基準
  - 優先順位

Agent execute
  - Gather: 仕様、コード、既存評価を読む
  - Act: 小さく実装する
  - Verify: lint/build/test/eval を実行する
  - Repair: 失敗原因を特定して修正する

Harness enforce
  - 仕様ドキュメント
  - テスト
  - 検索評価
  - CI
  - ログ
  - Git差分
  - ロールバック
```

## 設計方針

### 1. 仕様をコードと同じ扱いにする

AIが最初に読むべき仕様を `docs/` に置く。

推奨ドキュメント:

- `docs/product-spec.md`
  - このアプリが何をするか
  - 対象ユーザー
  - 主要ユースケース
  - 非目標
- `docs/rag-contract.md`
  - 検索モードの意味
  - スコアの扱い
  - 回答が守るべきルール
  - 外部APIに送ってよい情報
- `docs/ai-development-harness.md`
  - AIエージェントの作業手順
  - 検証コマンド
  - 変更時の受け入れ基準
- `docs/decision-log.md`
  - 検索方式、永続化、API利用方針などの設計判断

READMEは利用者向け、`docs/` は開発者/AI向けに分ける。

### 2. Gather -> Act -> Verify を標準ループにする

AIエージェントはすべての変更で次の順序を守る。

#### Gather

- `package.json` で利用可能な検証コマンドを確認する。
- 変更対象に近いファイルを読む。
- 関連仕様があれば `docs/` を読む。
- 既存のテスト/評価がある場合は、先に期待値を確認する。

#### Act

- 変更を小さく分ける。
- 検索、回答、UI、永続化、文言修正を混ぜすぎない。
- APIレスポンスや型を変える場合は、呼び出し側も同時に確認する。

#### Verify

標準検証:

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run eval:search
```

変更内容別の追加検証:

- 検索ロジック変更: `npm.cmd run eval:search` のTop1/Top3を必ず比較する。
- UI変更: ローカルサーバーで画面確認する。
- API変更: 正常系、不正入力、フォールバックを確認する。
- ドキュメント変更: コードと矛盾していないか確認する。

#### Repair

- 失敗したコマンド、失敗理由、修正内容を記録する。
- 評価値が落ちた場合は、意図した仕様変更かバグかを判断する。
- 意図した仕様変更なら評価ケースも更新する。

### 3. テストを仕様ハーネスにする

優先して追加するテストは以下。

#### Unit tests

対象:

- `lib/knowledge.ts`
- `lib/search-evaluation.ts`

観点:

- 空クエリでは結果を返さない。
- title/tag/content の重みが検索順位に反映される。
- `summarizeNote` が最大長を守る。
- `extractSnippet` が関連文を優先する。
- `evaluateSearch("hybrid")` が最低基準を満たす。

推奨:

- Node標準の `node:test` か Vitest を導入する。
- まずは依存追加なしの `node:test` で開始してよい。

#### API contract tests

対象:

- `app/api/answer/route.ts`
- `app/api/search/embedding/route.ts`

観点:

- 不正リクエストは400。
- `OPENAI_API_KEY` 未設定時は `mode: "local"`。
- OpenAI呼び出し失敗時もローカル回答にフォールバックする。
- local embedding の失敗時は503。

#### UI smoke tests

対象:

- `app/page.tsx`

観点:

- 初期メモが表示される。
- メモを追加できる。
- 質問すると根拠カードが表示される。
- メモ削除後に回答根拠も更新される。

E2Eは後でよい。最初は主要操作だけをPlaywrightで固定する。

### 4. 検索評価を品質ゲートにする

既存の `eval:search` をこのプロジェクトの中核Verifyにする。

現在の基準:

- Top1 accuracy >= 80%
- Top3 accuracy = 100%

改善案:

- 評価ケースを `fixtures/search-evaluation.json` に分離する。
- 評価結果をJSONでも出力できるようにする。
- 検索モード別に評価する。
  - `hybrid`: CI必須
  - `simple-vector`: 参考
  - `local-embedding`: ローカル任意
- 評価ケースに日本語の正常な文章を使う。
- 文字化けデータは移行テストとして別管理する。

### 5. 文字化け修復を最初の品質改善にする

現在のリポジトリでは、日本語文言が広範囲で文字化けしている。

優先修復対象:

1. `README.md`
2. `lib/knowledge.ts` のサンプルノート
3. `lib/search-evaluation.ts` の評価ケース
4. `app/page.tsx` の画面文言
5. `app/api/answer/route.ts` のフォールバック回答

修復時の受け入れ基準:

- `npm.cmd run lint` が通る。
- `npm.cmd run build` が通る。
- `npm.cmd run eval:search` が通る。
- 画面上の主要文言が日本語として読める。
- 既存localStorageに古い文字化けサンプルが残っても移行できる。

### 6. コンテキスト管理を明示する

AIに毎回全ファイルを読ませない。入口を決める。

変更対象別の読む順序:

| 目的 | 最初に読む | 次に読む |
| --- | --- | --- |
| 検索品質改善 | `lib/knowledge.ts` | `lib/search-evaluation.ts`, `scripts/evaluate-search.ts` |
| 回答品質改善 | `app/api/answer/route.ts` | `app/page.tsx`, `docs/rag-contract.md` |
| UI改善 | `app/page.tsx` | `app/globals.css`, `app/layout.tsx` |
| local embedding | `app/api/search/embedding/route.ts` | `lib/knowledge.ts` |
| ドキュメント | `README.md` | `docs/*.md`, `package.json` |

この表をAI作業手順に含めることで、無駄な全文再読を減らす。

### 7. 安全設計

#### Git

- 変更は小さな単位で分ける。
- AIは既存の未コミット変更を勝手に戻さない。
- 仕様変更、ロジック変更、UI変更、評価データ変更は可能なら別コミットにする。

#### 外部API

- `OPENAI_API_KEY` がない状態でも開発できることを維持する。
- OpenAIに送る内容は、質問と検索で選ばれた根拠メモに限定する。
- 将来ログを追加する場合、メモ本文をそのまま外部ログに出さない。

#### localStorage

- 破壊的なスキーマ変更は移行関数を通す。
- サンプルデータの更新は、ユーザーが追加したメモを消さない。

#### local embedding

- CI必須にしない。
- モデルロード失敗時のUIフォールバックを維持する。
- キャッシュ/初回ロード時間をユーザーに見える状態として扱う。

## CI設計

GitHub Actionsを使う場合の最小構成:

```yaml
name: verify

on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: npm run eval:search
```

Windows開発では `npm.cmd` を使い、CIでは `npm` を使う。

## 実装ロードマップ

### Phase 1: 基礎ハーネス

- 文字化けを修復する。
- `docs/product-spec.md` と `docs/rag-contract.md` を追加する。
- `eval:search` を正常な日本語ケースに更新する。
- `npm.cmd run lint`、`npm.cmd run build`、`npm.cmd run eval:search` を標準検証として固定する。

### Phase 2: テストハーネス

- `node:test` か Vitest を導入する。
- `lib/knowledge.ts` のユニットテストを追加する。
- `/api/answer` のフォールバック契約テストを追加する。
- `npm.cmd test` を追加する。

### Phase 3: CIハーネス

- GitHub Actionsで lint/build/eval/test を実行する。
- PRテンプレートに「実行した検証」「影響範囲」「評価値」を追加する。
- 評価結果をJSON出力し、差分比較できるようにする。

### Phase 4: 運用ハーネス

- 回答ログと検索ログを追加する。
- ただし本文の外部送信や永続化は明示的に制御する。
- 検索失敗、回答失敗、embedding失敗をUIで区別する。
- 仕様変更は `docs/decision-log.md` に残す。

## AIエージェント向け作業ルール

AIがこのリポジトリで作業する時は、次を守る。

1. まず `package.json` と変更対象の近接ファイルを読む。
2. 検索・回答・UI・ドキュメントを一度に大きく混ぜない。
3. 検索順位に影響する変更では `npm.cmd run eval:search` を必ず実行する。
4. 画面文言を変えたら、文字化けしていないことを確認する。
5. 外部APIがなくても動く性質を壊さない。
6. ユーザーのlocalStorageデータを消す変更をしない。
7. 検証できなかった項目は、最終報告で明示する。

## 完了条件

このハーネス設計が機能している状態は、次で判断する。

- 新しい開発者またはAIエージェントが、どのファイルを読めばよいか分かる。
- 変更後に最低限どのコマンドを実行すべきか分かる。
- 検索品質が数値で劣化検知できる。
- APIキーなしでも開発と検証ができる。
- 仕様、評価、実装が矛盾しにくい。
- 失敗時にGit差分と検証ログから原因を追える。
