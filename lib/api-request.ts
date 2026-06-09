const OWNER_COOKIE = "personal_knowledge_ai_owner";
const OWNER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type RequestOwner = {
  id: string;
  shouldSetCookie: boolean;
  isSecure: boolean;
};

export function getRequestOwner(request: Request): RequestOwner {
  const cookieOwner = parseCookie(request.headers.get("cookie") ?? "")[OWNER_COOKIE];

  if (cookieOwner && isValidOwnerId(cookieOwner)) {
    return {
      id: cookieOwner,
      shouldSetCookie: true,
      isSecure: new URL(request.url).protocol === "https:",
    };
  }

  return {
    id: crypto.randomUUID(),
    shouldSetCookie: true,
    isSecure: new URL(request.url).protocol === "https:",
  };
}

export function jsonWithOwner(owner: RequestOwner, data: unknown, init?: ResponseInit) {
  const response = Response.json(data, init);

  if (owner.shouldSetCookie) {
    response.headers.append("Set-Cookie", serializeOwnerCookie(owner));
  }

  return response;
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

function serializeOwnerCookie(owner: RequestOwner) {
  const parts = [
    `${OWNER_COOKIE}=${owner.id}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${OWNER_COOKIE_MAX_AGE_SECONDS}`,
  ];

  if (owner.isSecure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function parseCookie(header: string) {
  const entries = header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) {
        return [part, ""] as const;
      }

      return [part.slice(0, separatorIndex), part.slice(separatorIndex + 1)] as const;
    });

  return Object.fromEntries(entries);
}

function isValidOwnerId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
