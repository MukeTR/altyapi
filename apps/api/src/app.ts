import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  createSerializerCompiler,
  jsonSchemaTransform,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { newId } from "@altyapi/commerce-core";
import type { AppDeps } from "./deps";
import { contextPlugin } from "./plugins/context";
import { errorsPlugin } from "./plugins/errors";
import { authPlugin } from "./plugins/auth";
import { healthRoutes } from "./modules/health";
import { authRoutes } from "./modules/auth";
import { organizationRoutes } from "./modules/organizations";
import { storeRoutes } from "./modules/stores";
import { domainRoutes } from "./modules/domains";
import { createDomainDeps } from "@altyapi/domains";
import { createR2Storage } from "@altyapi/storage";
import { assetRoutes } from "./modules/assets";
import { storefrontRoutes } from "./modules/storefront";
import { siteRoutes } from "./modules/site";
import { contentRoutes } from "./modules/content";
import { catalogRoutes } from "./modules/catalog";
import { importRoutes } from "./modules/imports";
import { storefrontApiRoutes } from "./modules/storefront-api";
import { storefrontCartRoutes } from "./modules/storefront-cart";
import { paymentCallbackRoutes } from "./modules/payment-callbacks";
import { orderRoutes } from "./modules/orders";
import { trackingRoutes } from "./modules/tracking";
import { integrationRoutes } from "./modules/integrations";
import { ekosistemRoutes } from "./modules/ekosistem";
import { ekosistemPublicRoutes } from "./modules/ekosistem-public";

/** bigint (money minor units) is serialized as a decimal string on the wire. */
const bigintReplacer = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: deps.logger as FastifyBaseLogger,
    genReqId: () => newId(),
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  // Bodyless POSTs (publish, retry, rollback…) are accepted even when a JSON content-type is sent.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const text = typeof body === "string" ? body : body.toString("utf8");
    if (text.trim() === "") return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      const err = new Error("Invalid JSON body") as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(createSerializerCompiler({ replacer: bigintReplacer }));
  // Routes without a response schema use this serializer; bigint must never break a response.
  app.setReplySerializer((payload) => JSON.stringify(payload, bigintReplacer));

  await app.register(contextPlugin);
  await app.register(errorsPlugin);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: [new URL(deps.env.ADMIN_URL).origin, ...deps.env.CORS_ALLOWED_ORIGINS],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposedHeaders: ["x-correlation-id"],
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: "1 minute",
    redis: deps.redis,
    nameSpace: "rl:",
    keyGenerator: (req) => req.auth?.user.id ?? req.ip,
  });
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: { title: "altyapi.io Commerce API", version: "1.0.0" },
      servers: [{ url: deps.env.API_URL }],
      components: {
        securitySchemes: {
          session: { type: "apiKey", in: "cookie", name: deps.env.SESSION_COOKIE_NAME },
          bearer: { type: "http", scheme: "bearer" },
        },
      },
      security: [{ session: [] }, { bearer: [] }],
    },
    transform: jsonSchemaTransform,
  });
  if (deps.env.APP_ENV !== "production") {
    await app.register(swaggerUi, { routePrefix: "/docs" });
  }
  await app.register(authPlugin, { deps });

  await app.register(healthRoutes, { deps });
  await app.register(authRoutes, { deps });
  await app.register(organizationRoutes, { deps });
  await app.register(storeRoutes, { deps });

  const domainDeps = createDomainDeps(deps.env, deps.db);
  await app.register(domainRoutes, { deps, domainDeps });
  await app.register(assetRoutes, { deps, r2: createR2Storage(deps.env) });
  await app.register(storefrontRoutes, { deps });
  await app.register(siteRoutes, { deps });
  await app.register(contentRoutes, { deps });
  await app.register(catalogRoutes, { deps });
  await app.register(importRoutes, { deps, queue: deps.queue });
  await app.register(storefrontApiRoutes, { deps });
  await app.register(storefrontCartRoutes, { deps });
  await app.register(orderRoutes, { deps });
  await app.register(trackingRoutes, { deps });
  await app.register(integrationRoutes, { deps });
  await app.register(ekosistemRoutes, { deps });
  // Encapsulated: raw-body parsing, §6.4 error envelope and per-link limits only apply under /ekosistem/v1.
  await app.register(ekosistemPublicRoutes, { deps });
  // Encapsulated: custom body parsing (raw body + form) only applies to provider callbacks.
  await app.register(paymentCallbackRoutes, { deps });

  return app as unknown as FastifyInstance;
}
