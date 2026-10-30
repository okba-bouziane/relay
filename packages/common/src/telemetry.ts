// Loaded before the service with `--import @relay/common/telemetry`, so instrumentation patches
// http, fastify, pg and ioredis before they are first imported.
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
if (endpoint) {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: (process.env.npm_package_name ?? 'relay').replace('@relay/', '') }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Message spans are created by hand in broker.ts (with W3C headers), and file-system
        // spans are noise for this project.
        '@opentelemetry/instrumentation-amqplib': { enabled: false },
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  })
  sdk.start()
  process.on('SIGTERM', () => void sdk.shutdown())
}
