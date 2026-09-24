import { randomUUID } from "node:crypto";

/** Helpers live below commerce-core in the dependency graph, so they use v4 ids. */
export function newIdForHelpers(): string {
  return randomUUID();
}
