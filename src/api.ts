import { invoke } from "@tauri-apps/api/core";

export type EntryKind = "login" | "crypto";

export interface Entry {
  id: string;
  title: string;
  kind: EntryKind;
  username: string;
  password: string;
  url: string;
  notes: string;
  seed: string;
  totp: string;
  network: string;
  favorite: boolean;
  created_at: number;
  updated_at: number;
}

export interface EntryInput {
  title: string;
  kind: EntryKind;
  username: string;
  password: string;
  url: string;
  notes: string;
  seed: string;
  totp: string;
  network: string;
  favorite: boolean;
}

export interface GenOptions {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
  exclude_ambiguous: boolean;
}

export type UnlockResponse =
  | { status: "ok"; entries: Entry[] }
  | { status: "wrong"; attempts_left: number; next: "lockout" | "wipe" }
  | { status: "locked"; remaining_secs: number }
  | { status: "wiped" };

export interface GuardStatus {
  locked: boolean;
  remaining_secs: number;
  attempts_left: number;
  next: "lockout" | "wipe";
}

export interface Settings {
  auto_lock_secs: number;
  clipboard_clear_secs: number;
  lock_on_minimize: boolean;
  gen_length: number;
  gen_lowercase: boolean;
  gen_uppercase: boolean;
  gen_digits: boolean;
  gen_symbols: boolean;
  gen_exclude_ambiguous: boolean;
}

export const emptyInput = (kind: EntryKind = "login"): EntryInput => ({
  title: "",
  kind,
  username: "",
  password: "",
  url: "",
  notes: "",
  seed: "",
  totp: "",
  network: "",
  favorite: false,
});

export const api = {
  vaultExists: () => invoke<boolean>("vault_exists"),
  isUnlocked: () => invoke<boolean>("is_unlocked"),
  createVault: (masterPassword: string) =>
    invoke<Entry[]>("create_vault", { masterPassword }),
  unlock: (masterPassword: string) =>
    invoke<UnlockResponse>("unlock", { masterPassword }),
  guardStatus: () => invoke<GuardStatus>("guard_status"),
  lock: () => invoke<void>("lock"),
  listEntries: () => invoke<Entry[]>("list_entries"),
  addEntry: (input: EntryInput) => invoke<Entry>("add_entry", { input }),
  updateEntry: (id: string, input: EntryInput) =>
    invoke<Entry>("update_entry", { id, input }),
  deleteEntry: (id: string) => invoke<void>("delete_entry", { id }),
  changeMasterPassword: (currentPassword: string, newPassword: string) =>
    invoke<void>("change_master_password", { currentPassword, newPassword }),
  generatePassword: (options: GenOptions) =>
    invoke<string>("generate_password", { options }),
  getSettings: () => invoke<Settings>("get_settings"),
  setSettings: (settings: Settings) => invoke<void>("set_settings", { settings }),
  importEntries: (items: EntryInput[]) =>
    invoke<Entry[]>("import_entries", { items }),
  exportVault: (dest: string) => invoke<void>("export_vault", { dest }),
  importVault: (src: string) => invoke<void>("import_vault", { src }),
  readText: (path: string) => invoke<string>("read_text", { path }),
};
