// Копирование в буфер с авто-очисткой через заданное время.

import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";

let clearTimer: number | null = null;
let lastCopied: string | null = null;

/// Скопировать текст и запланировать очистку буфера через `clearAfterSec` секунд.
/// Очистка срабатывает только если в буфере всё ещё наш текст.
export async function copyWithClear(text: string, clearAfterSec: number) {
  await writeText(text);
  lastCopied = text;

  if (clearTimer !== null) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
  if (clearAfterSec > 0) {
    clearTimer = window.setTimeout(async () => {
      try {
        const current = await readText().catch(() => null);
        if (current === lastCopied) {
          await writeText("");
        }
      } catch {
        /* игнорируем */
      }
      lastCopied = null;
      clearTimer = null;
    }, clearAfterSec * 1000);
  }
}

/// Немедленно очистить буфер (например, при блокировке).
export async function clearClipboardNow() {
  if (clearTimer !== null) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
  try {
    await writeText("");
  } catch {
    /* игнорируем */
  }
  lastCopied = null;
}
