import { z } from "zod";
import { parseJsonBody, rejectUntrustedRequest } from "@/lib/api-request";
import { importStoredNotes } from "@/lib/note-repository";

export const runtime = "nodejs";

const migrationSchema = z.object({
  notes: z.array(
    z.object({
      id: z.string().optional(),
      title: z.string(),
      content: z.string(),
      tags: z.array(z.string()).default([]),
      createdAt: z.string().optional(),
    }),
  ),
});

export async function POST(request: Request) {
  const rejected = rejectUntrustedRequest(request);
  if (rejected) {
    return rejected;
  }

  const body = await parseJsonBody(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = migrationSchema.safeParse(body.data);

  if (!parsed.success) {
    return Response.json({ error: "Invalid migration payload" }, { status: 400 });
  }

  const result = importStoredNotes(parsed.data.notes);

  return Response.json({
    imported: result.imported.length,
    skipped: result.skipped.length,
    notes: result.imported,
  });
}
