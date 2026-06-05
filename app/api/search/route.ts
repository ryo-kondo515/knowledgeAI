import { z } from "zod";
import { findRelevantChunks } from "@/lib/knowledge";
import { listChunkRecords } from "@/lib/note-repository";

export const runtime = "nodejs";

const searchSchema = z.object({
  question: z.string().min(1),
  mode: z.enum(["hybrid", "simple-vector"]).default("hybrid"),
  limit: z.number().int().min(1).max(10).default(4),
});

export async function POST(request: Request) {
  const parsed = searchSchema.safeParse(await request.json());

  if (!parsed.success) {
    return Response.json({ error: "Invalid search request" }, { status: 400 });
  }

  const { question, mode, limit } = parsed.data;
  const results = findRelevantChunks(question, listChunkRecords(), limit, { mode });

  return Response.json({ results });
}
