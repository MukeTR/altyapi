import "server-only";
import type { MediaConfig } from "./media";

/** Media configuration of this deployment (server only; pass the result to client components). */
export function mediaConfig(): MediaConfig {
  const base = process.env.MEDIA_PUBLIC_BASE_URL || null;
  return { base, transforms: Boolean(base) && (process.env.APP_ENV ?? "local") !== "local" };
}
