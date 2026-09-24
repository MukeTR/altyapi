import { createHmac } from "node:crypto";
import { generateEkosistemCode, hashEkosistemCode, parseEkosistemCode } from "./codes";
import { assertMoneyVectors } from "./money";
import {
  canonicalTarget,
  computeSignatureHex,
  precheckSignedRequest,
  sha256Hex,
  signRequest,
  signingMessage,
  verifyAgainstLink,
  type HeaderBag,
} from "./signing";
import type { EkosistemProduct, SignedMethod } from "./constants";

/**
 * Runtime self-check of the §5 test vectors. The contract requires every implementation to
 * verify them automatically; altyapi does so at API and worker startup and refuses to run
 * when signing disagrees with the contract.
 */

const SECRET = "ekS3cr3t_testvector_0123456789abcdefghijklm";
const TIMESTAMP = 1790000000;
const LINK_ID = "0199b1c2-7d3e-7a10-9b2c-4f5e6a7b8c9d";

const V1 = {
  path: "/ekosistem/v1/links/0199b1c2-7d3e-7a10-9b2c-4f5e6a7b8c9d/confirm",
  product: "karmatik" as const,
  nonce: "bm9uY2UtdGVzdHZlY3Rvci0wMDAx",
  body: '{"account":{"id":"0199b1c2-0000-7000-8000-00000000a001","label":"Ergen Tekstil Çorap Şubesi"},"grants":["profit:read","pricing:read"]}',
  sha256: "5ade8de33499863f4f1ff3a8cda4d58e65b63c2f8c99ca92b79368db3d424123",
  signature: "v1=4af615a1f448a4a4a7172f7e5dfdbbaec0396535617647d2e67e5a6ff72e0115",
};

const V2 = {
  target: "/ekosistem/v1/catalog/products?since=2026-09-01T00:00:00Z&limit=2&cursor=eyJpZCI6IjEyMyJ9",
  product: "yanit" as const,
  canonical: "/ekosistem/v1/catalog/products?cursor=eyJpZCI6IjEyMyJ9&limit=2&since=2026-09-01T00%3A00%3A00Z",
  signature: "v1=825bf6462e3f9ceecb9c1d79c23a25a5d40a034d6794d071f739ec48505894c2",
  /** Same request as received with lower-case escapes, another order or a product prefix. */
  equivalentTargets: [
    "/ekosistem/v1/catalog/products?since=2026-09-01T00%3a00%3a00Z&limit=2&cursor=eyJpZCI6IjEyMyJ9",
    "/ekosistem/v1/catalog/products?limit=2&cursor=eyJpZCI6IjEyMyJ9&since=2026-09-01T00%3A00%3A00Z",
    "/api/ekosistem/v1/catalog/products?cursor=eyJpZCI6IjEyMyJ9&since=2026-09-01T00:00:00Z&limit=2",
  ],
};

const V3_SIGNATURE = "v1=1e9fa5620eb10b330da76c8c109efdf32d8bc8719fe41903c91e73613022ca66";
const V4_SIGNATURE = "v1=85ec7a5d7144d382115403464c5136ab5d8ddf40027456a5beba1af929b1a3ce";
const V5_NOW = 1790000301;

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function check(condition: boolean, label: string): void {
  if (!condition) throw new Error(`ekosistem self-check failed: ${label}`);
}

function inbound(opts: { method: SignedMethod | "HEAD"; target: string; product: EkosistemProduct; signature: string; body?: string; nonce?: string; now?: number }) {
  const headers: HeaderBag = {
    "ekosistem-link": LINK_ID,
    "ekosistem-product": opts.product,
    "ekosistem-timestamp": String(TIMESTAMP),
    "ekosistem-signature": opts.signature,
  };
  if (opts.nonce) headers["ekosistem-nonce"] = opts.nonce;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return precheckSignedRequest({
    method: opts.method,
    target: opts.target,
    headers,
    rawBody: Buffer.from(opts.body ?? "", "utf8"),
    nowSeconds: opts.now ?? TIMESTAMP,
  });
}

function verifies(pre: ReturnType<typeof inbound>, peerProduct: EkosistemProduct, secrets: string[] = [SECRET]): string {
  if (!pre.ok) return pre.code;
  const r = verifyAgainstLink(pre, { peerProduct, secrets });
  return r.ok ? "ok" : r.code;
}

/** Verifies V1..V5 of §5 (plus the §6.1 money vectors and code handling); throws on mismatch. */
export function assertEkosistemVectors(): void {
  // V1: POST with a UTF-8 body containing Turkish characters.
  check(sha256Hex(Buffer.from(V1.body, "utf8")) === V1.sha256, "V1 body SHA-256");
  check(canonicalTarget(V1.path) === V1.path, "V1 canonical path");
  const m1 = signingMessage({ timestamp: String(TIMESTAMP), product: V1.product, method: "POST", canonical: V1.path, bodySha256: V1.sha256, nonce: V1.nonce });
  check(`v1=${computeSignatureHex(SECRET, m1)}` === V1.signature, "V1 signature");
  const s1 = signRequest({ secret: SECRET, linkId: LINK_ID, product: V1.product, method: "POST", canonical: V1.path, body: Buffer.from(V1.body, "utf8"), timestamp: TIMESTAMP, nonce: V1.nonce });
  check(s1.headers["Ekosistem-Signature"] === V1.signature, "V1 outbound signing");
  check(verifies(inbound({ method: "POST", target: V1.path, product: "karmatik", signature: V1.signature, body: V1.body, nonce: V1.nonce }), "karmatik") === "ok", "V1 verification");
  check(
    verifies(inbound({ method: "POST", target: V1.path, product: "karmatik", signature: V1.signature, body: V1.body, nonce: V1.nonce }), "karmatik", ["A".repeat(43), SECRET]) === "ok",
    "V1 verification with the previous secret during rotation",
  );
  {
    // Rotation must be signed with the current key (§4.4): the verifier reports which secret matched.
    const pre = inbound({ method: "POST", target: V1.path, product: "karmatik", signature: V1.signature, body: V1.body, nonce: V1.nonce });
    const previous = pre.ok ? verifyAgainstLink(pre, { peerProduct: "karmatik", secrets: ["A".repeat(43), SECRET] }) : null;
    const current = pre.ok ? verifyAgainstLink(pre, { peerProduct: "karmatik", secrets: [SECRET, "A".repeat(43)] }) : null;
    check(previous?.ok === true && previous.secretIndex === 1 && current?.ok === true && current.secretIndex === 0, "V1 matched secret is reported (current vs previous)");
  }
  check(
    verifies(inbound({ method: "POST", target: V1.path, product: "karmatik", signature: V1.signature, body: `${V1.body} `, nonce: V1.nonce }), "karmatik") === "signature_invalid",
    "V1 re-serialised body must not verify",
  );
  check(verifies(inbound({ method: "POST", target: V1.path, product: "karmatik", signature: V1.signature, body: V1.body }), "karmatik") === "signature_invalid", "V1 without nonce must not verify");

  // V2: GET with a query in arbitrary order and escaping.
  check(canonicalTarget(V2.target) === V2.canonical, "V2 canonical query");
  for (const t of V2.equivalentTargets) check(canonicalTarget(t) === V2.canonical, `V2 canonical query for ${t}`);
  const m2 = signingMessage({ timestamp: String(TIMESTAMP), product: V2.product, method: "GET", canonical: V2.canonical, bodySha256: EMPTY_SHA256, nonce: null });
  check(`v1=${computeSignatureHex(SECRET, m2)}` === V2.signature, "V2 signature");
  const s2 = signRequest({ secret: SECRET, linkId: LINK_ID, product: V2.product, method: "GET", canonical: V2.canonical, body: new Uint8Array(0), timestamp: TIMESTAMP });
  check(s2.headers["Ekosistem-Signature"] === V2.signature && s2.nonce === null, "V2 outbound signing");
  for (const t of [V2.target, ...V2.equivalentTargets]) {
    check(verifies(inbound({ method: "GET", target: t, product: "yanit", signature: V2.signature }), "yanit") === "ok", `V2 verification for ${t}`);
  }
  const dup = inbound({ method: "GET", target: `${V2.target}&limit=3`, product: "yanit", signature: V2.signature });
  check(!dup.ok && dup.code === "bad_request", "repeated query key → 400");
  const withBody = inbound({ method: "GET", target: V2.target, product: "yanit", signature: V2.signature, body: "{}" });
  check(!withBody.ok && withBody.code === "bad_request", "GET with a body → 400");
  const head = inbound({ method: "HEAD", target: V2.target, product: "yanit", signature: V2.signature });
  check(!head.ok && head.code === "method_not_allowed", "HEAD → 405");

  // V3: the key must be the ASCII bytes of the secret, not its base64url decoding.
  const v3 = createHmac("sha256", Buffer.from(SECRET, "base64url")).update(m2, "utf8").digest("hex");
  check(`v1=${v3}` === V3_SIGNATURE, "V3 vector reproduces with a decoded key");
  check(verifies(inbound({ method: "GET", target: V2.target, product: "yanit", signature: V3_SIGNATURE }), "yanit") === "signature_invalid", "V3 must not verify");

  // V4: a signature made as karmatik must not verify on a yanit link.
  const m4 = signingMessage({ timestamp: String(TIMESTAMP), product: "karmatik", method: "GET", canonical: V2.canonical, bodySha256: EMPTY_SHA256, nonce: null });
  check(`v1=${computeSignatureHex(SECRET, m4)}` === V4_SIGNATURE, "V4 vector reproduces as karmatik");
  check(verifies(inbound({ method: "GET", target: V2.target, product: "karmatik", signature: V4_SIGNATURE }), "yanit") === "signature_invalid", "V4 must not verify on a yanit link");
  check(verifies(inbound({ method: "GET", target: V2.target, product: "yanit", signature: V4_SIGNATURE }), "yanit") === "signature_invalid", "V4 signature under the yanit header must not verify");

  // V5: server clock 301 s ahead → timestamp_skew; 300 s is still accepted.
  const v5 = inbound({ method: "GET", target: V2.target, product: "yanit", signature: V2.signature, now: V5_NOW });
  check(!v5.ok && v5.code === "timestamp_skew", "V5 → timestamp_skew");
  check(verifies(inbound({ method: "GET", target: V2.target, product: "yanit", signature: V2.signature, now: V5_NOW - 1 }), "yanit") === "ok", "V5 boundary (300 s) accepted");

  // §6.1 money conversion vectors.
  assertMoneyVectors();

  // §4.2 codes: format, normalisation and hashing.
  const code = generateEkosistemCode("altyapi");
  const parsed = parseEkosistemCode(code);
  check(/^ek1_a_[0-9A-HJKMNP-TV-Z]{26}$/.test(code) && parsed?.issuer === "altyapi", "code format");
  const sample = "ek1_a_7KQ2M9XH4TZP1B6WN3RCDVFJ8A";
  const typed = " EK1_a_7kq2-m9xh-4tzp-lb6w-n3rc-dvfj-8a ";
  check(hashEkosistemCode(sample) === hashEkosistemCode(typed), "code normalisation (case, spaces, dashes, L→1)");
  check(hashEkosistemCode("ek1_y_0000000000000000000000000O") === hashEkosistemCode("ek1_y_00000000000000000000000000"), "code normalisation (O→0)");
  check(parseEkosistemCode("ek1_x_7KQ2M9XH4TZP1B6WN3RCDVFJ8A") === null && parseEkosistemCode("ek1_a_7KQ2M9XH4TZP1B6WN3RCDVFJ8") === null, "invalid codes rejected");
}
