/**
 * Inline script that runs during HTML parsing (before first paint). The type switch keeps React
 * from warning about <script> during client rendering; suppressHydrationWarning accepts the
 * server markup.
 */
export function InlineScript({ html }: { html: string }) {
  return <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />;
}
