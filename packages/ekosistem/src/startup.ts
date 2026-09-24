import type { Logger } from "@altyapi/observability";
import { resolvePeerBases, type EkosistemEnv, type PeerBases } from "./peers";
import { assertEkosistemVectors } from "./vectors";

/**
 * Startup check for processes that sign or verify ekosistem requests (API and worker):
 * the §5 vectors must pass, and peer bases must satisfy the §2 policy. A policy violation
 * stops a production process; elsewhere the offending peer is disabled with a warning.
 */
export function runEkosistemStartupChecks(env: EkosistemEnv, logger?: Logger): PeerBases {
  assertEkosistemVectors();
  const { bases, problems } = resolvePeerBases(env);
  if (problems.length) {
    const summary = problems.map((p) => `${p.variable}: ${p.reason}`).join("; ");
    if (env.APP_ENV === "production") throw new Error(`Invalid ekosistem configuration: ${summary}`);
    logger?.warn({ problems }, "ekosistem peer bases rejected by policy; those peers are disabled");
  }
  logger?.info({ karmatik: Boolean(bases.karmatik), yanit: Boolean(bases.yanit) }, "ekosistem self-check passed");
  return bases;
}
