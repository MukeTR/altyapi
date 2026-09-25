import type { Messages } from "./messages/tr";

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : T[K] extends object ? Leaves<T[K], `${P}${K}.`> : never;
}[keyof T & string];

/** Every interface text key, e.g. "nav.overview". */
export type MessageKey = Leaves<Messages>;

export type MessageVars = Record<string, string | number>;

/** Replaces `{name}` placeholders; unknown placeholders are left as they are. */
export function interpolate(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (Object.hasOwn(vars, name) ? String(vars[name]) : match));
}

function lookup(messages: Messages, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object" || !Object.hasOwn(node, part)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

export interface Translator {
  (key: MessageKey, vars?: MessageVars): string;
  /** Text for a key built at runtime (e.g. `statuses.order.${status}`), or null when it doesn't exist. */
  maybe(key: string, vars?: MessageVars): string | null;
}

export function createTranslator(messages: Messages): Translator {
  const t = ((key: MessageKey, vars?: MessageVars) => {
    const template = lookup(messages, key);
    // A typed key always exists; the raw key is shown only if a catalog is out of sync.
    return template === undefined ? key : interpolate(template, vars);
  }) as Translator;
  t.maybe = (key, vars) => {
    const template = lookup(messages, key);
    return template === undefined ? null : interpolate(template, vars);
  };
  return t;
}
