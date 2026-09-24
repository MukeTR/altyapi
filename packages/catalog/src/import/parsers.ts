import type { Readable } from "node:stream";
import { parse as parseCsv } from "csv-parse";
import ExcelJS from "exceljs";
import { XMLParser } from "fast-xml-parser";

export type ImportFormat = "csv" | "xlsx" | "xml";

export interface SourceRow {
  /** 1-based data row number as the merchant sees it (header excluded for CSV/XLSX). */
  rowNumber: number;
  data: Record<string, string>;
}

export interface ParserOptions {
  csvDelimiter?: string;
  xmlItemPath?: string;
  /** XML: path (relative to the item) of repeated variant elements; each becomes one row. */
  xmlVariantPath?: string;
  maxXmlBytes?: number;
}

const MAX_XML_BYTES = 100 * 1024 * 1024;

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const v = value as { text?: string; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if (v.result !== undefined) return cellToString(v.result);
    if (v.text !== undefined) return String(v.text);
    if (v.hyperlink) return v.hyperlink;
    return "";
  }
  return String(value).trim();
}

/** Detects ; , or tab from the header line (Turkish Excel exports usually use ;). */
export function detectDelimiter(headerLine: string): string {
  const counts = [";", ",", "\t", "|"].map((d) => ({ d, n: headerLine.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0]!.n > 0 ? counts[0]!.d : ",";
}

async function* csvRows(stream: Readable, opts: ParserOptions): AsyncGenerator<SourceRow> {
  // Peek the first chunk to detect the delimiter and strip a UTF-8 BOM.
  const iterator = stream[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) return;
  let head = Buffer.from(first.value as Buffer).toString("utf8");
  if (head.charCodeAt(0) === 0xfeff) head = head.slice(1);
  const delimiter = opts.csvDelimiter ?? detectDelimiter(head.split(/\r?\n/)[0] ?? "");
  const parser = parseCsv({ delimiter, columns: (header: string[]) => header.map((h) => h.trim()), relax_column_count: true, skip_empty_lines: true, trim: true, bom: true });
  (async () => {
    parser.write(head);
    for (let r = await iterator.next(); !r.done; r = await iterator.next()) {
      if (!parser.write(r.value)) await new Promise((res) => parser.once("drain", res));
    }
    parser.end();
  })().catch((err) => parser.destroy(err as Error));
  let rowNumber = 0;
  for await (const record of parser as AsyncIterable<Record<string, string>>) {
    rowNumber++;
    yield { rowNumber, data: record };
  }
}

async function* xlsxRows(stream: Readable): AsyncGenerator<SourceRow> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(stream, {
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
    worksheets: "emit",
    entries: "emit",
  });
  for await (const sheet of reader) {
    let header: string[] | null = null;
    let rowNumber = 0;
    for await (const row of sheet) {
      const values = (row.values as unknown[]).slice(1).map(cellToString);
      if (!header) {
        header = values.map((h) => h.trim());
        continue;
      }
      if (values.every((v) => v === "")) continue;
      rowNumber++;
      yield { rowNumber, data: Object.fromEntries(header.map((h, i) => [h, values[i] ?? ""]).filter(([h]) => h)) };
    }
    break; // only the first worksheet is imported
  }
}

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").filter(Boolean).reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), obj);
}

/** Flattens nested XML objects into dot paths; repeated primitive values are comma-joined. */
export function flatten(value: unknown, prefix = "", out: Record<string, string> = {}, skip?: string): Record<string, string> {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== "object" || v === null)) out[prefix] = value.map((v) => String(v ?? "")).join(",");
    else value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out, skip));
    return out;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (skip && key === skip) continue;
      if (k === "#text") out[prefix || "#text"] = String(v).trim();
      else flatten(v, key, out, skip);
    }
    return out;
  }
  out[prefix] = String(value).trim();
  return out;
}

async function* xmlRows(stream: Readable, opts: ParserOptions): AsyncGenerator<SourceRow> {
  const limit = opts.maxXmlBytes ?? MAX_XML_BYTES;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error(`XML file exceeds ${Math.round(limit / 1024 / 1024)} MB`);
    chunks.push(chunk as Buffer);
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    processEntities: true,
    // Entity expansion is limited by the parser; DOCTYPE entities are not resolved from external sources.
  });
  const doc = parser.parse(Buffer.concat(chunks).toString("utf8"));
  if (!opts.xmlItemPath) throw new Error("xmlItemPath is required for XML imports");
  const itemsRaw = getPath(doc, opts.xmlItemPath);
  const items = Array.isArray(itemsRaw) ? itemsRaw : itemsRaw ? [itemsRaw] : [];
  let rowNumber = 0;
  for (const item of items) {
    const base = flatten(item, "", {}, opts.xmlVariantPath);
    const variantsRaw = opts.xmlVariantPath ? getPath(item, opts.xmlVariantPath) : undefined;
    const variants = Array.isArray(variantsRaw) ? variantsRaw : variantsRaw ? [variantsRaw] : [];
    if (!variants.length) {
      rowNumber++;
      yield { rowNumber, data: base };
      continue;
    }
    for (const v of variants) {
      rowNumber++;
      yield { rowNumber, data: { ...base, ...flatten(v, opts.xmlVariantPath) } };
    }
  }
}

export function readRows(stream: Readable, format: ImportFormat, opts: ParserOptions = {}): AsyncGenerator<SourceRow> {
  switch (format) {
    case "csv":
      return csvRows(stream, opts);
    case "xlsx":
      return xlsxRows(stream);
    case "xml":
      return xmlRows(stream, opts);
  }
}

/** Reads up to `limit` rows for column detection and mapping samples. */
export async function sampleRows(stream: Readable, format: ImportFormat, opts: ParserOptions, limit = 20) {
  const rows: SourceRow[] = [];
  const columns = new Set<string>();
  for await (const row of readRows(stream, format, opts)) {
    rows.push(row);
    Object.keys(row.data).forEach((k) => columns.add(k));
    if (rows.length >= limit) break;
  }
  stream.destroy();
  return { columns: [...columns], rows };
}
