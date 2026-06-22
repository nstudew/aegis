// Генерация TOTP-кодов (RFC 6238) через Web Crypto. HMAC-SHA1, 30с, 6 цифр.

function base32Decode(input: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

export interface TotpResult {
  code: string;
  remaining: number; // секунд до смены кода
  period: number;
}

export async function generateTotp(
  secret: string,
  period = 30,
  digits = 6
): Promise<TotpResult | null> {
  try {
    const key = base32Decode(secret);
    if (key.length === 0) return null;

    const now = Math.floor(Date.now() / 1000);
    const counter = Math.floor(now / period);

    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setUint32(0, Math.floor(counter / 0x100000000));
    view.setUint32(4, counter >>> 0);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      key as BufferSource,
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"]
    );
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, buf));

    const offset = sig[sig.length - 1] & 0x0f;
    const bin =
      ((sig[offset] & 0x7f) << 24) |
      ((sig[offset + 1] & 0xff) << 16) |
      ((sig[offset + 2] & 0xff) << 8) |
      (sig[offset + 3] & 0xff);
    const code = (bin % 10 ** digits).toString().padStart(digits, "0");
    const remaining = period - (now % period);
    return { code, remaining, period };
  } catch {
    return null;
  }
}

/// Принять как «голый» секрет, так и otpauth://-ссылку.
export function extractTotpSecret(raw: string): string {
  const s = raw.trim();
  if (s.toLowerCase().startsWith("otpauth://")) {
    try {
      const url = new URL(s);
      return url.searchParams.get("secret") ?? "";
    } catch {
      return "";
    }
  }
  return s.replace(/\s/g, "");
}
