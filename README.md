# Personal Knowledge AI

自分のメモを登録し、質問に対して根拠付きで回答する個人向けナレッジ検索AIです。

単なるチャットUIではなく、RAGの基本設計である「検索」「根拠抽出」「回答生成」「引用表示」「検索評価」を見せるためのMVPです。

## Features

- メモ登録
- タグ管理
- ローカル保存
- ハイブリッド検索
- 簡易ベクトル検索
- Transformers.jsによるローカルEmbedding検索
- 関連メモのスコア表示
- 検索スコアの内訳表示
- 根拠スニペットの表示
- 質問履歴
- OpenAI APIキーがある場合の回答生成
- APIキーがない場合のローカル回答フォールバック
- 検索評価スクリプト

## Tech Stack

- Next.js
- React
- TypeScript
- Transformers.js
- OpenAI API
- Zod
- Global CSS

## Getting Started

```bash
npm install
npm run dev
```

PowerShellで `npm` が実行ポリシーにより止まる場合は、Windowsのnpm実体である `npm.cmd` を使います。

```bash
npm.cmd install
npm.cmd run dev
```

OpenAI APIで回答生成したい場合は `.env.local` を作成し、以下を設定します。

```env
OPENAI_API_KEY=your_api_key
```

APIキーが未設定でも、検索結果をもとにしたローカル回答で動作します。

## Search Design

検索方式は画面上で切り替えられます。

- `hybrid`: 既定の検索方式。BM25風スコア、タイトル・タグの重み付け、日本語n-gram、簡易ベクトルを組み合わせます。
- `simple-vector`: ハッシュベクトルとコサイン類似度による軽量な比較用検索です。
- `local-embedding`: Transformers.jsでローカルEmbeddingを作り、質問とメモのコサイン類似度で検索します。

ローカルEmbedding検索は `Xenova/paraphrase-multilingual-MiniLM-L12-v2` を使います。初回実行時はモデルの読み込みに時間がかかります。

RAGの検索、根拠抽出、回答生成、評価の契約は [docs/rag-contract.md](docs/rag-contract.md) にまとめています。

## Search Evaluation

検索品質は以下で確認できます。

```bash
npm.cmd run eval:search
```

評価スクリプトは、固定の質問と期待ノートに対して Top1 / Top3 の命中率を出します。検索ロジックを変更したときは、この数値が落ちていないか確認してください。

## Next Improvements

1. メモをチャンク分割する
2. Embeddingのキャッシュを永続化する
3. SQLite + sqlite-vecに保存する
4. 検索結果の再ランキングを追加する
5. 回答品質を評価するテストデータを作る
6. ログイン、ワークスペース、権限管理を追加してSaaS化する
7. 利用量制限とAIコスト見積もりを追加する
