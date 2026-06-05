import { getRequestOwner, jsonWithOwner } from "@/lib/api-request";
import { deleteStoredNote } from "@/lib/note-repository";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  const owner = getRequestOwner(request);

  const { id } = await context.params;
  const deleted = deleteStoredNote(id, owner.id);

  if (!deleted) {
    return Response.json({ error: "Note not found" }, { status: 404 });
  }

  return jsonWithOwner(owner, { ok: true });
}
