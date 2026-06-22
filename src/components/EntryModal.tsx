import { useState } from "react";
import { Entry, EntryInput, GenOptions, EntryKind } from "../api";
import { estimateStrength } from "../strength";
import { extractTotpSecret } from "../totp";
import Generator from "./Generator";
import { Eye, EyeOff, Dice, X, Star, Key, Wallet } from "./icons";

interface Props {
  entry: Entry | null;
  initialKind?: EntryKind;
  genDefaults?: GenOptions;
  clipboardClearSecs?: number;
  onSave: (input: EntryInput, id?: string) => Promise<void>;
  onClose: () => void;
}

export default function EntryModal({ entry, initialKind, genDefaults, clipboardClearSecs, onSave, onClose }: Props) {
  const [kind, setKind] = useState<EntryKind>(entry?.kind ?? initialKind ?? "login");
  const [title, setTitle] = useState(entry?.title ?? "");
  const [username, setUsername] = useState(entry?.username ?? "");
  const [password, setPassword] = useState(entry?.password ?? "");
  const [url, setUrl] = useState(entry?.url ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [seed, setSeed] = useState(entry?.seed ?? "");
  const [totp, setTotp] = useState(entry?.totp ?? "");
  const [network, setNetwork] = useState(entry?.network ?? "");
  const [favorite, setFavorite] = useState(entry?.favorite ?? false);
  const [show, setShow] = useState(false);
  const [showSeed, setShowSeed] = useState(false);
  const [showGen, setShowGen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const strength = estimateStrength(password);
  const isCrypto = kind === "crypto";

  const submit = async () => {
    if (!title.trim()) { setError("Укажите название"); return; }
    setSaving(true);
    setError("");
    try {
      await onSave(
        { title, kind, username, password, url, notes, seed, totp: extractTotpSecret(totp), network, favorite },
        entry?.id
      );
      onClose();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{entry ? "Редактировать" : "Новая запись"}</h2>
          <button className="icon-btn" onClick={onClose}><X /></button>
        </div>

        <div className="modal-body">
          {!entry && (
            <div className="kind-switch">
              <button className={kind === "login" ? "on" : ""} onClick={() => setKind("login")}><Key width={15} height={15} /> Логин</button>
              <button className={kind === "crypto" ? "on" : ""} onClick={() => setKind("crypto")}><Wallet width={15} height={15} /> Крипто-кошелёк</button>
            </div>
          )}

          <label className="field">
            <span>Название</span>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isCrypto ? "Например, MetaMask" : "Например, Gmail"} />
          </label>

          <label className="field">
            <span>{isCrypto ? "Адрес / Метка" : "Логин / Email"}</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={isCrypto ? "0x… или название аккаунта" : "user@example.com"} />
          </label>

          {isCrypto && (
            <label className="field">
              <span>Сеть / Блокчейн</span>
              <input value={network} onChange={(e) => setNetwork(e.target.value)} placeholder="Ethereum, Bitcoin, Solana…" />
            </label>
          )}

          {isCrypto && (
            <label className="field">
              <span>Сид-фраза / Приватный ключ</span>
              <div className="password-field">
                <textarea
                  value={showSeed ? seed : seed ? "•".repeat(Math.min(seed.length, 60)) : ""}
                  onChange={(e) => setSeed(e.target.value)}
                  onFocus={() => setShowSeed(true)}
                  rows={3}
                  placeholder="12 или 24 слова через пробел"
                  style={{ fontFamily: "ui-monospace, monospace" }}
                />
                <button className="icon-btn" type="button" onClick={() => setShowSeed(!showSeed)}>{showSeed ? <EyeOff /> : <Eye />}</button>
              </div>
              <span className="field-hint">Хранится в зашифрованном виде. Никому не передавайте сид-фразу.</span>
            </label>
          )}

          <label className="field">
            <span>Пароль{isCrypto ? " от кошелька" : ""}</span>
            <div className="password-field">
              <input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              <button className="icon-btn" type="button" onClick={() => setShow(!show)}>{show ? <EyeOff /> : <Eye />}</button>
              <button className="icon-btn" type="button" title="Генератор" onClick={() => setShowGen(!showGen)}><Dice /></button>
            </div>
            {password && (
              <div className="strength-bar inline">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span key={i} className="strength-seg" style={{ background: i <= strength.score ? strength.color : undefined }} />
                ))}
              </div>
            )}
          </label>

          {showGen && (
            <div className="embedded-generator">
              <Generator compact defaults={genDefaults} clipboardClearSecs={clipboardClearSecs} onUse={(pw) => { setPassword(pw); setShow(true); setShowGen(false); }} />
            </div>
          )}

          {!isCrypto && (
            <>
              <label className="field">
                <span>Сайт</span>
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
              </label>
              <label className="field">
                <span>TOTP (2FA) - секрет или otpauth://</span>
                <input value={totp} onChange={(e) => setTotp(e.target.value)} placeholder="JBSWY3DPEHPK3PXP" style={{ fontFamily: "ui-monospace, monospace" }} />
              </label>
            </>
          )}

          <label className="field">
            <span>Заметки</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </label>

          {error && <div className="error-msg">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className={`icon-btn ${favorite ? "active" : ""}`} title="В избранное" onClick={() => setFavorite(!favorite)}>
            <Star fill={favorite ? "currentColor" : "none"} />
          </button>
          <div className="spacer" />
          <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? "Сохранение…" : "Сохранить"}</button>
        </div>
      </div>
    </div>
  );
}
