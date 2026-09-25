/**
 * Only same-origin, path-absolute targets are accepted for ?next= (no "//host", no scheme, no
 * backslash tricks), so a crafted link cannot send the user to another site after signing in.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  if (/[\u0000-\u001f]/.test(value)) return "/";
  if (value.startsWith("/login") || value.startsWith("/register") || value.startsWith("/api/")) return "/";
  return value;
}
