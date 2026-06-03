# SQLite storage design for Issue #2

## 目的

Issue #2 では、現在 `localStorage` に保存しているメモを SQLite に移し、ブラウザや端末をまたいだ利用、バックアップ、将来的な同期に強い保存基盤を作る。

完了条件は次の通り。

- メモが SQLite に保存される
- 既存 UI からメモ登録・検索ができる
- `npm.cmd run build` が通る

この設計では、まず保存先を SQLite に移すことを優先する。検索アルゴリズム自体は既存の `lib/knowledge.ts` を活かし、DB から取得したメモ配列を既存検索関数に渡す。

## DB 設計の基礎

DB 設計では、保存したい情報をテーブルに分ける。

- テーブル: データの種類ごとの箱。例: `notes`, `tags`
- カラム: テーブル内の項目。例: `title`, `content`, `created_at`
- 行: 実際の 1 件分のデータ
- 主キー: 1 行を一意に識別する値。例: `notes.id`
- 外部キー: 別テーブルの行を参照する値。例: `note_tags.note_id`
- インデックス: 検索や並び替えを速くするための索引

今回の中心は「メモ」。ただし、メモは複数タグを持ち、同じタグは複数メモに付く。そのため、タグは `notes` に文字列配列として詰め込まず、`tags` と `note_tags` に分ける。

## 現在のデータ構造

現在のメモ型は次の形。

```ts
type KnowledgeNote = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
};
```

検索時は `createKnowledgeChunks(note)` によって本文をチャンクに分割している。DB 化後もこの考え方は維持し、検索用メタデータとしてチャンクを保存できるようにする。

## テーブル設計

### notes

メモ本体を保存する。

```sql
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

設計意図:

- `id` は既存の `crypto.randomUUID()` と相性がよいので `TEXT`
- `title` と `content` は必須
- `created_at` は既存の `createdAt` に対応
- `updated_at` は今後の編集機能に備えて追加する

### tags

タグ名を一意に保存する。

```sql
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
```

設計意図:

- 同じタグ名を重複保存しない
- タグ名変更やタグ一覧表示に拡張しやすい

### note_tags

メモとタグの関連を保存する中間テーブル。

```sql
CREATE TABLE note_tags (
  note_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (note_id, tag_id),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
```

設計意図:

- 1 つのメモに複数タグを付けられる
- 1 つのタグを複数メモで共有できる
- メモ削除時に関連タグ付けも自動削除する

### note_chunks

検索用に分割したメモ本文を保存する。

```sql
CREATE TABLE note_chunks (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  total_chunks INTEGER NOT NULL,
  content TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  searchable_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);
```

設計意図:

- `lib/knowledge.ts` の `KnowledgeChunk` に対応する
- 検索対象となるチャンク本文を保存する
- `searchable_text` には `title`, `tags`, `content` を結合した検索用テキストを保存する
- メモ更新時は、そのメモのチャンクを作り直す

## インデックス

最初に必要なインデックスは次の通り。

```sql
CREATE INDEX idx_notes_created_at ON notes(created_at);
CREATE INDEX idx_tags_name ON tags(name);
CREATE INDEX idx_note_tags_note_id ON note_tags(note_id);
CREATE INDEX idx_note_tags_tag_id ON note_tags(tag_id);
CREATE INDEX idx_note_chunks_note_id ON note_chunks(note_id);
```

設計意図:

- メモ一覧を作成日時順に出しやすくする
- タグ名から既存タグを探しやすくする
- メモに紐づくタグ・チャンクを取得しやすくする

## 初期実装で見送るもの

次の機能は重要だが、Issue #2 の初期実装では後回しにする。

- SQLite FTS5 による全文検索
- sqlite-vec などによるベクトル検索
- embedding ベクトルの永続化
- ユーザー認証、ワークスペース、権限管理
- 論理削除、削除履歴、復元

理由は、まず `localStorage` から SQLite へ保存先を移すことが目的だから。検索品質は既存の `findRelevantNotes()` で維持し、DB 検索最適化は次の段階で扱う。

## 将来の embedding 保存設計

embedding を保存する場合は、チャンク単位でモデル名とベクトルを保存する。

```sql
CREATE TABLE chunk_embeddings (
  chunk_id TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (chunk_id, model),
  FOREIGN KEY (chunk_id) REFERENCES note_chunks(id) ON DELETE CASCADE
);
```

設計意図:

- embedding はメモ全体ではなくチャンク単位で保存する
- モデルを変更しても再計算・比較できるように `model` を主キーに含める
- SQLite 標準だけで始めるなら `BLOB` 保存、ベクトル検索を行うなら sqlite-vec などを別途検討する

## API 設計

既存 UI を大きく壊さないため、まずは API で `KnowledgeNote[]` に近い形を返す。

### GET /api/notes

SQLite からメモ一覧を取得する。

レスポンス例:

```json
{
  "notes": [
    {
      "id": "uuid",
      "title": "RAG のメモ",
      "content": "本文",
      "tags": ["ai", "rag"],
      "createdAt": "2026-06-03T00:00:00.000Z"
    }
  ]
}
```

### POST /api/notes

メモを作成する。

リクエスト例:

```json
{
  "title": "RAG のメモ",
  "content": "本文",
  "tags": ["ai", "rag"]
}
```

処理内容:

1. `notes` にメモを保存する
2. `tags` に未登録タグを追加する
3. `note_tags` に関連を保存する
4. `createKnowledgeChunks()` でチャンクを作る
5. `note_chunks` に検索用チャンクを保存する

### DELETE /api/notes/:id

メモを削除する。

処理内容:

- `notes` から対象メモを削除する
- `ON DELETE CASCADE` により `note_tags` と `note_chunks` も削除される

### POST /api/search

DB のメモを使って検索する。

リクエスト例:

```json
{
  "question": "RAG の評価方法は？",
  "mode": "hybrid",
  "limit": 4
}
```

初期実装の処理:

1. SQLite から `KnowledgeNote[]` を取得する
2. 既存の `findRelevantNotes(question, notes, limit, { mode })` を呼ぶ
3. `RagResult[]` を返す

この方式なら、検索品質のロジックを大きく変えずに DB 化できる。

## localStorage からの移行

既存ユーザーのメモを消さないため、初回起動時にブラウザ側の `localStorage` を SQLite に送る。

対象キー:

```text
personal-knowledge-ai-notes
```

移行 API:

```text
POST /api/migrate/local-storage
```

リクエスト例:

```json
{
  "notes": [
    {
      "id": "uuid",
      "title": "既存メモ",
      "content": "本文",
      "tags": ["tag"],
      "createdAt": "2026-06-03T00:00:00.000Z"
    }
  ]
}
```

移行方針:

- 同じ `id` のメモが DB にある場合はスキップする
- `title` と `content` が空のメモは保存しない
- タグは空白を除去し、空文字は保存しない
- 移行成功後、ブラウザ側に移行済みフラグを保存する

移行済みフラグ案:

```text
personal-knowledge-ai-sqlite-migrated
```

初回移行後も、すぐに `localStorage` を削除しない。移行失敗や実装ミスに備え、一定期間は残す。

## データ取得の流れ

DB 化後の通常フロー。

```text
画面表示
  -> GET /api/notes
  -> SQLite から notes + tags を取得
  -> UI に表示

メモ登録
  -> POST /api/notes
  -> notes / tags / note_tags / note_chunks に保存
  -> GET /api/notes またはレスポンスで UI 更新

検索
  -> POST /api/search
  -> SQLite からメモ取得
  -> findRelevantNotes() で検索
  -> 結果を UI 表示
```

## 実装順序

1. SQLite ライブラリを決める
2. DB ファイルの保存場所を決める
3. スキーマ作成処理を追加する
4. `lib/db.ts` などに DB 接続処理を作る
5. `lib/note-repository.ts` などに保存・取得処理を作る
6. `/api/notes` を追加する
7. `/api/search` を追加する
8. UI の `localStorage` 読み書きを API 呼び出しに置き換える
9. localStorage 移行 API を追加する
10. `npm.cmd run build` を通す

## 受け入れ基準

Issue #2 の受け入れ基準は次のように確認する。

- 新規メモを登録すると SQLite に保存される
- 画面をリロードしても DB からメモが復元される
- メモ一覧でタグが表示される
- 既存 UI から検索できる
- メモ削除後、一覧と検索結果から消える
- localStorage の既存メモを DB に移行できる
- `npm.cmd run build` が成功する

## 判断メモ

最初から検索ロジックを SQL に寄せすぎると、Issue #2 の範囲が大きくなる。今回の第一段階では「永続化を SQLite に移す」ことに集中し、検索品質の改善やベクトル検索は次 Issue に分ける。

