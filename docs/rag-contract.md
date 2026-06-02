# RAG仕様書

## 目的

Personal Knowledge AI は、ユーザーが登録したメモを検索し、検索結果を根拠として質問に回答する local-first RAG notebook である。

この仕様書は、検索、根拠抽出、回答生成、フォールバック、評価の契約を固定する。AIエージェントや開発者が実装を変更するときは、この契約を壊していないか確認する。

## 基本フロー

```text
Question
  -> Split notes into chunks
  -> Rank chunks
  -> Extract snippets
  -> Generate answer
  -> Show answer with cited sources
```

## 入力

質問は1文字以上の文字列とする。

メモは以下の構造を持つ。

```ts
type KnowledgeNote = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
};
```

タイトルと本文は検索対象に必ず含める。タグも検索対象に含め、タイトルとタグは本文より強く扱う。

## 検索モード

### hybrid

既定の検索方式。以下を組み合わせてスコアリングする。

- BM25風の語彙一致
- タイトル、タグ、本文の重み付け
- 日本語文字 n-gram
- ハッシュベクトルによる軽量な類似度
- 完全一致やタイトル/タグ一致の補助スコア

このモードはCIで品質ゲートとして扱う。

### simple-vector

ハッシュベクトルとコサイン類似度による比較用検索。

軽量で外部モデルを必要としないが、既定の検索品質保証対象は `hybrid` とする。

### local-embedding

Transformers.js の `Xenova/paraphrase-multilingual-MiniLM-L12-v2` を使い、質問とメモのEmbedding類似度で検索する。

初回モデルロード、キャッシュ、実行環境の影響を受けるため、CI必須の検証対象にはしない。失敗時はUIで分かるメッセージを出し、他の検索方式を試せる状態を維持する。

## 検索結果

検索結果は `RagResult` として返す。

```ts
type RagResult = {
  note: KnowledgeNote;
  chunk: KnowledgeChunk;
  score: number;
  snippet: string;
  searchMode: SearchMode;
  scoreBreakdown: {
    lexical: number;
    vector: number;
    phrase: number;
  };
};
```

`chunk` は検索で実際に一致した本文範囲を表す。`note` はタイトル、タグ、削除操作などメモ単位の情報を維持するために残す。

`score` は表示用の関連度であり、検索モード間で絶対比較しない。UIではパーセント表示できるが、品質判定では評価ケースを使う。

`snippet` は回答根拠として表示する短い本文抜粋である。質問語に近い文を優先し、長すぎる場合は省略する。

## 回答生成

回答は、検索で選ばれた根拠メモだけを使って生成する。

OpenAI APIを使う場合の契約:

- モデルには質問、根拠メモのタイトル、タグ、該当チャンク本文のみを渡す。
- システム指示では、日本語で簡潔に回答し、根拠が不足する場合は不足を明示させる。
- 根拠にない内容を断定しない。

APIキーが未設定、またはOpenAI呼び出しが失敗した場合:

- `mode: "local"` を返す。
- 検索結果をもとにしたローカル回答を返す。
- アプリ全体をエラー停止させない。

## プライバシー

このアプリは local-first を前提とする。

- メモはブラウザのlocalStorageに保存する。
- OpenAI APIへ送る内容は、質問と検索で選ばれた根拠メモに限定する。
- 将来ログを追加する場合、メモ本文を外部ログにそのまま送らない。
- 同期、共有、エクスポート、削除、権限管理を追加する場合は、先に仕様を更新する。

## 評価

検索品質は `npm.cmd run eval:search` で確認する。

現時点の品質ゲート:

- Top1 accuracy: 80%以上
- Top3 accuracy: 100%

評価ケースは読みやすい日本語の質問と期待タイトルで構成する。検索ロジック、サンプルノート、トークナイズ、スコア重みを変更した場合は、同じ評価セットで比較する。

評価値が落ちた場合:

- 意図しない劣化なら実装を修正する。
- 仕様変更による期待値変更なら、評価ケースとこの仕様書を更新する。

## 受け入れ基準

RAGまわりの変更は、最低限以下を満たす。

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run eval:search
```

さらに、変更内容に応じて次を確認する。

- 検索ロジック変更: 評価結果のTop1/Top3が基準を満たす。
- 回答生成変更: APIキーなしでもローカル回答が返る。
- UI変更: 根拠メモ、スコア、検索方式が読める。
- データ移行変更: ユーザーが追加したメモを消さない。
