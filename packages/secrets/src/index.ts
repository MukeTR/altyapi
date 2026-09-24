import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms";

/**
 * Binds ciphertext to its owner and purpose. Used as KMS EncryptionContext and AES-GCM AAD,
 * so a credential blob copied to another store or purpose fails to decrypt.
 */
export type EncryptionContext = Record<string, string>;

export interface EnvelopeRecord {
  ciphertext: string;
  iv: string;
  authTag: string;
  encryptedDataKey: string;
  keyId: string;
}

export interface KeyProvider {
  /** Returns a fresh 256-bit data key and its wrapped form. */
  generateDataKey(context: EncryptionContext): Promise<{ plaintext: Buffer; encrypted: Buffer; keyId: string }>;
  decryptDataKey(encrypted: Buffer, keyId: string, context: EncryptionContext): Promise<Buffer>;
}

function aad(context: EncryptionContext): Buffer {
  return Buffer.from(JSON.stringify(Object.keys(context).sort().map((k) => [k, context[k]])), "utf8");
}

/** AWS KMS: data keys generated and unwrapped by KMS; the master key never leaves KMS. */
export class AwsKmsKeyProvider implements KeyProvider {
  private readonly client: KMSClient;
  constructor(
    private readonly keyId: string,
    region: string,
  ) {
    this.client = new KMSClient({ region });
  }

  async generateDataKey(context: EncryptionContext) {
    const res = await this.client.send(new GenerateDataKeyCommand({ KeyId: this.keyId, KeySpec: "AES_256", EncryptionContext: context }));
    if (!res.Plaintext || !res.CiphertextBlob) throw new Error("KMS returned no data key");
    return { plaintext: Buffer.from(res.Plaintext), encrypted: Buffer.from(res.CiphertextBlob), keyId: res.KeyId ?? this.keyId };
  }

  async decryptDataKey(encrypted: Buffer, keyId: string, context: EncryptionContext) {
    const res = await this.client.send(new DecryptCommand({ CiphertextBlob: encrypted, KeyId: keyId, EncryptionContext: context }));
    if (!res.Plaintext) throw new Error("KMS returned no plaintext");
    return Buffer.from(res.Plaintext);
  }
}

/**
 * Development key provider: wraps data keys with a local 256-bit master key (AES-GCM).
 * Refused in production so real credentials are always protected by KMS.
 */
export class LocalKeyProvider implements KeyProvider {
  private readonly master: Buffer;
  constructor(masterKeyBase64: string) {
    this.master = Buffer.from(masterKeyBase64, "base64");
    if (this.master.length !== 32) throw new Error("LOCAL_MASTER_KEY must be 32 bytes (base64)");
  }

  async generateDataKey(context: EncryptionContext) {
    const plaintext = randomBytes(32);
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.master, iv);
    c.setAAD(aad(context));
    const enc = Buffer.concat([c.update(plaintext), c.final()]);
    return { plaintext, encrypted: Buffer.concat([iv, c.getAuthTag(), enc]), keyId: "local" };
  }

  async decryptDataKey(encrypted: Buffer, _keyId: string, context: EncryptionContext) {
    const iv = encrypted.subarray(0, 12);
    const tag = encrypted.subarray(12, 28);
    const d = createDecipheriv("aes-256-gcm", this.master, iv);
    d.setAAD(aad(context));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(encrypted.subarray(28)), d.final()]);
  }
}

export async function encryptJson(provider: KeyProvider, value: unknown, context: EncryptionContext): Promise<EnvelopeRecord> {
  const { plaintext, encrypted, keyId } = await provider.generateDataKey(context);
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", plaintext, iv);
    cipher.setAAD(aad(context));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return {
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      encryptedDataKey: encrypted.toString("base64"),
      keyId,
    };
  } finally {
    plaintext.fill(0);
  }
}

export async function decryptJson<T>(provider: KeyProvider, record: EnvelopeRecord, context: EncryptionContext): Promise<T> {
  const dataKey = await provider.decryptDataKey(Buffer.from(record.encryptedDataKey, "base64"), record.keyId, context);
  try {
    const decipher = createDecipheriv("aes-256-gcm", dataKey, Buffer.from(record.iv, "base64"));
    decipher.setAAD(aad(context));
    decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "base64")), decipher.final()]);
    return JSON.parse(plain.toString("utf8")) as T;
  } finally {
    dataKey.fill(0);
  }
}

export interface SecretsEnv {
  SECRETS_DRIVER: "aws-kms" | "local";
  KMS_KEY_ID?: string | undefined;
  AWS_REGION: string;
  LOCAL_MASTER_KEY?: string | undefined;
  APP_ENV: string;
}

export function createKeyProvider(env: SecretsEnv): KeyProvider | null {
  if (env.SECRETS_DRIVER === "aws-kms") {
    if (!env.KMS_KEY_ID) throw new Error("SECRETS_DRIVER=aws-kms requires KMS_KEY_ID");
    return new AwsKmsKeyProvider(env.KMS_KEY_ID, env.AWS_REGION);
  }
  if (env.APP_ENV === "production") throw new Error("The local secrets driver is not allowed in production");
  return env.LOCAL_MASTER_KEY ? new LocalKeyProvider(env.LOCAL_MASTER_KEY) : null;
}
