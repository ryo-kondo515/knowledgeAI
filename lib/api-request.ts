export function rejectUntrustedRequest(request: Request) {
  if (process.env.KNOWLEDGE_AI_ALLOW_REMOTE === "true") {
    return null;
  }

  const host = request.headers.get("host");
  const origin = request.headers.get("origin");

  if (!host || !isLocalHost(host) || (origin && !isLocalOrigin(origin))) {
    return Response.json(
      {
        error:
          "このAPIはローカル利用を前提にしています。リモート公開する場合は認証を追加するか、KNOWLEDGE_AI_ALLOW_REMOTE=true を明示してください。",
      },
      { status: 403 },
    );
  }

  return null;
}

export async function parseJsonBody(request: Request) {
  try {
    return {
      ok: true as const,
      data: await request.json(),
    };
  } catch {
    return {
      ok: false as const,
      response: Response.json({ error: "JSON の形式が正しくありません。" }, { status: 400 }),
    };
  }
}

function isLocalOrigin(origin: string) {
  try {
    return isLocalHost(new URL(origin).host);
  } catch {
    return false;
  }
}

function isLocalHost(host: string) {
  const hostname = host.replace(/^\[/, "").replace(/\](:\d+)?$/, "").replace(/:\d+$/, "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
