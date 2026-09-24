import { trace, SpanStatusCode, type Span } from "@opentelemetry/api";

/**
 * Wraps an async operation in an OpenTelemetry span. When no SDK is registered the API
 * is a no-op, so services work unchanged until an exporter is configured.
 */
export async function withSpan<T>(
  tracerName: string,
  spanName: string,
  attributes: Record<string, string | number | boolean | undefined>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer(tracerName);
  return tracer.startActiveSpan(spanName, async (span) => {
    for (const [k, v] of Object.entries(attributes)) {
      if (v !== undefined) span.setAttribute(k, v);
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}
