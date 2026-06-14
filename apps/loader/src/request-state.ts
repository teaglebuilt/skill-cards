import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type { Permissions } from "@skill-cards/skill-manifest";

const ENVELOPE_VERSION = 1;
const ENVELOPE_TTL_SECONDS = 600;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const ALGO = "aes-256-gcm";

export interface SealedPayload {
  v: 1;
  iat: number;
  exp: number;
  jti: string;
  skill: string;
  tool: string;
  args: Record<string, unknown>;
  requested: Permissions;
}

export interface SealerOptions {
  key?: Buffer;
  serverId?: string;
  ttlSeconds?: number;
}

export class RequestStateSealer {
  private readonly key: Buffer;
  private readonly aad: Buffer;
  private readonly ttlSeconds: number;
  private readonly guard = new ReplayGuard();

  constructor(opts: SealerOptions = {}) {
    this.key = opts.key ?? resolveKey();
    this.aad = Buffer.from(opts.serverId ?? randomUUID(), "utf8");
    this.ttlSeconds = opts.ttlSeconds ?? ENVELOPE_TTL_SECONDS;
  }

  seal(
    input: Omit<SealedPayload, "v" | "iat" | "exp" | "jti">,
  ): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: SealedPayload = {
      v: 1,
      iat: now,
      exp: now + this.ttlSeconds,
      jti: randomUUID(),
      ...input,
    };
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, this.key, iv);
    cipher.setAAD(this.aad);
    const ct = Buffer.concat([
      cipher.update(Buffer.from(JSON.stringify(payload), "utf8")),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, ct, tag]).toString("base64url");
  }

  open(token: string): SealedPayload {
    const buf = Buffer.from(token, "base64url");
    if (buf.length < IV_BYTES + TAG_BYTES + 1) {
      throw new Error("requestState: malformed envelope");
    }
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(buf.length - TAG_BYTES);
    const ct = buf.subarray(IV_BYTES, buf.length - TAG_BYTES);

    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAAD(this.aad);
    decipher.setAuthTag(tag);

    let plaintext: Buffer;
    try {
      plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
    } catch {
      throw new Error("requestState: decryption failed");
    }

    let payload: SealedPayload;
    try {
      payload = JSON.parse(plaintext.toString("utf8")) as SealedPayload;
    } catch {
      throw new Error("requestState: payload is not valid JSON");
    }

    if (payload.v !== ENVELOPE_VERSION) {
      throw new Error(`requestState: unsupported version ${payload.v}`);
    }
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) {
      throw new Error("requestState: envelope expired");
    }
    if (!this.guard.claim(payload.jti, payload.exp)) {
      throw new Error("requestState: replay detected");
    }
    return payload;
  }
}

class ReplayGuard {
  private readonly seen = new Map<string, number>();

  claim(jti: string, expSeconds: number): boolean {
    this.sweep();
    if (this.seen.has(jti)) return false;
    this.seen.set(jti, expSeconds);
    return true;
  }

  private sweep(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [jti, exp] of this.seen) {
      if (exp <= now) this.seen.delete(jti);
    }
  }
}

function resolveKey(): Buffer {
  const env = process.env.LOADER_STATE_KEY;
  if (env) {
    const decoded = decodeKey(env);
    if (decoded.length !== KEY_BYTES) {
      throw new Error(
        `LOADER_STATE_KEY must decode to ${KEY_BYTES} bytes; got ${decoded.length}`,
      );
    }
    return decoded;
  }
  const generated = randomBytes(KEY_BYTES);
  console.error(
    "[loader] LOADER_STATE_KEY not set; generated ephemeral key for this process. " +
      "Set LOADER_STATE_KEY (base64 or hex, 32 bytes) for any non-stdio deployment.",
  );
  return generated;
}

function decodeKey(s: string): Buffer {
  if (/^[0-9a-fA-F]+$/.test(s) && s.length === KEY_BYTES * 2) {
    return Buffer.from(s, "hex");
  }
  return Buffer.from(s, "base64");
}
