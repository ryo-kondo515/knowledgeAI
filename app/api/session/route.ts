import { getRequestOwner, jsonWithOwner } from "@/lib/api-request";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const owner = getRequestOwner(request);
  return jsonWithOwner(owner, { ownerId: owner.id });
}
