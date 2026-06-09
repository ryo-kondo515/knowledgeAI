"use client";

import { FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { KnowledgeNote, RagResult, SearchMode, summarizeNote } from "@/lib/knowledge";

type AnswerState = {
  question: string;
  answer: string;
  sources: RagResult[];
  mode: "local" | "openai";
  searchMode: SearchMode;
};

const STORAGE_KEY = "personal-knowledge-ai-notes";
const MIGRATION_KEY_PREFIX = "personal-knowledge-ai-sqlite-migrated";
const NOTES_UPDATED_KEY = "personal-knowledge-ai-notes-updated";
const SESSION_INITIALIZATION_LOCK_KEY = "personal-knowledge-ai-session-initialization-lock";
const SESSION_INITIALIZATION_LOCK_LEASE_MS = 30_000;

const SEARCH_MODE_LABELS: Record<SearchMode, string> = {
  hybrid: "ハイブリッド検索",
  "simple-vector": "簡易ベクトル検索",
  "local-embedding": "ローカルEmbedding検索",
};

export default function Home() {
  const [notes, setNotes] = useState<KnowledgeNote[]>([]);
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [content, setContent] = useState("");
  const [question, setQuestion] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("hybrid");
  const [answerState, setAnswerState] = useState<AnswerState | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [isLoadingNotes, setIsLoadingNotes] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isPending, startTransition] = useTransition();
  const notesRequestId = useRef(0);

  async function refreshNotes(options: { clearError?: boolean } = {}) {
    const { clearError = true } = options;
    const requestId = ++notesRequestId.current;
    setIsLoadingNotes(true);
    if (clearError) {
      setError("");
    }

    try {
      const response = await fetch("/api/notes");

      if (!response.ok) {
        throw new Error("Failed to load notes");
      }

      const result = (await response.json()) as { notes: KnowledgeNote[] };
      if (requestId === notesRequestId.current) {
        setNotes(result.notes);
      }
    } catch {
      if (requestId === notesRequestId.current) {
        setError("メモの読み込みに失敗しました。");
      }
    } finally {
      if (requestId === notesRequestId.current) {
        setIsLoadingNotes(false);
      }
    }
  }

  useEffect(() => {
    startTransition(async () => {
      await withSessionInitializationLock(async () => {
        const migrationScope = await fetchMigrationScope();
        const migrated = migrationScope ? await migrateLocalStorageNotes(migrationScope) : false;
        await refreshNotes({ clearError: migrated });
        if (!migrated) {
          setError("localStorage から SQLite への移行に失敗しました。次回読み込み時に再試行します。");
        }
      });
      setIsInitialized(true);
    });
  }, []);

  useEffect(() => {
    if (!isInitialized) {
      return;
    }

    function refreshVisibleNotes() {
      if (document.visibilityState !== "visible") {
        return;
      }

      startTransition(async () => {
        await refreshNotes();
      });
    }

    function refreshAfterOtherTabUpdate(event: StorageEvent) {
      if (event.key === NOTES_UPDATED_KEY) {
        startTransition(async () => {
          await refreshNotes();
        });
      }
    }

    document.addEventListener("visibilitychange", refreshVisibleNotes);
    window.addEventListener("focus", refreshVisibleNotes);
    window.addEventListener("storage", refreshAfterOtherTabUpdate);

    return () => {
      document.removeEventListener("visibilitychange", refreshVisibleNotes);
      window.removeEventListener("focus", refreshVisibleNotes);
      window.removeEventListener("storage", refreshAfterOtherTabUpdate);
    };
  }, [isInitialized]);

  function handleAddNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!title.trim() || !content.trim()) {
      setError("タイトルと本文を入力してください。");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            content,
            tags: parseTags(tags),
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to save note");
        }

        const result = (await response.json()) as { note: KnowledgeNote };
        notesRequestId.current += 1;
        setIsLoadingNotes(false);
        setNotes((current) => [result.note, ...current.filter((note) => note.id !== result.note.id)]);
        notifyOtherTabs();
        setTitle("");
        setTags("");
        setContent("");
      } catch {
        setError("メモの保存に失敗しました。");
      }
    });
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
          answer: "検索に失敗しました。検索方式を変えるか、もう一度試してください。",
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
          throw new Error("Failed to generate answer");
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
    startTransition(async () => {
      setError("");

      try {
        const response = await fetch(`/api/notes/${encodeURIComponent(noteId)}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          throw new Error("Failed to delete note");
        }

        notesRequestId.current += 1;
        setIsLoadingNotes(false);
        setNotes((current) => current.filter((note) => note.id !== noteId));
        notifyOtherTabs();
        setAnswerState((current) => {
          if (!current) {
            return null;
          }

          return {
            ...current,
            sources: current.sources.filter((source) => source.note.id !== noteId),
          };
        });
      } catch {
        setError("メモの削除に失敗しました。");
      }
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
              自分のメモをSQLiteに保存し、質問に対して根拠付きで回答する個人向けナレッジ検索AIです。
              登録、検索、引用表示までをひとつの画面で確認できます。
            </p>
          </div>
          <div className="stats">
            <article className="stat-card">
              <span>登録メモ</span>
              <strong>{isLoadingNotes ? "..." : notes.length}</strong>
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
                <button type="submit" disabled={isPending || isLoadingNotes}>
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
                    <div key={source.chunk.id} className="source-card">
                      <span>{Math.round(source.score * 100)}% match</span>
                      <strong>{source.note.title}</strong>
                      <em>
                        Chunk {source.chunk.index + 1}/{source.chunk.total}
                      </em>
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
            <button type="submit" disabled={isPending}>
              メモを追加
            </button>
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
    const response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, mode: searchMode, limit: 4 }),
    });

    if (!response.ok) {
      throw new Error("Search failed");
    }

    const result = (await response.json()) as { results: RagResult[] };
    return result.results;
  }

  const latestNotes = await fetchNotes();
  const response = await fetch("/api/search/embedding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, notes: latestNotes, limit: 4 }),
  });

  if (!response.ok) {
    throw new Error("Local embedding search failed");
  }

  const result = (await response.json()) as { results: RagResult[] };
  return result.results;
}

async function migrateLocalStorageNotes(migrationScope: string) {
  const migrationKey = `${MIGRATION_KEY_PREFIX}:${migrationScope}`;

  if (window.localStorage.getItem(migrationKey)) {
    return true;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    window.localStorage.setItem(migrationKey, "true");
    return true;
  }

  try {
    const notes = JSON.parse(raw) as KnowledgeNote[];

    if (Array.isArray(notes) && notes.length > 0) {
      const response = await fetch("/api/migrate/local-storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });

      if (!response.ok) {
        return false;
      }
    }

    window.localStorage.setItem(migrationKey, "true");
    return true;
  } catch {
    return false;
  }
}

async function fetchMigrationScope() {
  try {
    const response = await fetch("/api/session");

    if (!response.ok) {
      return null;
    }

    const result = (await response.json()) as { migrationScope: string };
    return result.migrationScope;
  } catch {
    return null;
  }
}

async function withSessionInitializationLock(task: () => Promise<void>) {
  if (navigator.locks) {
    await navigator.locks.request("personal-knowledge-ai-session-initialization", task);
    return;
  }

  const token = crypto.randomUUID();

  while (true) {
    const current = getStoredInitializationLock();
    if (!current || current.expiresAt <= Date.now()) {
      storeInitializationLock(token);
      await delay(50);

      if (getStoredInitializationLock()?.token === token) {
        const heartbeat = window.setInterval(() => {
          if (getStoredInitializationLock()?.token === token) {
            storeInitializationLock(token);
          }
        }, SESSION_INITIALIZATION_LOCK_LEASE_MS / 3);

        try {
          await task();
        } finally {
          window.clearInterval(heartbeat);
          if (getStoredInitializationLock()?.token === token) {
            window.localStorage.removeItem(SESSION_INITIALIZATION_LOCK_KEY);
          }
        }
        return;
      }
    }

    await delay(100 + Math.random() * 100);
  }
}

function getStoredInitializationLock() {
  const raw = window.localStorage.getItem(SESSION_INITIALIZATION_LOCK_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as { token: string; expiresAt: number };
  } catch {
    return null;
  }
}

function storeInitializationLock(token: string) {
  window.localStorage.setItem(
    SESSION_INITIALIZATION_LOCK_KEY,
    JSON.stringify({ token, expiresAt: Date.now() + SESSION_INITIALIZATION_LOCK_LEASE_MS }),
  );
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function notifyOtherTabs() {
  window.localStorage.setItem(NOTES_UPDATED_KEY, `${Date.now()}:${crypto.randomUUID()}`);
}

async function fetchNotes() {
  const response = await fetch("/api/notes");

  if (!response.ok) {
    throw new Error("Failed to load notes");
  }

  const result = (await response.json()) as { notes: KnowledgeNote[] };
  return result.notes;
}

function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function buildLocalAnswer(question: string, sources: RagResult[], searchMode: SearchMode) {
  const strongest = sources[0];
  const sourceTitles = sources
    .map((source) => `「${source.note.title} ${source.chunk.index + 1}/${source.chunk.total}」`)
    .join("、");

  return [
    `質問「${question}」には、${sourceTitles} が関連しています。`,
    `最も強い根拠は「${strongest.note.title} ${strongest.chunk.index + 1}/${strongest.chunk.total}」です。${strongest.snippet}`,
    `検索方式は ${SEARCH_MODE_LABELS[searchMode]} です。OPENAI_API_KEY を設定すると、同じ根拠を使ってより自然な回答を生成します。`,
  ].join("\n\n");
}
