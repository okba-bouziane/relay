import { pino } from 'pino'

export function createLogger(service: string) {
  return pino({
    name: service,
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.stdout.isTTY ? { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } } : undefined,
  })
}

export type Logger = ReturnType<typeof createLogger>
