import { useState } from "react";
import { api, Settings } from "../api";
import { Settings as Gear, Download, Upload, Key, Lock } from "./icons";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  onExport: () => void;
  onImportVault: () => void;
  onImportCsv: () => void;
  onChangedMaster: () => void;
}

const LOCK_OPTIONS = [
  [60, "1 минута"], [180, "3 минуты"], [300, "5 минут"],
  [600, "10 минут"], [1800, "30 минут"], [0, "Никогда"],
] as const;

const CLIP_OPTIONS = [
  [30, "30 секунд"], [60, "60 секунд"], [120, "2 минуты"],
  [240, "240 секунд"], [0, "Не очищать"],
] as const;

export default function SettingsPage({ settings, onChange, onExport, onImportVault, onImportCsv, onChangedMaster }: Props) {
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });

  return (
    <div className="content-pad page-wide">
      <div className="page-title"><Gear width={18} height={18} /> Настройки</div>
      <div className="page-sub">Параметры сохраняются внутри зашифрованного хранилища.</div>

      <div className="audit-section-title">Безопасность</div>
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <div className="sr-label">Автоблокировка при бездействии</div>
            <div className="sr-desc">Заблокировать хранилище после простоя</div>
          </div>
          <div className="sr-control">
            <select value={settings.auto_lock_secs} onChange={(e) => set({ auto_lock_secs: Number(e.target.value) })}>
              {LOCK_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <div className="sr-label">Блокировать при сворачивании окна</div>
            <div className="sr-desc">Мгновенная блокировка при минимизации</div>
          </div>
          <div className="sr-control">
            <button className={`switch ${settings.lock_on_minimize ? "on" : ""}`} onClick={() => set({ lock_on_minimize: !settings.lock_on_minimize })} />
          </div>
        </div>
        <div className="settings-row">
          <div>
            <div className="sr-label">Очистка буфера обмена</div>
            <div className="sr-desc">Стереть скопированный пароль через</div>
          </div>
          <div className="sr-control">
            <select value={settings.clipboard_clear_secs} onChange={(e) => set({ clipboard_clear_secs: Number(e.target.value) })}>
              {CLIP_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="audit-section-title">Генератор по умолчанию</div>
      <div className="settings-group">
        <div className="settings-row">
          <div><div className="sr-label">Длина пароля</div></div>
          <div className="sr-control">
            <input type="number" min={8} max={64} value={settings.gen_length} onChange={(e) => set({ gen_length: Number(e.target.value) })} />
          </div>
        </div>
        {([
          ["gen_lowercase", "Строчные буквы (a-z)"],
          ["gen_uppercase", "Заглавные буквы (A-Z)"],
          ["gen_digits", "Цифры (0-9)"],
          ["gen_symbols", "Спецсимволы (!@#)"],
          ["gen_exclude_ambiguous", "Исключать похожие символы"],
        ] as const).map(([key, label]) => (
          <div className="settings-row" key={key}>
            <div><div className="sr-label">{label}</div></div>
            <div className="sr-control">
              <button className={`switch ${settings[key] ? "on" : ""}`} onClick={() => set({ [key]: !settings[key] } as Partial<Settings>)} />
            </div>
          </div>
        ))}
      </div>

      <div className="audit-section-title">Хранилище</div>
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <div className="sr-label">Экспорт зашифрованного бэкапа</div>
            <div className="sr-desc">Копия файла хранилища (зашифрована мастер-паролем)</div>
          </div>
          <div className="sr-control"><button className="btn btn-ghost" onClick={onExport}><Download width={15} height={15} /> Экспорт</button></div>
        </div>
        <div className="settings-row">
          <div>
            <div className="sr-label">Импорт бэкапа Aegis</div>
            <div className="sr-desc">Заменит текущее хранилище - потребуется его мастер-пароль</div>
          </div>
          <div className="sr-control"><button className="btn btn-ghost" onClick={onImportVault}><Upload width={15} height={15} /> Импорт</button></div>
        </div>
        <div className="settings-row">
          <div>
            <div className="sr-label">Импорт из CSV</div>
            <div className="sr-desc">Bitwarden или Chrome/Edge</div>
          </div>
          <div className="sr-control"><button className="btn btn-ghost" onClick={onImportCsv}><Upload width={15} height={15} /> CSV</button></div>
        </div>
      </div>

      <div className="audit-section-title">Мастер-пароль</div>
      <ChangeMaster onChanged={onChangedMaster} />
    </div>
  );
}

function ChangeMaster({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr("");
    if (next.length < 8) { setErr("Новый пароль короче 8 символов"); return; }
    if (next !== confirm) { setErr("Пароли не совпадают"); return; }
    setBusy(true);
    try {
      await api.changeMasterPassword(cur, next);
      setOk(true); setCur(""); setNext(""); setConfirm("");
      setTimeout(() => { setOk(false); setOpen(false); }, 1600);
      onChanged();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  };

  if (!open) {
    return (
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <div className="sr-label">Сменить мастер-пароль</div>
            <div className="sr-desc">Перешифрует хранилище с новой солью</div>
          </div>
          <div className="sr-control"><button className="btn btn-ghost" onClick={() => setOpen(true)}><Key width={15} height={15} /> Сменить</button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-group" style={{ padding: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        <input type="password" placeholder="Текущий пароль" value={cur} onChange={(e) => setCur(e.target.value)} />
        <input type="password" placeholder="Новый пароль" value={next} onChange={(e) => setNext(e.target.value)} />
        <input type="password" placeholder="Повторите новый пароль" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {err && <div className="error-msg">{err}</div>}
        {ok && <div className="ok-msg">Мастер-пароль изменён</div>}
        <div className="seg" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={() => { setOpen(false); setErr(""); }}>Отмена</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}><Lock width={15} height={15} /> {busy ? "…" : "Изменить"}</button>
        </div>
      </div>
    </div>
  );
}
