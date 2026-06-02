import OpenAI from "openai";
import { z } from "zod";

const requestSchema = z.object({
  question: z.string().min(1),
  sources: z.array(
    z.object({
      score: z.number(),
      snippet: z.string(),
      chunk: z.object({
        index: z.number(),
        total: z.number(),
        content: z.string(),
      }),
      note: z.object({
        title: z.string(),
        content: z.string(),
        tags: z.array(z.string()),
      }),
    }),
  ),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return Response.json({
      mode: "local",
      answer: buildFallbackAnswer(parsed.data.question, parsed.data.sources),
    });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const context = parsed.data.sources
    .map((source, index) => {
      return [
        `Source ${index + 1}: ${source.note.title} (chunk ${source.chunk.index + 1}/${source.chunk.total})`,
        `Tags: ${source.note.tags.join(", ")}`,
        `Content: ${source.chunk.content}`,
      ].join("\n");
    })
    .join("\n\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const completion = await client.chat.completions.create(
      {
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content:
              "You answer in Japanese using only the provided sources. If the sources are insufficient, say what is missing. Keep the answer concise and cite source titles naturally.",
          },
          {
            role: "user",
            content: `Question:\n${parsed.data.question}\n\nSources:\n${context}`,
          },
        ],
        temperature: 0.2,
      },
      { signal: controller.signal },
    );

    return Response.json({
      mode: "openai",
      answer: completion.choices[0]?.message.content ?? buildFallbackAnswer(parsed.data.question, parsed.data.sources),
    });
  } catch {
    return Response.json({
      mode: "local",
      answer: buildFallbackAnswer(parsed.data.question, parsed.data.sources),
    });
  } finally {
    clearTimeout(timeout);
  }
}

function buildFallbackAnswer(question: string, sources: Array<{ note: { title: string }; snippet: string }>) {
  const titles = sources.map((source) => `「${source.note.title}」`).join("、");
  const strongest = sources[0];

  if (!strongest) {
    return `質問「${question}」に答えるための根拠が見つかりませんでした。`;
  }

  return `質問「${question}」には、${titles} が関連しています。主な根拠: ${strongest.snippet}`;
}
