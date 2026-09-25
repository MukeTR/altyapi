"use client";

import { useCallback } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { ApiError, bff } from "@/lib/api/client";
import type { Asset, AssetPurpose, UploadTicket } from "@/lib/media/types";

export interface UploadOptions {
  file: File;
  sha256: string;
  purpose?: AssetPurpose;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

const POLL_TIMEOUT_MS = 60_000;

/** Browsers leave File.type empty for some types (WOFF2, AVIF on older systems); infer those from the extension. */
const TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  woff2: "font/woff2",
  pdf: "application/pdf",
  csv: "text/csv",
  xml: "application/xml",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function contentTypeOf(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TYPE_BY_EXTENSION[ext] ?? "application/octet-stream";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

/** PUT to the presigned storage URL with progress events (fetch has no upload progress). */
function putObject(ticket: UploadTicket, file: File, onProgress?: (percent: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(ticket.method, ticket.uploadUrl);
    for (const [name, value] of Object.entries(ticket.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`storage ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("storage network"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

/**
 * Uploads a file into the store's media library: request an upload URL, send the bytes straight
 * to storage, confirm, then wait for the worker to process it (images get their size variants).
 * Resolves with the asset (usually "ready"; "processing" when the worker takes longer than a
 * minute). Throws an Error with a localized message.
 */
export function useUploader() {
  const { t, describeError } = useI18n();
  const { apiBase } = useStore();

  return useCallback(
    async ({ file, sha256, purpose = "media", onProgress, signal }: UploadOptions): Promise<Asset> => {
      try {
        const ticket = await bff<UploadTicket>(`${apiBase}/assets/uploads`, {
          method: "POST",
          body: { purpose, filename: file.name.slice(0, 255), contentType: contentTypeOf(file), byteSize: file.size, sha256 },
          ...(signal ? { signal } : {}),
        });
        try {
          await putObject(ticket, file, onProgress, signal);
        } catch (err) {
          if ((err as { name?: string }).name === "AbortError") throw err;
          throw new Error(t("media.storageFailed"));
        }
        let asset = await bff<Asset>(`${apiBase}/assets/${ticket.assetId}/complete`, { method: "POST", ...(signal ? { signal } : {}) });
        const started = Date.now();
        let delay = 800;
        while (asset.status !== "ready" && asset.status !== "failed" && Date.now() - started < POLL_TIMEOUT_MS) {
          await sleep(delay, signal);
          delay = Math.min(delay * 1.5, 3000);
          asset = await bff<Asset>(`${apiBase}/assets/${ticket.assetId}`, signal ? { signal } : {});
        }
        if (asset.status === "failed") throw new Error(t("media.processingFailed"));
        return asset;
      } catch (err) {
        if (err instanceof ApiError) throw new Error(describeError(err.toInfo()).message);
        throw err;
      }
    },
    [apiBase, t, describeError],
  );
}
