// Проверка пароля на утечки через Have I Been Pwned (k-anonymity).
// На сервер уходит только первые 5 символов SHA-1; полный хэш и пароль - нет.

import { fetch } from "@tauri-apps/plugin-http";

async function sha1Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/// Возвращает число утечек (0 - не найден), либо -1 при ошибке сети.
export async function checkPwned(password: string): Promise<number> {
  if (!password) return 0;
  try {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      method: "GET",
      headers: { "Add-Padding": "true" },
    });
    if (!res.ok) return -1;
    const body = await res.text();

    for (const line of body.split("\n")) {
      const [suf, count] = line.trim().split(":");
      if (suf === suffix) return parseInt(count, 10) || 0;
    }
    return 0;
  } catch {
    return -1;
  }
}
