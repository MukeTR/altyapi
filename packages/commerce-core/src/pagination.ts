import { z } from "zod";

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Opaque keyset cursor encoding (sort key + id) so pagination is stable under inserts. */
export function encodeCursor(parts: (string | number)[]): string {
  return Buffer.from(JSON.stringify(parts), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): (string | number)[] {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(parsed) && parsed.every((p) => typeof p === "string" || typeof p === "number")) {
      return parsed;
    }
  } catch {
    // fall through to the error below
  }
  throw new Error("Invalid cursor");
}
