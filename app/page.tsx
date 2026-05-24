"use client";

import { FormEvent, useState, useSyncExternalStore, useTransition } from "react";
import {
  KnowledgeNote,
  RagResult,
  SearchMode,
  createNote,
  createSampleNotes,
  findRelevantNotes,
  summarizeNote,
} from "@/lib/knowledge";

type AnswerState = {
  question: string;
  answer: string;
  sources: RagResult[];
  mode: "local" | "openai";
  searchMode: SearchMode;
};

const STORAGE_KEY = "personal-knowledge-ai-notes";
const STORAGE_EVENT = "personal-knowledge-ai-notes-updated";
const DEFAULT_NOTES = createSampleNotes();
const LEGACY_SAMPLE_TITLES = new Set([
  "AI SaaS縺ｮ繝昴・繝医ヵ繧ｩ繝ｪ繧ｪ縺ｧ隕九○縺溘＞險ｭ險・",
]);
const SEARCH_MODE_LABELS: Record<SearchMode, string> = {
  hybrid: "ハイブリッド検索",
  "simple-vector": "簡易ベクトル検索",
  "local-embedding": "ローカルEmbedding検索",
};

let cachedRaw: string | null = null;
let cachedNotes: KnowledgeNote[] = DEFAULT_NOTES;

export default function Home() {
  const notes = useSyncExternalStore(subscribeToNotes, getStoredNotes, getServerNotes);
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [content, setContent] = useState("");
  const [question, setQuestion] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("hybrid");
  const [answerState, setAnswerState] = useState<AnswerState | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleAddNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!title.trim() || !content.trim()) {
      setError("タイトルと本文を入力してください。");
      return;
    }

    updateStoredNotes((current) => [
      createNote({
        title,
        content,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      }),
      ...current,
    ]);
    setTitle("");
    setTags("");
    setContent("");
  }

  function handleAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!question.trim()) {
      setError("質問を入力してください。");
      return;
    }

    startTransition(async () => {
      let sources: RagResult[];

      try {
        sources = await findSources(question, notes, searchMode);
      } catch {
        setAnswerState({
          question,
          answer:
            "ローカルEmbedding検索に失敗しました。初回実行ではモデルの読み込みに時間がかかる場合があります。ハイブリッド検索または簡易ベクトル検索を試してください。",
          sources: [],
          mode: "local",
          searchMode,
        });
        return;
      }

      if (sources.length === 0) {
        setAnswerState({
          question,
          answer: "関連するメモが見つかりませんでした。メモを追加するか、別の聞き方を試してください。",
          sources: [],
          mode: "local",
          searchMode,
        });
        return;
      }

      const localAnswer = buildLocalAnswer(question, sources, searchMode);

      try {
        const response = await fetch("/api/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, sources }),
        });

        if (!response.ok) {
          throw new Error("AI回答の生成に失敗しました。");
        }

        const result = (await response.json()) as {
          answer: string;
          mode: "local" | "openai";
        };

        setAnswerState({
          question,
          answer: result.answer || localAnswer,
          sources,
          mode: result.mode,
          searchMode,
        });
      } catch {
        setAnswerState({
          question,
          answer: localAnswer,
          sources,
          mode: "local",
          searchMode,
        });
      }

      setHistory((current) => [question, ...current.filter((item) => item !== question)].slice(0, 6));
    });
  }

  function handleDeleteNote(noteId: string) {
    updateStoredNotes((current) => current.filter((note) => note.id !== noteId));
    setAnswerState((current) => {
      if (!current) {
        return null;
      }

      return {
        ...current,
        sources: current.sources.filter((source) => source.note.id !== noteId),
      };
    });
  }

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="Knowledge AI navigation">
        <div className="brand">
          <span className="app-icon">K</span>
          <div>
            <strong>Knowledge AI</strong>
            <small>RAG Notebook</small>
          </div>
        </div>
        <nav className="side-nav">
          <a className="selected" href="#ask">
            <span>Q</span>
            質問
          </a>
          <a href="#compose">
            <span>N</span>
            メモ
          </a>
          <a href="#evidence">
            <span>E</span>
            根拠
          </a>
          <a href="#library">
            <span>L</span>
            一覧
          </a>
        </nav>
      </aside>

      <section className="content">
        <header className="page-header">
          <div>
            <p className="eyebrow">Local-first RAG Notebook</p>
            <h1>Personal Knowledge AI</h1>
            <p className="lead">
              自分のメモを登録し、質問に対して根拠付きで回答する個人向けナレッジ検索AIです。
              回答だけでなく、どのメモが使われたか、検索スコアの内訳まで確認できます。
            </p>
          </div>
          <div className="stats">
            <article className="stat-card">
              <span>登録メモ</span>
              <strong>{notes.length}</strong>
            </article>
            <article className="stat-card">
              <span>検索方式</span>
              <strong className="stat-label">
                {searchMode === "hybrid" ? "Hybrid" : searchMode === "simple-vector" ? "Vector" : "Embed"}
              </strong>
            </article>
          </div>
        </header>

        {error ? <div className="error">{error}</div> : null}

        <section className="workflow">
          <section className="card ask" id="ask">
            <div className="section-heading">
              <p>Ask</p>
              <h2>メモに質問する</h2>
            </div>
            <form onSubmit={handleAsk} className="ask-form">
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="例: RAGの回答品質を上げるには何を確認すべき？"
                rows={4}
              />
              <div className="ask-actions">
                <label>
                  検索方式
                  <select value={searchMode} onChange={(event) => setSearchMode(event.target.value as SearchMode)}>
                    <option value="hybrid">ハイブリッド検索（推奨）</option>
                    <option value="simple-vector">簡易ベクトル検索</option>
                    <option value="local-embedding">ローカルEmbedding検索</option>
                  </select>
                </label>
                <button type="submit" disabled={isPending}>
                  {isPending ? "回答を生成中..." : "根拠付きで回答"}
                </button>
              </div>
            </form>

            {history.length > 0 ? (
              <div className="history">
                <p>最近の質問</p>
                <div>
                  {history.map((item) => (
                    <button className="secondary-button" key={item} type="button" onClick={() => setQuestion(item)}>
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {answerState ? (
              <article className="answer" id="evidence">
                <div className="answer-topline">
                  <div className="meta-row">
                    <span>{answerState.mode === "openai" ? "OpenAI生成" : "ローカル生成"}</span>
                    <span>{SEARCH_MODE_LABELS[answerState.searchMode]}</span>
                  </div>
                  <strong>{answerState.question}</strong>
                </div>
                <p>{answerState.answer}</p>
                <h3>引用元</h3>
                <div className="sources">
                  {answerState.sources.map((source) => (
                    <div key={source.note.id} className="source-card">
                      <span>{Math.round(source.score * 100)}% match</span>
                      <strong>{source.note.title}</strong>
                      <p>{source.snippet}</p>
                      <small>
                        lexical {source.scoreBreakdown.lexical.toFixed(2)} / phrase{" "}
                        {source.scoreBreakdown.phrase.toFixed(2)} / vector {source.scoreBreakdown.vector.toFixed(2)}
                      </small>
                    </div>
                  ))}
                </div>
              </article>
            ) : null}
          </section>

          <form className="card compose" id="compose" onSubmit={handleAddNote}>
            <div className="section-heading">
              <p>Capture</p>
              <h2>メモを登録</h2>
            </div>
            <label>
              タイトル
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例: RAGの評価方針" />
            </label>
            <label>
              タグ
              <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="ai, rag, learning" />
            </label>
            <label>
              本文
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="あとで検索したい知識、学習メモ、気づきを書く"
                rows={9}
              />
            </label>
            <button type="submit">メモを追加</button>
          </form>
        </section>

        <section className="card library" id="library">
          <div className="section-heading">
            <p>Library</p>
            <h2>登録済みメモ</h2>
          </div>
          <div className="note-list">
            {notes.map((note) => (
              <article key={note.id} className="note-card">
                <div className="note-card-header">
                  <h3>{note.title}</h3>
                  <button type="button" className="secondary-button delete-button" onClick={() => handleDeleteNote(note.id)}>
                    削除
                  </button>
                </div>
                <p>{summarizeNote(note.content, 120)}</p>
                <div className="tag-row">
                  {note.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

async function findSources(question: string, notes: KnowledgeNote[], searchMode: SearchMode) {
  if (searchMode !== "local-embedding") {
    return findRelevantNotes(question, notes, 4, { mode: searchMode });
  }

  const response = await fetch("/api/search/embedding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, notes, limit: 4 }),
  });

  if (!response.ok) {
    throw new Error("Local embedding search failed");
  }

  const result = (await response.json()) as { results: RagResult[] };
  return result.results;
}

function subscribeToNotes(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(STORAGE_EVENT, callback);

  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(STORAGE_EVENT, callback);
  };
}

function getServerNotes() {
  return DEFAULT_NOTES;
}

function getStoredNotes() {
  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    cachedRaw = null;
    cachedNotes = DEFAULT_NOTES;
    return cachedNotes;
  }

  if (raw === cachedRaw) {
    return cachedNotes;
  }

  try {
    cachedRaw = raw;
    cachedNotes = migrateStoredNotes(JSON.parse(raw) as KnowledgeNote[]);
    if (cachedNotes.some((note) => LEGACY_SAMPLE_TITLES.has(note.title)) === false && JSON.stringify(cachedNotes) !== raw) {
      cachedRaw = JSON.stringify(cachedNotes);
      window.localStorage.setItem(STORAGE_KEY, cachedRaw);
    }
    return cachedNotes;
  } catch {
    cachedRaw = null;
    cachedNotes = DEFAULT_NOTES;
    return cachedNotes;
  }
}

function migrateStoredNotes(notes: KnowledgeNote[]) {
  const withoutLegacySamples = notes.filter((note) => !LEGACY_SAMPLE_TITLES.has(note.title));
  const existingTitles = new Set(withoutLegacySamples.map((note) => note.title));
  const missingDefaults = DEFAULT_NOTES.filter((note) => !existingTitles.has(note.title));

  if (withoutLegacySamples.length === notes.length && missingDefaults.length === 0) {
    return notes;
  }

  return [...missingDefaults, ...withoutLegacySamples];
}

function updateStoredNotes(updater: (current: KnowledgeNote[]) => KnowledgeNote[]) {
  const nextNotes = updater(getStoredNotes());
  cachedRaw = JSON.stringify(nextNotes);
  cachedNotes = nextNotes;
  window.localStorage.setItem(STORAGE_KEY, cachedRaw);
  window.dispatchEvent(new Event(STORAGE_EVENT));
}

function buildLocalAnswer(question: string, sources: RagResult[], searchMode: SearchMode) {
  const strongest = sources[0];
  const sourceTitles = sources.map((source) => `「${source.note.title}」`).join("、");

  return [
    `質問「${question}」には、${sourceTitles} が関連しています。`,
    `最も強い根拠は「${strongest.note.title}」です。${strongest.snippet}`,
    `検索方式は ${SEARCH_MODE_LABELS[searchMode]} です。OPENAI_API_KEY を設定すると、同じ根拠を使ってより自然な回答を生成します。`,
  ].join("\n\n");
}
