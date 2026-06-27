import { FormEvent, useEffect, useRef, useState } from "react";
import { api, Entry } from "../api";
import { estimateStrength } from "../strength";
import { Shield, Eye, EyeOff, Lock, Alert } from "./icons";

interface Props {
  isNew: boolean; // true => первичная настройка (создать хранилище)
  notice?: string; // сообщение сверху (например, после удаления данных)
  onUnlocked: (entries: Entry[]) => void;
  onWiped: () => void;
}

function fmt(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function LockScreen({ isNew, notice, onUnlocked, onWiped }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Защита от перебора
  const [lockRemaining, setLockRemaining] = useState(0); // секунды; 0 = не заблокировано
  const [danger, setDanger] = useState<{ attemptsLeft: number; next: "lockout" | "wipe" } | null>(null);
  const tick = useRef<number | null>(null);

  const strength = estimateStrength(password);
  const locked = lockRemaining > 0;

  // Отсчёт оставшегося времени блокировки.
  const startCountdown = (secs: number) => {
    setLockRemaining(secs);
    if (tick.current) clearInterval(tick.current);
    tick.current = window.setInterval(() => {
      setLockRemaining((r) => {
        if (r <= 1) {
          if (tick.current) clearInterval(tick.current);
          tick.current = null;
          return 0;
        }
        return r - 1;
      });
    }, 1000);
  };

  // При открытии экрана разблокировки восстанавливаем состояние защиты.
  useEffect(() => {
    if (isNew) return;
    api.guardStatus().then((g) => {
      if (g.locked) startCountdown(g.remaining_secs);
      if (g.next === "wipe") setDanger({ attemptsLeft: g.attempts_left, next: "wipe" });
    }).catch(() => {});
    return () => {
      if (tick.current) clearInterval(tick.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (locked) return;
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
      setBusy(true);
      try {
        const entries = await api.createVault(password);
        onUnlocked(entries);
      } catch (err) {
        setError(String(err));
        setBusy(false);
      }
      return;
    }

    // Режим разблокировки
    setBusy(true);
    try {
      const res = await api.unlock(password);
      setBusy(false);
      switch (res.status) {
        case "ok":
          onUnlocked(res.entries);
          break;
        case "wrong":
          setPassword("");
          if (res.next === "lockout") {
            setDanger(null);
            setError(`Неверный пароль. Осталось попыток: ${res.attempts_left}, затем блокировка на 30 минут.`);
          } else {
            setDanger({ attemptsLeft: res.attempts_left, next: "wipe" });
            setError("");
          }
          break;
        case "locked":
          setPassword("");
          setError("");
          startCountdown(res.remaining_secs);
          break;
        case "wiped":
          onWiped();
          break;
      }
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

        {notice && <div className="error-msg" style={{ marginBottom: 14 }}>{notice}</div>}

        {locked ? (
          <div className="lock-timer">
            <Lock width={22} height={22} />
            <div className="lock-timer-time">{fmt(lockRemaining)}</div>
            <div className="lock-timer-text">
              Слишком много неверных попыток. Доступ заблокирован.
            </div>
          </div>
        ) : (
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

            {!isNew && danger && danger.next === "wipe" && (
              <div className="wipe-warning">
                <Alert width={16} height={16} />
                <span>
                  Внимание: осталось {danger.attemptsLeft}{" "}
                  {danger.attemptsLeft === 1 ? "попытка" : "попытки"} до полного и
                  безвозвратного удаления всех данных приложения.
                </span>
              </div>
            )}

            {error && <div className="error-msg">{error}</div>}

            <button className="btn btn-primary lock-submit" type="submit" disabled={busy}>
              {busy ? "..." : isNew ? "Создать хранилище" : "Разблокировать"}
            </button>
          </form>
        )}
      </div>
      <footer className="lock-footer">
        Argon2id + AES-256-GCM - данные хранятся только на этом устройстве
      </footer>
    </div>
  );
}
