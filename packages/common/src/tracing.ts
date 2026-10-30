import { context, propagation, SpanKind, SpanStatusCode, trace, type Context } from '@opentelemetry/api'

// Trace context crosses process boundaries in message headers (W3C "traceparent"), the same way
// it crosses HTTP calls. With it, Jaeger shows one trace for a whole saga: HTTP request ->
// orders -> inventory -> payments -> orders, even though no service calls another directly.

const tracer = trace.getTracer('relay')

export function currentTraceHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  propagation.inject(context.active(), headers)
  return headers
}

export function contextFromHeaders(headers: Record<string, unknown> | undefined): Context {
  return propagation.extract(context.active(), headers ?? {})
}

export function currentTraceId(): string | null {
  return trace.getActiveSpan()?.spanContext().traceId ?? null
}

/** Runs `work` inside a span; marks the span as failed if it throws. */
export async function inSpan<T>(name: string, kind: SpanKind, parent: Context, work: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { kind }, parent, async (span) => {
    try {
      return await work()
    } catch (error) {
      span.recordException(error as Error)
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message })
      throw error
    } finally {
      span.end()
    }
  })
}

export { SpanKind }
