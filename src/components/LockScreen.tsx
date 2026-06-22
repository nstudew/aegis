import { FormEvent, useState } from "react";
import { api, Entry } from "../api";
import { estimateStrength } from "../strength";
import { Shield, Eye, EyeOff } from "./icons";

interface Props {
  isNew: boolean; // true => первичная настройка (создать хранилище)
  onUnlocked: (entries: Entry[]) => void;
}

export default function LockScreen({ isNew, onUnlocked }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const strength = estimateStrength(password);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (isNew) {
      if (password.length < 8) {
        setError("Мастер-пароль должен быть не короче 8 символов");
        return;
      }
      if (password !== confirm) {
        setError("Пароли не совпадают");
        return;
      }
    }

    setBusy(true);
    try {
      const entries = isNew
        ? await api.createVault(password)
        : await api.unlock(password);
      onUnlocked(entries);
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <div className="lock-screen">
      <div className="lock-card">
        <div className="lock-logo">
          <Shield width={40} height={40} />
        </div>
        <h1>Aegis</h1>
        <p className="lock-subtitle">
          {isNew
            ? "Придумайте мастер-пароль. Он шифрует всё хранилище и не хранится нигде - восстановить его нельзя."
            : "Введите мастер-пароль, чтобы разблокировать хранилище."}
        </p>

        <form onSubmit={submit}>
          <div className="password-field">
            <input
              autoFocus
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Мастер-пароль"
            />
            <button className="icon-btn" type="button" onClick={() => setShow(!show)}>
              {show ? <EyeOff /> : <Eye />}
            </button>
          </div>

          {isNew && password && (
            <div className="strength-row">
              <div className="strength-bar">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className="strength-seg"
                    style={{ background: i <= strength.score ? strength.color : undefined }}
                  />
                ))}
              </div>
              <span className="strength-label" style={{ color: strength.color }}>
                {strength.label}
              </span>
            </div>
          )}

          {isNew && (
            <div className="password-field" style={{ marginTop: 10 }}>
              <input
                type={show ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Повторите пароль"
              />
            </div>
          )}

          {error && <div className="error-msg">{error}</div>}

          <button className="btn btn-primary lock-submit" type="submit" disabled={busy}>
            {busy ? "…" : isNew ? "Создать хранилище" : "Разблокировать"}
          </button>
        </form>
      </div>
      <footer className="lock-footer">
        Argon2id + AES-256-GCM · данные хранятся только на этом устройстве
      </footer>
    </div>
  );
}
