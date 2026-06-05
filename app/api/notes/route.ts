import { z } from "zod";
import { getRequestOwner, jsonWithOwner, parseJsonBody } from "@/lib/api-request";
import { createStoredNote, listNotes } from "@/lib/note-repository";

export const runtime = "nodejs";

const noteSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

export async function GET(request: Request) {
  const owner = getRequestOwner(request);

  return jsonWithOwner(owner, { notes: listNotes(owner.id) });
}

export async function POST(request: Request) {
  const owner = getRequestOwner(request);

  const body = await parseJsonBody(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = noteSchema.safeParse(body.data);

  if (!parsed.success) {
    return Response.json({ error: "Invalid note" }, { status: 400 });
  }

  const note = createStoredNote(parsed.data, owner.id);

  if (!note) {
    return Response.json({ error: "Title and content are required" }, { status: 400 });
  }

  return jsonWithOwner(owner, { note }, { status: 201 });
}
