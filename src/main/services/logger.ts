import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import winston from 'winston';

/**
 * File-based logger.
 *
 * Rolling file transport, 10 MB × 5 files under userData/logs/app.log.
 * Every service writes here via `log.info / log.warn / log.error`. On
 * startup we also pipe uncaught exceptions + unhandled rejections in.
 */

let _logger: winston.Logger | null = null;

export function logDir(): string {
  return path.join(app.getPath('userData'), 'logs');
}

function ensureDir(): void {
  try {
    fs.mkdirSync(logDir(), { recursive: true });
  } catch {
    /* already exists */
  }
}

function build(): winston.Logger {
  ensureDir();
  const fmt = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.printf((info) => {
      const level = info.level.padEnd(5);
      const meta = Object.keys(info).filter((k) => !['level', 'message', 'timestamp', 'stack'].includes(k));
      const metaStr = meta.length ? ' ' + JSON.stringify(Object.fromEntries(meta.map((k) => [k, (info as Record<string, unknown>)[k]]))) : '';
      const stack = info.stack ? '\n' + String(info.stack) : '';
      return `[${info.timestamp}] ${level} ${info.message}${metaStr}${stack}`;
    }),
  );
  const log = winston.createLogger({
    level: process.env['SENTINEL_LOG_LEVEL'] ?? 'info',
    format: fmt,
    transports: [
      new winston.transports.File({
        filename: path.join(logDir(), 'app.log'),
        maxsize: 10 * 1024 * 1024,
        maxFiles: 5,
        tailable: true,
      }),
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          fmt,
        ),
      }),
    ],
  });
  return log;
}

export const log = new Proxy({} as winston.Logger, {
  get(_t, key: keyof winston.Logger) {
    if (!_logger) _logger = build();
    return _logger[key];
  },
});

export function attachGlobalHandlers(): void {
  process.on('uncaughtException', (err) => {
    log.error('uncaughtException', { message: err.message, stack: err.stack });
  });
  process.on('unhandledRejection', (reason) => {
    log.error('unhandledRejection', { reason: String(reason) });
  });
}
