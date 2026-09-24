import { pino, type Logger, type LoggerOptions } from "pino";
import { currentContext } from "./context";

/**
 * Paths that must never reach log sinks: secrets, credentials, tokens and card data.
 * Card data is never accepted by the platform, but the paths are listed defensively.
 */
export const REDACT_PATHS = [
  "password",
  "*.password",
  "passwordHash",
  "*.passwordHash",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",
  "secret",
  "*.secret",
  "apiKey",
  "*.apiKey",
  "apiSecret",
  "*.apiSecret",
  "merchantKey",
  "*.merchantKey",
  "merchantSalt",
  "*.merchantSalt",
  "credentials",
  "*.credentials",
  "cardNumber",
  "*.cardNumber",
  "cvv",
  "*.cvv",
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
];

export interface CreateLoggerOptions {
  service: string;
  level?: LoggerOptions["level"];
  pretty?: boolean;
}

export function createLogger(opts: CreateLoggerOptions): Logger {
  return pino({
    level: opts.level ?? "info",
    base: { service: opts.service },
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin() {
      const ctx = currentContext();
      if (!ctx) return {};
      return {
        correlation_id: ctx.correlationId,
        request_id: ctx.requestId,
        event_id: ctx.eventId,
        action_id: ctx.actionId,
        organization_id: ctx.organizationId,
        store_id: ctx.storeId,
        principal_type: ctx.principalType,
        principal_id: ctx.principalId,
        agent_id: ctx.agentId,
        session_id: ctx.sessionId,
      };
    },
    ...(opts.pretty
      ? { transport: { target: "pino-pretty", options: { colorize: true, singleLine: true } } }
      : {}),
  });
}

export type { Logger };
