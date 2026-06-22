// Парсинг CSV-экспортов Bitwarden и Chrome/Edge в записи Aegis.

import { EntryInput, emptyInput } from "./api";

/// Минимальный CSV-парсер с поддержкой кавычек и переводов строк в полях.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const t = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQuotes) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export interface ImportResult {
  entries: EntryInput[];
  source: string;
}

/// Распознаёт формат по заголовку и возвращает готовые записи.
export function parseVaultCsv(text: string): ImportResult {
  const rows = parseCsv(text);
  if (rows.length < 2) return { entries: [], source: "пусто" };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const get = (r: string[], i: number) => (i >= 0 && i < r.length ? r[i] : "");

  // Bitwarden: name,login_uri,login_username,login_password,login_totp,notes
  const isBitwarden = idx("login_password") >= 0 || idx("login_username") >= 0;
  // Chrome/Edge: name,url,username,password,note
  const isChrome = idx("password") >= 0 && idx("username") >= 0;

  const entries: EntryInput[] = [];
  let source = "CSV";

  if (isBitwarden) {
    source = "Bitwarden";
    const iName = idx("name");
    const iUri = idx("login_uri");
    const iUser = idx("login_username");
    const iPass = idx("login_password");
    const iTotp = idx("login_totp");
    const iNotes = idx("notes");
    for (const r of rows.slice(1)) {
      const e = emptyInput("login");
      e.title = get(r, iName) || get(r, iUri) || "Без названия";
      e.url = get(r, iUri);
      e.username = get(r, iUser);
      e.password = get(r, iPass);
      e.totp = get(r, iTotp);
      e.notes = get(r, iNotes);
      entries.push(e);
    }
  } else if (isChrome) {
    source = "Chrome/Edge";
    const iName = idx("name") >= 0 ? idx("name") : idx("title");
    const iUrl = idx("url");
    const iUser = idx("username");
    const iPass = idx("password");
    const iNote = idx("note") >= 0 ? idx("note") : idx("notes");
    for (const r of rows.slice(1)) {
      const e = emptyInput("login");
      e.title = get(r, iName) || get(r, iUrl) || "Без названия";
      e.url = get(r, iUrl);
      e.username = get(r, iUser);
      e.password = get(r, iPass);
      e.notes = get(r, iNote);
      entries.push(e);
    }
  }

  return { entries, source };
}
