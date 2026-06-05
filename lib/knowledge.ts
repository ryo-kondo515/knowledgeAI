export type KnowledgeNote = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
};

export type SearchMode = "hybrid" | "simple-vector" | "local-embedding";

export type KnowledgeChunk = {
  id: string;
  noteId: string;
  index: number;
  total: number;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  startOffset: number;
  endOffset: number;
};

export type RagResult = {
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

export type KnowledgeChunkRecord = {
  note: KnowledgeNote;
  chunk: KnowledgeChunk;
};

type NoteInput = {
  title: string;
  content: string;
  tags: string[];
};

type SearchOptions = {
  mode?: SearchMode;
};

type IndexedNote = {
  note: KnowledgeNote;
  chunk: KnowledgeChunk;
  searchable: string;
  normalizedSearchable: string;
  titleTokens: string[];
  tagTokens: string[];
  contentTokens: string[];
  allTokens: string[];
  termWeights: Map<string, number>;
  length: number;
  vector: number[];
};

const VECTOR_SIZE = 128;
const DEFAULT_SEARCH_MODE: SearchMode = "hybrid";
const CHUNK_TARGET_LENGTH = 420;
const CHUNK_MAX_LENGTH = 700;
const CHUNK_OVERLAP_LENGTH = 80;

export function createNote(input: NoteInput): KnowledgeNote {
  return {
    id: crypto.randomUUID(),
    title: input.title.trim(),
    content: input.content.trim(),
    tags: input.tags,
    createdAt: new Date().toISOString(),
  };
}

export function createSampleNotes(): KnowledgeNote[] {
  return [
    createNote({
      title: "RAGでハルシネーションを減らす方法",
      tags: ["ai", "rag", "quality"],
      content:
        "RAGでは回答生成の前に関連文書を検索し、回答には根拠を明示する。検索結果が弱い場合は無理に答えず、追加情報を求める。引用元をUIに表示すると、利用者が回答の妥当性を確認しやすい。",
    }),
    createNote({
      title: "メモを検索しやすくする書き方",
      tags: ["writing", "search", "notes"],
      content:
        "あとで質問して取り出す前提なら、メモには結論、背景、具体例、判断理由を分けて書く。略語だけでなく正式名称も入れると検索に引っかかりやすい。タグはテーマ、作業、状態を混ぜすぎず、2個から4個に絞る。",
    }),
    createNote({
      title: "個人ナレッジ検索の改善アイデア",
      tags: ["learning", "product"],
      content:
        "自分の学習メモを登録し、あとから質問で取り出せると調べ直しの時間が減る。タグ、検索履歴、お気に入り、週次要約があると継続利用しやすい。",
    }),
    createNote({
      title: "検索結果を評価するときの観点",
      tags: ["evaluation", "search", "quality"],
      content:
        "検索品質は雰囲気ではなく、質問と期待するメモの組み合わせで評価する。Top1に正しいメモが出るか、Top3に含まれるか、関係ないメモが上位に混ざらないかを見る。検索ロジックを変更したら同じ評価セットで比較する。",
    }),
    createNote({
      title: "Embedding検索とキーワード検索の使い分け",
      tags: ["embedding", "search", "rag"],
      content:
        "キーワード検索は固有名詞、タグ、明確な用語に強い。Embedding検索は言い換えや意味の近い質問に強い。実用では両方を組み合わせ、タイトルやタグを少し強めに扱うと、短いメモでも関連性を拾いやすくなる。",
    }),
    createNote({
      title: "ローカルファーストで扱う個人メモの注意点",
      tags: ["privacy", "local-first", "operations"],
      content:
        "個人メモには仕事、学習、体調、アイデアなど機微な情報が混ざりやすい。まずローカル保存で試し、外部APIへ送る内容は根拠メモと質問に限定する。同期や共有を追加する場合は、削除、エクスポート、権限管理を先に設計する。",
    }),
  ];
}

export function findRelevantNotes(
  query: string,
  notes: KnowledgeNote[],
  limit = 4,
  options: SearchOptions = {},
): RagResult[] {
  return findRelevantChunks(
    query,
    notes.flatMap((note) => createKnowledgeChunks(note).map((chunk) => ({ note, chunk }))),
    limit,
    options,
  );
}

export function findRelevantChunks(
  query: string,
  records: KnowledgeChunkRecord[],
  limit = 4,
  options: SearchOptions = {},
): RagResult[] {
  const mode = options.mode ?? DEFAULT_SEARCH_MODE;

  if (mode === "simple-vector") {
    return findBySimpleVector(query, records, limit);
  }

  return findByHybridSearch(query, records, limit);
}

export function summarizeNote(content: string, maxLength: number) {
  if (content.length <= maxLength) {
    return content;
  }

  return `${content.slice(0, maxLength)}...`;
}

export function createKnowledgeChunks(note: KnowledgeNote): KnowledgeChunk[] {
  const chunkContents = splitIntoChunks(note.content);
  const total = chunkContents.length;
  let searchOffset = 0;

  return chunkContents.map((content, index) => {
    const startOffset = Math.max(note.content.indexOf(content, searchOffset), 0);
    const endOffset = startOffset + content.length;
    searchOffset = endOffset;

    return {
      id: `${note.id}:chunk:${index + 1}`,
      noteId: note.id,
      index,
      total,
      title: note.title,
      content,
      tags: note.tags,
      createdAt: note.createdAt,
      startOffset,
      endOffset,
    };
  });
}

function findBySimpleVector(query: string, records: KnowledgeChunkRecord[], limit: number): RagResult[] {
  const queryVector = toVector(query);

  return records
    .map(({ note, chunk }) => {
      const searchable = getChunkSearchableText(chunk);
      const score = cosineSimilarity(queryVector, toVector(searchable));

      return {
        note,
        chunk,
        score,
        snippet: extractSnippet(chunk.content, query),
        searchMode: "simple-vector" as const,
        scoreBreakdown: {
          lexical: 0,
          vector: score,
          phrase: 0,
        },
      };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function findByHybridSearch(query: string, records: KnowledgeChunkRecord[], limit: number): RagResult[] {
  const queryTokens = tokenize(query);

  if (queryTokens.length === 0) {
    return [];
  }

  const indexedNotes = records.map(({ note, chunk }) => indexNoteChunk(note, chunk));
  const documentFrequency = calculateDocumentFrequency(indexedNotes);
  const averageLength =
    indexedNotes.reduce((sum, indexedNote) => sum + indexedNote.length, 0) / Math.max(indexedNotes.length, 1);
  const queryVector = toVector(query);
  const normalizedQuery = normalizeText(query);

  const scoredResults = indexedNotes
    .map((indexedNote) => {
      const lexical = bm25Score(queryTokens, indexedNote, documentFrequency, indexedNotes.length, averageLength);
      const phrase = phraseScore(normalizedQuery, queryTokens, indexedNote);
      const vector = cosineSimilarity(queryVector, indexedNote.vector);
      const rawScore = lexical * 0.68 + phrase * 0.22 + vector * 0.1;

      return {
        note: indexedNote.note,
        chunk: indexedNote.chunk,
        rawScore,
        snippet: extractSnippet(indexedNote.chunk.content, query),
        searchMode: "hybrid" as const,
        scoreBreakdown: {
          lexical,
          vector,
          phrase,
        },
      };
    })
    .filter((result) => result.rawScore > 0)
    .sort((a, b) => b.rawScore - a.rawScore)
    .slice(0, limit);

  const maxScore = Math.max(...scoredResults.map((result) => result.rawScore), 1);

  return scoredResults.map(({ rawScore, ...result }) => ({
    ...result,
    score: rawScore / maxScore,
  }));
}

function indexNoteChunk(note: KnowledgeNote, chunk: KnowledgeChunk): IndexedNote {
  const titleTokens = tokenize(note.title);
  const tagTokens = note.tags.flatMap(tokenize);
  const contentTokens = tokenize(chunk.content);
  const termWeights = new Map<string, number>();

  addWeightedTokens(termWeights, titleTokens, 3);
  addWeightedTokens(termWeights, tagTokens, 2.2);
  addWeightedTokens(termWeights, contentTokens, 1);

  const searchable = getChunkSearchableText(chunk);

  return {
    note,
    chunk,
    searchable,
    normalizedSearchable: normalizeText(searchable),
    titleTokens,
    tagTokens,
    contentTokens,
    allTokens: [...titleTokens, ...tagTokens, ...contentTokens],
    termWeights,
    length: [...termWeights.values()].reduce((sum, value) => sum + value, 0),
    vector: toVector(searchable),
  };
}

function addWeightedTokens(termWeights: Map<string, number>, tokens: string[], weight: number) {
  for (const token of tokens) {
    termWeights.set(token, (termWeights.get(token) ?? 0) + weight);
  }
}

function calculateDocumentFrequency(indexedNotes: IndexedNote[]) {
  const documentFrequency = new Map<string, number>();

  for (const indexedNote of indexedNotes) {
    for (const token of new Set(indexedNote.allTokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  return documentFrequency;
}

function bm25Score(
  queryTokens: string[],
  indexedNote: IndexedNote,
  documentFrequency: Map<string, number>,
  documentCount: number,
  averageLength: number,
) {
  const uniqueQueryTokens = [...new Set(queryTokens)];
  const k1 = 1.4;
  const b = 0.72;

  return uniqueQueryTokens.reduce((score, token) => {
    const frequency = indexedNote.termWeights.get(token) ?? 0;

    if (frequency === 0) {
      return score;
    }

    const frequencyInDocuments = documentFrequency.get(token) ?? 0;
    const idf = Math.log(1 + (documentCount - frequencyInDocuments + 0.5) / (frequencyInDocuments + 0.5));
    const denominator = frequency + k1 * (1 - b + b * (indexedNote.length / Math.max(averageLength, 1)));
    return score + idf * ((frequency * (k1 + 1)) / denominator);
  }, 0);
}

function phraseScore(normalizedQuery: string, queryTokens: string[], indexedNote: IndexedNote) {
  const uniqueQueryTokens = [...new Set(queryTokens)];
  const matchedTokens = uniqueQueryTokens.filter((token) => indexedNote.termWeights.has(token)).length;
  const coverage = matchedTokens / Math.max(uniqueQueryTokens.length, 1);
  const exactBodyMatch = normalizedQuery.length >= 2 && indexedNote.normalizedSearchable.includes(normalizedQuery) ? 1 : 0;
  const titleMatch = uniqueQueryTokens.some((token) => indexedNote.titleTokens.includes(token)) ? 0.7 : 0;
  const tagMatch = uniqueQueryTokens.some((token) => indexedNote.tagTokens.includes(token)) ? 0.45 : 0;

  return coverage + exactBodyMatch + titleMatch + tagMatch;
}

export function extractSnippet(content: string, query: string) {
  const terms = tokenize(query);
  const sentences = content.split(/(?<=[。！？!?])\s*/);
  const bestSentence =
    sentences
      .map((sentence) => {
        const normalizedSentence = normalizeText(sentence);

        return {
          sentence,
          hits: terms.filter((term) => normalizedSentence.includes(term)).length,
        };
      })
      .sort((a, b) => b.hits - a.hits)[0]?.sentence || content;

  return summarizeNote(bestSentence, 180);
}

export function getSearchableText(note: KnowledgeNote) {
  return `${note.title}\n${note.tags.join(" ")}\n${note.content}`;
}

export function getChunkSearchableText(chunk: KnowledgeChunk) {
  return `${chunk.title}\n${chunk.tags.join(" ")}\n${chunk.content}`;
}

function splitIntoChunks(content: string) {
  const trimmed = content.trim();

  if (!trimmed) {
    return [];
  }

  const paragraphs = trimmed.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs.flatMap(splitLongParagraph)) {
    if (!current) {
      current = paragraph;
      continue;
    }

    if (`${current}\n\n${paragraph}`.length <= CHUNK_TARGET_LENGTH) {
      current = `${current}\n\n${paragraph}`;
      continue;
    }

    chunks.push(current);
    current = withOverlap(current, paragraph);
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function splitLongParagraph(paragraph: string) {
  if (paragraph.length <= CHUNK_MAX_LENGTH) {
    return [paragraph];
  }

  const sentences = paragraph.split(/(?<=[。．.!?！？])\s*/).map((part) => part.trim()).filter(Boolean);

  if (sentences.length <= 1) {
    return splitByLength(paragraph);
  }

  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
      continue;
    }

    if ((current + sentence).length <= CHUNK_TARGET_LENGTH) {
      current += sentence;
      continue;
    }

    chunks.push(current);
    current = withOverlap(current, sentence);
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.flatMap((chunk) => (chunk.length > CHUNK_MAX_LENGTH ? splitByLength(chunk) : [chunk]));
}

function splitByLength(text: string) {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + CHUNK_TARGET_LENGTH, text.length);
    chunks.push(text.slice(start, end).trim());

    if (end === text.length) {
      break;
    }

    start = Math.max(end - CHUNK_OVERLAP_LENGTH, start + 1);
  }

  return chunks.filter(Boolean);
}

function withOverlap(previous: string, next: string) {
  const overlap = previous.slice(-CHUNK_OVERLAP_LENGTH).trim();
  return overlap ? `${overlap}\n\n${next}` : next;
}

function toVector(text: string) {
  const vector = Array.from({ length: VECTOR_SIZE }, () => 0);

  for (const token of tokenize(text)) {
    vector[hashToken(token) % VECTOR_SIZE] += 1;
  }

  return normalize(vector);
}

function tokenize(text: string) {
  const normalized = normalizeText(text);
  const latinTokens = normalized.match(/[a-z0-9_-]{2,}/g) ?? [];
  const japaneseRuns = normalized.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]{2,}/gu) ?? [];
  const japaneseTokens = japaneseRuns.flatMap((run) => createCharacterNgrams(run, 2, 4));

  return [...latinTokens, ...japaneseTokens];
}

function createCharacterNgrams(text: string, minSize: number, maxSize: number) {
  const tokens: string[] = [];

  for (let size = minSize; size <= maxSize; size += 1) {
    if (text.length < size) {
      continue;
    }

    for (let index = 0; index <= text.length - size; index += 1) {
      tokens.push(text.slice(index, index + size));
    }
  }

  return tokens;
}

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[、。！？!?()[\]{}:;'"`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hashToken(token: string) {
  let hash = 0;

  for (let index = 0; index < token.length; index += 1) {
    hash = (hash * 31 + token.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function normalize(vector: number[]) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => value / magnitude);
}

export function cosineSimilarity(left: number[], right: number[]) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}
