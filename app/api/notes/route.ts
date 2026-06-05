import { z } from "zod";
import { createStoredNote, listNotes } from "@/lib/note-repository";

export const runtime = "nodejs";

const noteSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

export async function GET() {
  return Response.json({ notes: listNotes() });
}

export async function POST(request: Request) {
  const parsed = noteSchema.safeParse(await request.json());

  if (!parsed.success) {
    return Response.json({ error: "Invalid note" }, { status: 400 });
  }

  const note = createStoredNote(parsed.data);

  if (!note) {
    return Response.json({ error: "Title and content are required" }, { status: 400 });
  }

  return Response.json({ note }, { status: 201 });
}
