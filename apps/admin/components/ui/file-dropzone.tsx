"use client";

import { CircleAlert, CircleCheck, RotateCw, Upload, X } from "lucide-react";
import { useCallback, useId, useRef, useState, type DragEvent } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { Progress } from "./progress";
import { Spinner } from "./spinner";

export interface UploadTask {
  file: File;
  /** Hex SHA-256 of the file (the API requires it when requesting an upload URL). */
  sha256: string;
  onProgress: (percent: number) => void;
  signal: AbortSignal;
}

type ItemState =
  | { status: "hashing" }
  | { status: "uploading"; percent: number }
  | { status: "done" }
  | { status: "failed"; message: string };

interface Item {
  key: string;
  file: File;
  state: ItemState;
}

export interface FileDropzoneProps {
  /** Performs the upload; throw (with a localized message) to mark the file failed. */
  upload: (task: UploadTask) => Promise<void>;
  /** input accept attribute, e.g. "image/*" or ".csv,.xlsx,.xml". */
  accept?: string;
  multiple?: boolean;
  /** Human-readable list of allowed types. */
  acceptLabel?: string;
  disabled?: boolean;
  className?: string;
}

export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Keyboard-operable drop target (Enter/Space opens the file picker). Each file is hashed with
 * WebCrypto, then handed to `upload`, with per-file progress, retry and remove.
 */
export function FileDropzone({ upload, accept, multiple = true, acceptLabel, disabled, className }: FileDropzoneProps) {
  const { t } = useI18n();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const controllers = useRef(new Map<string, AbortController>());

  const setState = (key: string, state: ItemState) => setItems((list) => list.map((i) => (i.key === key ? { ...i, state } : i)));

  const run = useCallback(
    async (key: string, file: File) => {
      const controller = new AbortController();
      controllers.current.set(key, controller);
      try {
        setState(key, { status: "hashing" });
        const sha256 = await sha256Hex(file);
        setState(key, { status: "uploading", percent: 0 });
        await upload({ file, sha256, signal: controller.signal, onProgress: (percent) => setState(key, { status: "uploading", percent }) });
        setState(key, { status: "done" });
      } catch (err) {
        if (controller.signal.aborted) return;
        setState(key, { status: "failed", message: err instanceof Error && err.message ? err.message : t("ui.upload.failed") });
      } finally {
        controllers.current.delete(key);
      }
    },
    [upload, t],
  );

  const add = (files: FileList | null) => {
    if (!files || disabled) return;
    const list = Array.from(multiple ? files : [files[0]].filter((f): f is File => Boolean(f)));
    const added = list.map((file) => ({ key: `${file.name}-${file.size}-${crypto.randomUUID()}`, file, state: { status: "hashing" } as ItemState }));
    setItems((prev) => [...prev, ...added]);
    for (const item of added) void run(item.key, item.file);
  };

  const remove = (key: string) => {
    controllers.current.get(key)?.abort();
    setItems((list) => list.filter((i) => i.key !== key));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    add(e.dataTransfer.files);
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-describedby={acceptLabel ? `${inputId}-accept` : undefined}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors",
          dragging ? "border-accent bg-accent-subtle" : "border-border-control bg-surface hover:bg-surface-muted",
          disabled && "cursor-not-allowed opacity-55",
        )}
      >
        <Upload aria-hidden="true" className="size-5 text-fg-muted" />
        <span className="text-base text-fg">{t("ui.upload.dropzone")}</span>
        {acceptLabel ? (
          <span id={`${inputId}-accept`} className="text-sm text-fg-subtle">
            {t("ui.upload.accepted", { types: acceptLabel })}
          </span>
        ) : null}
      </div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        aria-label={t("ui.upload.dropzoneLabel")}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      {items.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
          {items.map((item) => (
            <li key={item.key} className="flex items-center gap-3 px-3 py-2">
              <span className="flex size-5 shrink-0 items-center justify-center">
                {item.state.status === "done" ? (
                  <CircleCheck aria-hidden="true" className="size-4 text-success" />
                ) : item.state.status === "failed" ? (
                  <CircleAlert aria-hidden="true" className="size-4 text-danger" />
                ) : (
                  <Spinner className="text-fg-muted" />
                )}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-base text-fg">{item.file.name}</span>
                {item.state.status === "uploading" ? (
                  <Progress value={item.state.percent} aria-label={t("ui.upload.progress", { name: item.file.name, percent: item.state.percent })} />
                ) : (
                  <span aria-live="polite" className={cn("text-sm", item.state.status === "failed" ? "text-danger" : "text-fg-muted")}>
                    {item.state.status === "hashing" ? t("ui.upload.hashing") : item.state.status === "done" ? t("ui.upload.done") : item.state.status === "failed" ? item.state.message : ""}
                  </span>
                )}
              </div>
              {item.state.status === "failed" ? (
                <Button size="sm" variant="ghost" onClick={() => void run(item.key, item.file)}>
                  <RotateCw aria-hidden="true" />
                  {t("ui.upload.retry")}
                </Button>
              ) : null}
              <Button size="icon-sm" variant="ghost" aria-label={t("ui.upload.remove", { name: item.file.name })} onClick={() => remove(item.key)}>
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
