import { getDatabase } from "@/lib/db";
import {
  KnowledgeChunk,
  KnowledgeChunkRecord,
  KnowledgeNote,
  createKnowledgeChunks,
  createSampleNotes,
  getChunkSearchableText,
} from "@/lib/knowledge";

type NoteRow = {
  id: string;
  title: string;
  content: string;
  created_at: string;
};

type TagRow = {
  note_id: string;
  name: string;
};

type ChunkRow = {
  id: string;
  note_id: string;
  chunk_index: number;
  total_chunks: number;
  content: string;
  start_offset: number;
  end_offset: number;
  created_at: string;
};

type NoteInput = {
  title: string;
  content: string;
  tags: string[];
};

type ImportNoteInput = NoteInput & {
  id?: string;
  createdAt?: string;
};

const LEGACY_SAMPLE_TITLES = new Set(
  [
    // 旧localStorageサンプルの文字化けタイトル。移行時に永続化しない。
    [
      0x41, 0x49, 0x20, 0x53, 0x61, 0x61, 0x53, 0x7e3a, 0xff6e, 0x7e5d, 0xff68, 0xff7e, 0xff80,
      0x30fb, 0x7e5d, 0xff68, 0x533b, 0xff75, 0x7e5d, 0xff6a, 0xff6a, 0x7e3a, 0xff67, 0x96ab,
      0x7a42, 0xff79, 0x6636, 0x6e05, 0xff7e, 0xff9f, 0x96aa, 0x8b9b, 0xff65,
    ],
  ].map((codes) => String.fromCharCode(...codes)),
);

export function listNotes(ownerId: string) {
  seedSampleNotesIfNeeded(ownerId);

  const db = getDatabase();
  const rows = db
    .prepare("SELECT id, title, content, created_at FROM notes WHERE owner_id = ? ORDER BY created_at DESC")
    .all(ownerId) as NoteRow[];
  const tagsByNote = getTagsByNote(ownerId);

  return rows.map((row): KnowledgeNote => {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      tags: tagsByNote.get(row.id) ?? [],
      createdAt: row.created_at,
    };
  });
}

export function createStoredNote(input: NoteInput, ownerId: string) {
  return upsertStoredNote(
    {
      title: input.title,
      content: input.content,
      tags: input.tags,
    },
    ownerId,
  );
}

export function importStoredNotes(notes: ImportNoteInput[], ownerId: string) {
  const imported: KnowledgeNote[] = [];
  const skipped: string[] = [];
  const db = getDatabase();

  db.transaction(() => {
    for (const note of notes) {
      if (isLegacySampleNote(note)) {
        skipped.push(note.id ?? note.title);
        continue;
      }

      if (note.id && getNoteById(note.id, ownerId)) {
        skipped.push(note.id);
        continue;
      }

      const saved = upsertStoredNote(note, ownerId);
      if (saved) {
        imported.push(saved);
      }
    }
  })();

  return { imported, skipped };
}

export function deleteStoredNote(id: string, ownerId: string) {
  const result = getDatabase().prepare("DELETE FROM notes WHERE id = ? AND owner_id = ?").run(id, ownerId);
  return result.changes > 0;
}

export function listChunkRecords(ownerId: string): KnowledgeChunkRecord[] {
  const notes = listNotes(ownerId);
  const notesById = new Map(notes.map((note) => [note.id, note]));
  const rows = getDatabase()
    .prepare(
      `
      SELECT
        note_chunks.id,
        note_chunks.note_id,
        note_chunks.chunk_index,
        note_chunks.total_chunks,
        note_chunks.content,
        note_chunks.start_offset,
        note_chunks.end_offset,
        note_chunks.created_at
      FROM note_chunks
      INNER JOIN notes ON notes.id = note_chunks.note_id
      WHERE notes.owner_id = ?
      ORDER BY note_chunks.created_at DESC, note_chunks.chunk_index ASC
    `,
    )
    .all(ownerId) as ChunkRow[];

  return rows.flatMap((row) => {
    const note = notesById.get(row.note_id);

    if (!note) {
      return [];
    }

    const chunk: KnowledgeChunk = {
      id: row.id,
      noteId: row.note_id,
      index: row.chunk_index,
      total: row.total_chunks,
      title: note.title,
      content: row.content,
      tags: note.tags,
      createdAt: row.created_at,
      startOffset: row.start_offset,
      endOffset: row.end_offset,
    };

    return [{ note, chunk }];
  });
}

function upsertStoredNote(input: ImportNoteInput, ownerId: string) {
  const title = input.title.trim();
  const content = input.content.trim();

  if (!title || !content) {
    return null;
  }

  const now = new Date().toISOString();
  const db = getDatabase();
  const existingOwner = input.id
    ? (db.prepare("SELECT owner_id FROM notes WHERE id = ?").get(input.id) as { owner_id: string } | undefined)
    : undefined;
  let note: KnowledgeNote = {
    id: input.id && (!existingOwner || existingOwner.owner_id === ownerId) ? input.id : crypto.randomUUID(),
    title,
    content,
    tags: normalizeTags(input.tags),
    createdAt: input.createdAt ?? now,
  };
  db.transaction(() => {
    const upsertNote = db.prepare(
      `
      INSERT INTO notes (id, owner_id, title, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        updated_at = excluded.updated_at
      WHERE notes.owner_id = excluded.owner_id
    `,
    );
    upsertNote.run(note.id, ownerId, note.title, note.content, note.createdAt, now);

    const persistedOwner = db.prepare("SELECT owner_id FROM notes WHERE id = ?").get(note.id) as { owner_id: string };
    if (persistedOwner.owner_id !== ownerId) {
      note = { ...note, id: crypto.randomUUID() };
      upsertNote.run(note.id, ownerId, note.title, note.content, note.createdAt, now);
    }

    db.prepare("DELETE FROM note_tags WHERE note_id = ?").run(note.id);

    for (const tag of note.tags) {
      db.prepare("INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)").run(crypto.randomUUID(), tag);
      const tagRow = db.prepare("SELECT id FROM tags WHERE name = ?").get(tag) as { id: string };
      db.prepare("INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)").run(note.id, tagRow.id);
    }

    db.prepare("DELETE FROM note_chunks WHERE note_id = ?").run(note.id);

    for (const chunk of createKnowledgeChunks(note)) {
      db.prepare(
        `
        INSERT INTO note_chunks (
          id,
          note_id,
          chunk_index,
          total_chunks,
          content,
          start_offset,
          end_offset,
          searchable_text,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        chunk.id,
        chunk.noteId,
        chunk.index,
        chunk.total,
        chunk.content,
        chunk.startOffset,
        chunk.endOffset,
        getChunkSearchableText(chunk),
        note.createdAt,
      );
    }
  })();

  return note;
}

function getTagsByNote(ownerId: string) {
  const tagRows = getDatabase()
    .prepare(
      `
      SELECT note_tags.note_id, tags.name
      FROM notes
      INNER JOIN note_tags ON note_tags.note_id = notes.id
      INNER JOIN tags ON tags.id = note_tags.tag_id
      WHERE notes.owner_id = ?
      ORDER BY tags.name ASC
    `,
    )
    .all(ownerId) as TagRow[];
  const tagsByNote = new Map<string, string[]>();

  for (const row of tagRows) {
    const tags = tagsByNote.get(row.note_id) ?? [];
    tags.push(row.name);
    tagsByNote.set(row.note_id, tags);
  }

  return tagsByNote;
}

function getNoteById(id: string, ownerId: string) {
  return getDatabase().prepare("SELECT id FROM notes WHERE id = ? AND owner_id = ?").get(id, ownerId) as
    | { id: string }
    | undefined;
}

function seedSampleNotesIfNeeded(ownerId: string) {
  const db = getDatabase();
  const seedKey = `sample_notes_seeded:${ownerId}`;
  db.transaction(() => {
    const reserved = db.prepare("INSERT OR IGNORE INTO app_metadata (key, value) VALUES (?, ?)").run(seedKey, "true");
    if (reserved.changes === 0) {
      return;
    }

    const noteCount = db.prepare("SELECT COUNT(*) as count FROM notes WHERE owner_id = ?").get(ownerId) as {
      count: number;
    };

    if (noteCount.count === 0) {
      for (const note of createSampleNotes()) {
        upsertStoredNote(note, ownerId);
      }
    }
  })();
}

function normalizeTags(tags: string[]) {
  const normalized = tags.map((tag) => tag.trim()).filter(Boolean);
  return [...new Set(normalized)];
}

function isLegacySampleNote(note: ImportNoteInput) {
  return LEGACY_SAMPLE_TITLES.has(note.title);
}
