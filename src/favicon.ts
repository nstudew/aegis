// Загрузка favicon сайта по first-party пути /favicon.ico через plugin-http.
// При неудаче возвращает null - UI откатывается на буквенный аватар.

import { fetch } from "@tauri-apps/plugin-http";

const cache = new Map<string, string | null>();

export function domainOf(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    return u.hostname || null;
  } catch {
    return null;
  }
}

export async function fetchFavicon(url: string): Promise<string | null> {
  const domain = domainOf(url);
  if (!domain) return null;
  if (cache.has(domain)) return cache.get(domain)!;

  try {
    const res = await fetch(`https://${domain}/favicon.ico`, { method: "GET" });
    if (!res.ok) {
      cache.set(domain, null);
      return null;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 200_000) {
      cache.set(domain, null);
      return null;
    }
    let binary = "";
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    const dataUri = `data:image/x-icon;base64,${btoa(binary)}`;
    cache.set(domain, dataUri);
    return dataUri;
  } catch {
    cache.set(domain, null);
    return null;
  }
}
