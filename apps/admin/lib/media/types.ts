/** Asset as returned by the media endpoints (GET assets, GET assets/:id, complete, PATCH). */
export interface Asset {
  id: string;
  kind: "image" | "video" | "document" | "font" | "data" | "other" | (string & {});
  status: "pending_upload" | "uploaded" | "processing" | "ready" | "failed" | (string & {});
  contentType: string;
  byteSize: number;
  originalFilename: string | null;
  altText: Record<string, string>;
  width: number | null;
  height: number | null;
  /** Public URL (storefront bucket, ready assets only). */
  url: string | null;
  /** Resized image URLs by preset (thumbnail, card, product, zoom, hero-mobile, hero-desktop, social). */
  variants: Record<string, string> | null;
  failureReason: string | null;
  createdAt: string;
}

export interface UploadTicket {
  assetId: string;
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
}

export type AssetPurpose = "media" | "private_document" | "import";

/** File-type tabs of the media library (Storefront › Media); "all" lists every ready file. */
export const MEDIA_KINDS = ["image", "video", "font", "all"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const MEDIA_PAGE_SIZE = 48;
