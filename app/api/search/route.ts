import { z } from "zod";
import { parseJsonBody, rejectUntrustedRequest } from "@/lib/api-request";
import { findRelevantChunks } from "@/lib/knowledge";
import { listChunkRecords } from "@/lib/note-repository";

export const runtime = "nodejs";

const searchSchema = z.object({
  question: z.string().min(1),
  mode: z.enum(["hybrid", "simple-vector"]).default("hybrid"),
  limit: z.number().int().min(1).max(10).default(4),
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

  const parsed = searchSchema.safeParse(body.data);

  if (!parsed.success) {
    return Response.json({ error: "Invalid search request" }, { status: 400 });
  }

  const { question, mode, limit } = parsed.data;
  const results = findRelevantChunks(question, listChunkRecords(), limit, { mode });

  return Response.json({ results });
}
