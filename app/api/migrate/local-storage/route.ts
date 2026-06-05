import { z } from "zod";
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
  const parsed = migrationSchema.safeParse(await request.json());

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
