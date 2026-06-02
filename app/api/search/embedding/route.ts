import { FeatureExtractionPipeline, pipeline } from "@huggingface/transformers";
import { z } from "zod";
import { cosineSimilarity, createKnowledgeChunks, extractSnippet, getChunkSearchableText } from "@/lib/knowledge";

export const runtime = "nodejs";

const EMBEDDING_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

const requestSchema = z.object({
  question: z.string().min(1),
  limit: z.number().int().min(1).max(10).optional(),
  notes: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      content: z.string(),
      tags: z.array(z.string()),
      createdAt: z.string(),
    }),
  ),
});

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const { question, notes, limit = 4 } = parsed.data;

  if (notes.length === 0) {
    return Response.json({ results: [] });
  }

  try {
    const queryEmbedding = await embedText(question);
    const scoredResults = await Promise.all(
      notes.flatMap((note) =>
        createKnowledgeChunks(note).map(async (chunk) => {
          const chunkEmbedding = await embedText(getChunkSearchableText(chunk));
          const score = cosineSimilarity(queryEmbedding, chunkEmbedding);

          return {
            note,
            chunk,
            score,
            snippet: extractSnippet(chunk.content, question),
            searchMode: "local-embedding" as const,
            scoreBreakdown: {
              lexical: 0,
              phrase: 0,
              vector: score,
            },
          };
        }),
      ),
    );

    const results = scoredResults
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return Response.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Embedding search failed";
    return Response.json({ error: message }, { status: 503 });
  }
}

async function embedText(text: string) {
  const extractor = await getExtractor();
  const output = (await extractor(text, {
    pooling: "mean",
    normalize: true,
  })) as { data: Float32Array | number[] };

  return Array.from(output.data);
}

function getExtractor() {
  extractorPromise ??= pipeline("feature-extraction", EMBEDDING_MODEL);
  return extractorPromise;
}
