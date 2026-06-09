import { createHash } from "node:crypto";
import { getRequestOwner, jsonWithOwner } from "@/lib/api-request";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const owner = getRequestOwner(request);
  const migrationScope = createHash("sha256").update(`local-storage-migration:${owner.id}`).digest("hex");
  return jsonWithOwner(owner, { migrationScope });
}
