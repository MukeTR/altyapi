"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict" | "blocked";

/** A validation problem of a draft (from the API's errors.content.invalid or a local required check). */
export interface DraftIssue {
  path: string;
  message: string;
}

export interface DraftOptions<T> {
  initial: T;
  /** Draft revision of a server value (sent as expectedRevision). */
  revision: (value: T) => number;
  /** Sends the local value on top of `expectedRevision` and resolves with the saved server value. */
  save: (local: T, server: T, expectedRevision: number) => Promise<T>;
  /** Local checks run before saving (e.g. required fields); any issue blocks the save. */
  validate?: (local: T) => DraftIssue[];
  /** Turns the API's issue paths (array indexes of what was sent) into stable ones. */
  mapIssues?: (issues: DraftIssue[], sent: T) => DraftIssue[];
  /** Called after every successful save. */
  onSaved?: (saved: T) => void;
  /** False makes the draft read-only (the user may not edit this resource). */
  enabled: boolean;
  debounceMs?: number;
}

export interface Draft<T> {
  /** What the editor shows: the server value plus unsaved local edits. */
  value: T;
  /** Last value confirmed by the server. */
  server: T;
  status: SaveStatus;
  error: ApiErrorInfo | null;
  issues: DraftIssue[];
  savedAt: number | null;
  /** Server revision reported by a 409 conflict. */
  conflictRevision: number | null;
  /** True while local edits are not yet saved. */
  dirty: boolean;
  update: (fn: (current: T) => T, opts?: { immediate?: boolean }) => void;
  /** Saves pending edits now; resolves true when everything is saved. */
  flush: () => Promise<boolean>;
  /**
   * Revision the next request must send as expectedRevision. Read after awaiting flush(): unlike
   * `server`, which is state captured at render time, it already includes saves made meanwhile.
   */
  currentRevision: () => number;
  /** Replaces local and server state with a fresh server value (after undo/redo, reload, publish). */
  replace: (fresh: T) => void;
  retry: () => void;
  /** After a conflict: save the local edits on top of the newer server revision. */
  overwrite: () => void;
}

function toInfo(err: unknown): ApiErrorInfo {
  if (err instanceof ApiError) return err.toInfo();
  return { status: 0, code: "network", messageKey: "errors.network", correlationId: null };
}

function issuesOf(info: ApiErrorInfo): DraftIssue[] {
  const details = info.details as { issues?: unknown } | unknown[] | undefined;
  const list = Array.isArray(details) ? details : Array.isArray((details as { issues?: unknown })?.issues) ? ((details as { issues: unknown[] }).issues) : [];
  return list.flatMap((i) => {
    const issue = i as { path?: unknown; message?: unknown };
    if (typeof issue.message !== "string") return [];
    const path = typeof issue.path === "string" ? issue.path.replace(/^\//, "").replace(/\//g, ".") : "";
    return [{ path, message: issue.message }];
  });
}

/**
 * Autosaving draft of one storefront resource (a page or the theme). Edits are applied locally
 * at once and saved after a short pause; saves are serialized so each one carries the revision
 * the previous one produced (optimistic concurrency). A 409 stops autosaving until the user
 * reloads the newer version or overwrites it; a 422 keeps the edits and shows the issues.
 */
export function useDraft<T>(options: DraftOptions<T>): Draft<T> {
  const opts = useRef(options);
  opts.current = options;
  const debounce = options.debounceMs ?? 900;

  const [value, setValue] = useState(options.initial);
  const [server, setServer] = useState(options.initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [issues, setIssues] = useState<DraftIssue[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [conflictRevision, setConflictRevision] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);

  const local = useRef(options.initial);
  const serverRef = useRef(options.initial);
  const expected = useRef(options.revision(options.initial));
  const edit = useRef(0);
  const savedEdit = useRef(0);
  const generation = useRef(0);
  const halted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));

  const saveOnce = useCallback(async (): Promise<boolean> => {
    if (halted.current) return false;
    if (edit.current === savedEdit.current) return true;
    const o = opts.current;
    const sent = local.current;
    const localIssues = o.validate?.(sent) ?? [];
    if (localIssues.length) {
      setIssues(localIssues);
      setStatus("blocked");
      return false;
    }
    const version = edit.current;
    const gen = generation.current;
    setStatus("saving");
    try {
      const saved = await o.save(sent, serverRef.current, expected.current);
      if (gen !== generation.current) return true;
      serverRef.current = saved;
      expected.current = o.revision(saved);
      savedEdit.current = version;
      setServer(saved);
      const clean = edit.current === version;
      if (clean) {
        local.current = saved;
        setValue(saved);
      }
      setError(null);
      setIssues([]);
      setSavedAt(Date.now());
      setDirty(!clean);
      setStatus(clean ? "saved" : "dirty");
      o.onSaved?.(saved);
      return clean;
    } catch (err) {
      if (gen !== generation.current) return false;
      const info = toInfo(err);
      if (info.status === 409 && info.messageKey === "errors.content.revision_conflict") {
        halted.current = true;
        const current = (info.details as { currentRevision?: unknown } | undefined)?.currentRevision;
        setConflictRevision(typeof current === "number" ? current : null);
        setStatus("conflict");
      } else {
        const raw = issuesOf(info);
        setIssues(o.mapIssues ? o.mapIssues(raw, sent) : raw);
        setError(info);
        setStatus("error");
      }
      return false;
    }
  }, []);

  const run = useCallback((): Promise<boolean> => {
    const next = chain.current.then(saveOnce, saveOnce);
    chain.current = next.catch(() => false);
    return next;
  }, [saveOnce]);

  const schedule = useCallback(
    (delay: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void run();
      }, delay);
    },
    [run],
  );

  const update = useCallback(
    (fn: (current: T) => T, o?: { immediate?: boolean }) => {
      if (!opts.current.enabled) return;
      const next = fn(local.current);
      if (next === local.current) return;
      local.current = next;
      edit.current += 1;
      setValue(next);
      setDirty(true);
      if (!halted.current) {
        setStatus((s) => (s === "saving" ? s : "dirty"));
        schedule(o?.immediate ? 120 : debounce);
      }
    },
    [schedule, debounce],
  );

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const ok = await run();
    return ok && edit.current === savedEdit.current;
  }, [run]);

  const currentRevision = useCallback(() => expected.current, []);

  const replace = useCallback((fresh: T) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    generation.current += 1;
    halted.current = false;
    local.current = fresh;
    serverRef.current = fresh;
    expected.current = opts.current.revision(fresh);
    edit.current += 1;
    savedEdit.current = edit.current;
    setValue(fresh);
    setServer(fresh);
    setDirty(false);
    setError(null);
    setIssues([]);
    setConflictRevision(null);
    setStatus("idle");
  }, []);

  const retry = useCallback(() => {
    void run();
  }, [run]);

  const overwrite = useCallback(() => {
    if (conflictRevision !== null) expected.current = conflictRevision;
    halted.current = false;
    setConflictRevision(null);
    void run();
  }, [conflictRevision, run]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return useMemo(
    () => ({ value, server, status, error, issues, savedAt, conflictRevision, dirty, update, flush, currentRevision, replace, retry, overwrite }),
    [value, server, status, error, issues, savedAt, conflictRevision, dirty, update, flush, currentRevision, replace, retry, overwrite],
  );
}
