/**
 * Client-side checks mirroring the API's redirect rules (theme-engine createRedirectSchema), so
 * problems show up while typing and in the import preview. The API remains the authority.
 */

/** System routes that can never be redirected (checkout, cart, account, APIs, crawler files). */
const RESERVED_PATH = /^\/(?:[a-z]{2}\/)?(?:checkout|cart|account|api|_next|__edge|robots\.txt|sitemap\.xml|sitemaps)(?:\/|$|\?)/i;

export type RedirectProblem = "from_invalid" | "from_reserved" | "to_invalid" | "loop";

function isPath(p: string): boolean {
  return p.startsWith("/") && !p.startsWith("//") && p.length <= 1000;
}

function isUrl(p: string): boolean {
  try {
    const u = new URL(p);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function redirectProblem(fromPath: string, toPath: string): RedirectProblem | null {
  const from = fromPath.trim();
  const to = toPath.trim();
  if (!isPath(from)) return "from_invalid";
  if (RESERVED_PATH.test(from)) return "from_reserved";
  if (!isPath(to) && !isUrl(to)) return "to_invalid";
  if (from === to) return "loop";
  return null;
}

export interface ParsedRedirect {
  line: number;
  fromPath: string;
  toPath: string;
  statusCode: 301 | 302;
  problem: RedirectProblem | "status_invalid" | "columns" | null;
}

/**
 * Parses "old,new[,301|302]" lines (comma, semicolon or tab separated). A first line that
 * does not start with "/" is treated as a header. Quotes around values are removed.
 */
export function parseRedirectLines(text: string): ParsedRedirect[] {
  const lines = text.split(/\r?\n/);
  const out: ParsedRedirect[] = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const sep = line.includes("\t") ? "\t" : line.includes(";") && !line.includes(",") ? ";" : ",";
    const cells = line.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, "$1").trim());
    if (out.length === 0 && i === lines.findIndex((l) => l.trim()) && cells[0] && !cells[0].startsWith("/")) return;
    const [from = "", to = "", status = ""] = cells;
    const code = status === "" ? 301 : Number(status);
    const statusOk = code === 301 || code === 302;
    out.push({
      line: i + 1,
      fromPath: from,
      toPath: to,
      statusCode: statusOk ? (code as 301 | 302) : 301,
      problem: !from || !to ? "columns" : !statusOk ? "status_invalid" : redirectProblem(from, to),
    });
  });
  return out;
}
