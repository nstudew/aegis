import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api, Entry, EntryInput, EntryKind, Settings } from "./api";
import { estimateStrength } from "./strength";
import { copyWithClear, clearClipboardNow } from "./clipboard";
import { generateTotp, TotpResult } from "./totp";
import { fetchFavicon } from "./favicon";
import { parseVaultCsv } from "./csv";
import LockScreen from "./components/LockScreen";
import EntryModal from "./components/EntryModal";
import Generator from "./components/Generator";
import SettingsPage from "./components/SettingsPage";
import AuditPanel from "./components/AuditPanel";
import {
  Shield, Plus, Search, Copy, Check, Eye, EyeOff, Trash, Edit, Lock,
  Key, Globe, Dice, Wallet, Star, List as ListIcon, Settings as Gear,
} from "./components/icons";

type Screen = "loading" | "setup" | "locked" | "unlocked";
type View = "all" | "favorites" | "login" | "crypto" | "generator" | "audit" | "settings";

const DEFAULT_SETTINGS: Settings = {
  auto_lock_secs: 300, clipboard_clear_secs: 240, lock_on_minimize: true,
  gen_length: 20, gen_lowercase: true, gen_uppercase: true, gen_digits: true,
  gen_symbols: true, gen_exclude_ambiguous: false,
};

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [view, setView] = useState<View>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ entry: Entry | null; kind: EntryKind } | null>(null);
  const [toast, setToast] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2200);
  }, []);

  useEffect(() => {
    (async () => {
      const exists = await api.vaultExists();
      setScreen(exists ? "locked" : "setup");
    })();
  }, []);

  const onUnlocked = async (list: Entry[]) => {
    setEntries(sortEntries(list));
    setSelectedId(list.length ? sortEntries(list)[0].id : null);
    try { setSettings(await api.getSettings()); } catch { /* */ }
    setView("all");
    setScreen("unlocked");
  };

  const lock = useCallback(async () => {
    await api.lock();
    await clearClipboardNow();
    setEntries([]); setSelectedId(null); setQuery(""); setEditing(null);
    setScreen("locked");
  }, []);

  // --- Автоблокировка по бездействию ---
  const lastActivity = useRef(Date.now());
  useEffect(() => {
    if (screen !== "unlocked" || settings.auto_lock_secs <= 0) return;
    const bump = () => (lastActivity.current = Date.now());
    const evts = ["mousemove", "mousedown", "keydown", "scroll", "wheel"];
    evts.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const iv = window.setInterval(() => {
      if (Date.now() - lastActivity.current >= settings.auto_lock_secs * 1000) lock();
    }, 2000);
    return () => {
      evts.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(iv);
    };
  }, [screen, settings.auto_lock_secs, lock]);

  // --- Блокировка при сворачивании ---
  useEffect(() => {
    if (screen !== "unlocked" || !settings.lock_on_minimize) return;
    let unlisten: (() => void) | undefined;
    const win = getCurrentWindow();
    win.onFocusChanged(async ({ payload: focused }) => {
      if (!focused && (await win.isMinimized().catch(() => false))) lock();
    }).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, [screen, settings.lock_on_minimize, lock]);

  // --- Горячие клавиши ---
  useEffect(() => {
    if (screen !== "unlocked") return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "f") { e.preventDefault(); setView("all"); setTimeout(() => searchRef.current?.focus(), 0); }
      else if (mod && e.key === "n") { e.preventDefault(); setEditing({ entry: null, kind: "login" }); }
      else if (mod && e.key === "l") { e.preventDefault(); lock(); }
      else if (mod && e.shiftKey && (e.key === "C" || e.key === "c")) {
        const sel = entries.find((x) => x.id === selectedId);
        if (sel?.password) { copyWithClear(sel.password, settings.clipboard_clear_secs); flash("Пароль скопирован"); }
      } else if (e.key === "Escape") { setEditing(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, entries, selectedId, settings.clipboard_clear_secs, lock, flash]);

  const saveEntry = async (input: EntryInput, id?: string) => {
    if (id) {
      const updated = await api.updateEntry(id, input);
      setEntries((p) => sortEntries(p.map((e) => (e.id === id ? updated : e))));
      setSelectedId(updated.id);
    } else {
      const created = await api.addEntry(input);
      setEntries((p) => sortEntries([...p, created]));
      setSelectedId(created.id);
      setView(created.kind === "crypto" ? "crypto" : "all");
    }
  };

  const removeEntry = async (id: string) => {
    await api.deleteEntry(id);
    setEntries((p) => {
      const next = p.filter((e) => e.id !== id);
      setSelectedId(next.length ? next[0].id : null);
      return next;
    });
  };

  const toggleFavorite = async (e: Entry) => {
    const updated = await api.updateEntry(e.id, { ...toInput(e), favorite: !e.favorite });
    setEntries((p) => sortEntries(p.map((x) => (x.id === e.id ? updated : x))));
  };

  const saveSettings = async (s: Settings) => {
    setSettings(s);
    try { await api.setSettings(s); } catch { /* */ }
  };

  // --- Импорт / экспорт ---
  const doExport = async () => {
    try {
      const path = await saveDialog({ defaultPath: "aegis-backup.aegis", filters: [{ name: "Aegis", extensions: ["aegis"] }] });
      if (path) { await api.exportVault(path); flash("Бэкап сохранён"); }
    } catch (e) { flash("Ошибка экспорта"); console.error(e); }
  };
  const doImportVault = async () => {
    try {
      const sel = await openDialog({ filters: [{ name: "Aegis", extensions: ["aegis"] }] });
      if (typeof sel === "string") { await api.importVault(sel); flash("Хранилище заменено"); lock(); }
    } catch (e) { flash("Ошибка импорта"); console.error(e); }
  };
  const doImportCsv = async () => {
    try {
      const sel = await openDialog({ filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (typeof sel !== "string") return;
      const text = await api.readText(sel);
      const { entries: parsed, source } = parseVaultCsv(text);
      if (parsed.length === 0) { flash("Не распознан формат CSV"); return; }
      const full = await api.importEntries(parsed);
      setEntries(sortEntries(full));
      flash(`Импортировано ${parsed.length} из ${source}`);
      setView("all");
    } catch (e) { flash("Ошибка импорта CSV"); console.error(e); }
  };

  const counts = useMemo(() => ({
    all: entries.length,
    favorites: entries.filter((e) => e.favorite).length,
    login: entries.filter((e) => e.kind === "login").length,
    crypto: entries.filter((e) => e.kind === "crypto").length,
  }), [entries]);

  const listForView = useMemo(() => {
    let list = entries;
    if (view === "favorites") list = entries.filter((e) => e.favorite);
    else if (view === "login") list = entries.filter((e) => e.kind === "login");
    else if (view === "crypto") list = entries.filter((e) => e.kind === "crypto");
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((e) =>
      e.title.toLowerCase().includes(q) || e.username.toLowerCase().includes(q) ||
      e.url.toLowerCase().includes(q) || e.network.toLowerCase().includes(q));
    return list;
  }, [entries, view, query]);

  const selected = entries.find((e) => e.id === selectedId) ?? null;

  if (screen === "loading") return <div className="splash"><Shield width={44} height={44} /></div>;
  if (screen === "setup" || screen === "locked")
    return <LockScreen isNew={screen === "setup"} onUnlocked={onUnlocked} />;

  const isListView = view === "all" || view === "favorites" || view === "login" || view === "crypto";

  return (
    <div className="app">
      <nav className="nav">
        <div className="brand"><Shield width={20} height={20} /> Aegis</div>

        <NavItem icon={<ListIcon width={16} height={16} />} label="Все записи" count={counts.all} active={view === "all"} onClick={() => setView("all")} />
        <NavItem icon={<Star width={16} height={16} />} label="Избранное" count={counts.favorites} active={view === "favorites"} onClick={() => setView("favorites")} />
        <NavItem icon={<Key width={16} height={16} />} label="Логины" count={counts.login} active={view === "login"} onClick={() => setView("login")} />
        <NavItem icon={<Wallet width={16} height={16} />} label="Кошельки" count={counts.crypto} active={view === "crypto"} onClick={() => setView("crypto")} />

        <div className="nav-section">Инструменты</div>
        <NavItem icon={<Dice width={16} height={16} />} label="Генератор" active={view === "generator"} onClick={() => setView("generator")} />
        <NavItem icon={<Shield width={16} height={16} />} label="Аудит" active={view === "audit"} onClick={() => setView("audit")} />
        <NavItem icon={<Gear width={16} height={16} />} label="Настройки" active={view === "settings"} onClick={() => setView("settings")} />

        <div className="nav-spacer" />
        <div className="nav-footer">
          <button className="nav-item" onClick={lock}><Lock width={16} height={16} /> Заблокировать</button>
        </div>
      </nav>

      {isListView ? (
        <>
          <div className="list-col">
            <div className="list-head">
              <div className="search-box">
                <Search width={15} height={15} />
                <input ref={searchRef} placeholder="Поиск" value={query} onChange={(e) => setQuery(e.target.value)} />
                <kbd>Ctrl F</kbd>
              </div>
              <div className="add-row">
                <button className="btn btn-primary" onClick={() => setEditing({ entry: null, kind: view === "crypto" ? "crypto" : "login" })}>
                  <Plus width={15} height={15} /> {view === "crypto" ? "Кошелёк" : "Запись"}
                </button>
              </div>
            </div>
            <div className="entry-list">
              {listForView.length === 0 && <div className="list-empty">{entries.length === 0 ? "Хранилище пусто" : "Ничего не найдено"}</div>}
              {listForView.map((e) => (
                <button key={e.id} className={`entry-item ${e.id === selectedId ? "active" : ""}`} onClick={() => setSelectedId(e.id)}>
                  <Avatar entry={e} />
                  <div className="entry-meta">
                    <span className="entry-title">{e.favorite && <Star width={12} height={12} className="star" fill="currentColor" />}{e.title}</span>
                    <span className="entry-sub">{e.kind === "crypto" ? (e.network || "Кошелёк") : (e.username || e.url || "-")}</span>
                  </div>
                  {e.password && <span className="entry-dot" style={{ background: estimateStrength(e.password).color }} />}
                </button>
              ))}
            </div>
          </div>

          <div className="content">
            {selected ? (
              <EntryDetail
                entry={selected}
                clearSecs={settings.clipboard_clear_secs}
                onEdit={() => setEditing({ entry: selected, kind: selected.kind })}
                onDelete={() => removeEntry(selected.id)}
                onToggleFav={() => toggleFavorite(selected)}
                onCopy={flash}
              />
            ) : (
              <div className="empty-detail"><Shield width={52} height={52} /><p>Выберите запись или создайте новую</p></div>
            )}
          </div>
        </>
      ) : (
        <div className="content">
          {view === "generator" && (
            <div className="content-pad page">
              <div className="page-title"><Dice width={18} height={18} /> Генератор паролей</div>
              <div className="page-sub">Криптостойкая генерация. Параметры по умолчанию настраиваются в разделе «Настройки».</div>
              <Generator defaults={settingsToGen(settings)} clipboardClearSecs={settings.clipboard_clear_secs} />
            </div>
          )}
          {view === "audit" && <AuditPanel entries={entries} onSelect={(id) => { setSelectedId(id); setView("all"); }} />}
          {view === "settings" && (
            <SettingsPage
              settings={settings} onChange={saveSettings}
              onExport={doExport} onImportVault={doImportVault} onImportCsv={doImportCsv}
              onChangedMaster={() => flash("Мастер-пароль изменён")}
            />
          )}
        </div>
      )}

      {editing && (
        <EntryModal
          entry={editing.entry} initialKind={editing.kind}
          genDefaults={settingsToGen(settings)} clipboardClearSecs={settings.clipboard_clear_secs}
          onSave={saveEntry} onClose={() => setEditing(null)}
        />
      )}

      {toast && <div className="toast"><Check width={15} height={15} /> {toast}</div>}
    </div>
  );
}

function NavItem({ icon, label, count, active, onClick }: { icon: ReactNode; label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>
      {icon} {label}
      {count !== undefined && count > 0 && <span className="nav-count">{count}</span>}
    </button>
  );
}

function Avatar({ entry, large }: { entry: Entry; large?: boolean }) {
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (entry.kind === "login" && entry.url) {
      fetchFavicon(entry.url).then((d) => { if (alive) setIcon(d); });
    } else setIcon(null);
    return () => { alive = false; };
  }, [entry.url, entry.kind]);

  return (
    <div className={`avatar ${large ? "large" : ""} ${entry.kind === "crypto" ? "crypto" : ""}`}>
      {icon ? <img src={icon} alt="" /> : entry.kind === "crypto" ? <Wallet width={large ? 22 : 17} height={large ? 22 : 17} /> : initials(entry.title)}
    </div>
  );
}

function EntryDetail({ entry, clearSecs, onEdit, onDelete, onToggleFav, onCopy }: {
  entry: Entry; clearSecs: number; onEdit: () => void; onDelete: () => void; onToggleFav: () => void; onCopy: (m: string) => void;
}) {
  const [show, setShow] = useState(false);
  const [showSeed, setShowSeed] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => { setShow(false); setShowSeed(false); setConfirmDel(false); }, [entry.id]);

  const copy = async (text: string, label: string) => { await copyWithClear(text, clearSecs); onCopy(`${label} скопирован${label === "Заметка" ? "а" : ""}`); };
  const seedWords = entry.seed.trim().split(/\s+/).filter(Boolean);

  return (
    <div className="content-pad detail">
      <div className="detail-header">
        <Avatar entry={entry} large />
        <div>
          <h2>{entry.title}</h2>
          <div className="detail-kind">
            {entry.kind === "crypto" ? <><Wallet width={13} height={13} /> Крипто-кошелёк{entry.network ? ` · ${entry.network}` : ""}</> : <><Key width={13} height={13} /> Логин</>}
          </div>
        </div>
        <div className="detail-actions">
          <button className={`icon-btn ${entry.favorite ? "active" : ""}`} title="Избранное" onClick={onToggleFav}><Star fill={entry.favorite ? "currentColor" : "none"} /></button>
          <button className="icon-btn" title="Редактировать" onClick={onEdit}><Edit /></button>
          <button className={`icon-btn ${confirmDel ? "danger" : ""}`} title="Удалить"
            onClick={() => (confirmDel ? onDelete() : setConfirmDel(true))} onBlur={() => setConfirmDel(false)}><Trash /></button>
        </div>
      </div>

      {entry.username && <CopyRow label={entry.kind === "crypto" ? "Адрес / Метка" : "Логин / Email"} value={entry.username} onCopy={() => copy(entry.username, "Логин")} mono={entry.kind === "crypto"} />}

      {entry.url && (
        <div className="field-row">
          <span className="field-label">Сайт</span>
          <div className="field-value">
            <a className="detail-url grow" href={entry.url.startsWith("http") ? entry.url : `https://${entry.url}`} target="_blank" rel="noreferrer"><Globe width={14} height={14} /> {entry.url}</a>
          </div>
        </div>
      )}

      {entry.password && (
        <div className="field-row">
          <span className="field-label">Пароль</span>
          <div className="field-value">
            <code className="mono grow">{show ? entry.password : "•".repeat(Math.min(entry.password.length, 18) || 8)}</code>
            <div className="row-actions">
              <button className="icon-btn" onClick={() => setShow(!show)}>{show ? <EyeOff /> : <Eye />}</button>
              <CopyBtn onClick={() => copy(entry.password, "Пароль")} />
            </div>
          </div>
        </div>
      )}

      {entry.totp && (
        <div className="field-row">
          <span className="field-label">2FA-код (TOTP)</span>
          <div className="field-value"><TotpDisplay secret={entry.totp} onCopy={(c) => copy(c, "Код")} /></div>
        </div>
      )}

      {entry.kind === "crypto" && entry.seed && (
        <div className="field-row">
          <span className="field-label" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Сид-фраза{seedWords.length ? ` · ${seedWords.length} слов` : ""}</span>
          </span>
          {showSeed ? (
            <div className="seed-grid">
              {seedWords.map((w, i) => (
                <div className="seed-word" key={i}><span className="num">{i + 1}</span><span className="word selectable">{w}</span></div>
              ))}
            </div>
          ) : (
            <div className="field-value"><code className="mono grow">{"•".repeat(40)}</code></div>
          )}
          <div className="row-actions" style={{ marginTop: 8 }}>
            <button className="btn btn-ghost" onClick={() => setShowSeed(!showSeed)}>{showSeed ? <EyeOff width={15} height={15} /> : <Eye width={15} height={15} />} {showSeed ? "Скрыть" : "Показать"}</button>
            <button className="btn btn-ghost" onClick={() => copy(entry.seed, "Сид-фраза")}><Copy width={15} height={15} /> Копировать</button>
          </div>
        </div>
      )}

      {entry.notes && (
        <div className="field-row">
          <span className="field-label">Заметки</span>
          <div className="field-value block selectable">{entry.notes}</div>
        </div>
      )}

      <div className="detail-meta">Изменено: {new Date(entry.updated_at).toLocaleString("ru-RU")}</div>
    </div>
  );
}

function TotpDisplay({ secret, onCopy }: { secret: string; onCopy: (code: string) => void }) {
  const [res, setRes] = useState<TotpResult | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => { const r = await generateTotp(secret); if (alive) setRes(r); };
    tick();
    const iv = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(iv); };
  }, [secret]);

  if (!res) return <span className="mono grow" style={{ color: "var(--text-faint)" }}>неверный секрет</span>;
  const frac = res.remaining / res.period;
  const R = 10, C = 2 * Math.PI * R;
  return (
    <div className="totp-box grow">
      <span className="totp-code grow">{res.code.slice(0, 3)} {res.code.slice(3)}</span>
      <div className="totp-ring" title={`${res.remaining}с`}>
        <svg width={26} height={26}>
          <circle className="bg" cx={13} cy={13} r={R} />
          <circle className="fg" cx={13} cy={13} r={R} strokeDasharray={C} strokeDashoffset={C * (1 - frac)} />
        </svg>
      </div>
      <button className="icon-btn" title="Скопировать код" onClick={() => onCopy(res.code)}><Copy /></button>
    </div>
  );
}

function CopyRow({ label, value, onCopy, mono }: { label: string; value: string; onCopy: () => void; mono?: boolean }) {
  return (
    <div className="field-row">
      <span className="field-label">{label}</span>
      <div className="field-value">
        <span className={`grow ${mono ? "mono" : ""}`}>{value}</span>
        <div className="row-actions"><CopyBtn onClick={onCopy} /></div>
      </div>
    </div>
  );
}

function CopyBtn({ onClick }: { onClick: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <button className="icon-btn" title="Скопировать" onClick={() => { onClick(); setDone(true); setTimeout(() => setDone(false), 1400); }}>
      {done ? <Check /> : <Copy />}
    </button>
  );
}

function toInput(e: Entry): EntryInput {
  return { title: e.title, kind: e.kind, username: e.username, password: e.password, url: e.url, notes: e.notes, seed: e.seed, totp: e.totp, network: e.network, favorite: e.favorite };
}
function settingsToGen(s: Settings) {
  return { length: s.gen_length, lowercase: s.gen_lowercase, uppercase: s.gen_uppercase, digits: s.gen_digits, symbols: s.gen_symbols, exclude_ambiguous: s.gen_exclude_ambiguous };
}
function sortEntries(list: Entry[]): Entry[] {
  return [...list].sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.title.localeCompare(b.title, "ru"));
}
function initials(title: string): string {
  const t = title.trim();
  return t ? t.slice(0, 2).toUpperCase() : "?";
}
