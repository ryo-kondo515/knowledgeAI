import { deleteStoredNote } from "@/lib/note-repository";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const deleted = deleteStoredNote(id);

  if (!deleted) {
    return Response.json({ error: "Note not found" }, { status: 404 });
  }

  return Response.json({ ok: true });
}
