import fp from "fastify-plugin";
import { ZodError } from "zod";
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from "fastify-type-provider-zod";
import { AppError } from "@altyapi/commerce-core";

interface ErrorBody {
  error: { code: string; message_key: string; details?: unknown; correlation_id?: string | undefined };
}

/** Maps domain, validation and unexpected errors to a stable JSON error shape. */
export const errorsPlugin = fp(async (app) => {
  app.setErrorHandler((err, req, reply) => {
    const correlationId = req.opContext?.correlationId;
    const send = (status: number, body: ErrorBody) => reply.status(status).send(body);

    if (hasZodFastifySchemaValidationErrors(err)) {
      return send(422, {
        error: {
          code: "validation_failed",
          message_key: "errors.validation_failed",
          details: err.validation.map((v) => ({ path: v.instancePath, message: v.message })),
          correlation_id: correlationId,
        },
      });
    }
    if (err instanceof ZodError) {
      return send(422, {
        error: {
          code: "validation_failed",
          message_key: "errors.validation_failed",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          correlation_id: correlationId,
        },
      });
    }
    if (err instanceof AppError) {
      if (err.status >= 500) req.log.error({ err }, "app error");
      return send(err.status, {
        error: { code: err.code, message_key: err.messageKey, details: err.details, correlation_id: correlationId },
      });
    }
    if (isResponseSerializationError(err)) {
      req.log.error({ err }, "response serialization failed");
      return send(500, { error: { code: "internal", message_key: "errors.internal", correlation_id: correlationId } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return send(status, {
        error: {
          code: status === 429 ? "rate_limited" : "bad_request",
          message_key: status === 429 ? "errors.rate_limited" : "errors.bad_request",
          correlation_id: correlationId,
        },
      });
    }
    req.log.error({ err }, "unhandled error");
    return send(500, { error: { code: "internal", message_key: "errors.internal", correlation_id: correlationId } });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({
      error: { code: "not_found", message_key: "errors.route_not_found", correlation_id: req.opContext?.correlationId },
    }),
  );
});
