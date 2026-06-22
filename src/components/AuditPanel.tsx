import { useMemo, useState } from "react";
import { Entry } from "../api";
import { estimateStrength } from "../strength";
import { checkPwned } from "../hibp";
import { Alert, Shield } from "./icons";

interface Props {
  entries: Entry[];
  onSelect: (id: string) => void;
}

export default function AuditPanel({ entries, onSelect }: Props) {
  const [pwned, setPwned] = useState<Record<string, number>>({});
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);

  const withPw = useMemo(() => entries.filter((e) => e.password), [entries]);

  const weak = useMemo(
    () => withPw.filter((e) => estimateStrength(e.password).score <= 1),
    [withPw]
  );

  const duplicates = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of withPw) {
      const arr = map.get(e.password) ?? [];
      arr.push(e);
      map.set(e.password, arr);
    }
    return [...map.values()].filter((g) => g.length > 1);
  }, [withPw]);

  const pwnedList = useMemo(
    () => withPw.filter((e) => (pwned[e.id] ?? 0) > 0),
    [withPw, pwned]
  );

  const runHibp = async () => {
    setScanning(true);
    const result: Record<string, number> = {};
    for (const e of withPw) {
      result[e.id] = await checkPwned(e.password);
    }
    setPwned(result);
    setScanned(true);
    setScanning(false);
  };

  const dupCount = duplicates.reduce((n, g) => n + g.length, 0);

  return (
    <div className="content-pad page-wide">
      <div className="page-title"><Shield width={18} height={18} /> Аудит безопасности</div>
      <div className="page-sub">Поиск слабых, повторяющихся и засветившихся в утечках паролей.</div>

      <div className="audit-cards">
        <div className={`audit-card ${weak.length ? "warn" : "ok"}`}>
          <div className="num">{weak.length}</div>
          <div className="lbl">Слабые пароли</div>
        </div>
        <div className={`audit-card ${dupCount ? "warn" : "ok"}`}>
          <div className="num">{dupCount}</div>
          <div className="lbl">Повторяются</div>
        </div>
        <div className={`audit-card ${pwnedList.length ? "danger" : scanned ? "ok" : ""}`}>
          <div className="num">{scanned ? pwnedList.length : "-"}</div>
          <div className="lbl">В утечках (HIBP)</div>
        </div>
      </div>

      <div className="seg" style={{ marginBottom: 4 }}>
        <button className="btn btn-ghost" onClick={runHibp} disabled={scanning || withPw.length === 0}>
          {scanning ? <span className="spin" /> : <Alert width={15} height={15} />}
          {scanning ? "Проверка…" : "Проверить на утечки (HIBP)"}
        </button>
        <span className="field-hint" style={{ marginLeft: 4 }}>На сервер уходит только первые 5 символов SHA-1 - сами пароли не передаются.</span>
      </div>

      {pwnedList.length > 0 && (
        <>
          <div className="audit-section-title">Найдены в утечках</div>
          {pwnedList.map((e) => (
            <div className="audit-item" key={e.id} onClick={() => onSelect(e.id)}>
              <div className="ai-meta">
                <div className="ai-title">{e.title}</div>
                <div className="ai-sub">{e.username || e.url || "-"}</div>
              </div>
              <span className="audit-badge danger">{pwned[e.id].toLocaleString("ru-RU")} утечек</span>
            </div>
          ))}
        </>
      )}

      {weak.length > 0 && (
        <>
          <div className="audit-section-title">Слабые пароли</div>
          {weak.map((e) => {
            const s = estimateStrength(e.password);
            return (
              <div className="audit-item" key={e.id} onClick={() => onSelect(e.id)}>
                <div className="ai-meta">
                  <div className="ai-title">{e.title}</div>
                  <div className="ai-sub">{e.username || e.url || "-"}</div>
                </div>
                <span className="audit-badge warn" style={{ color: s.color }}>{s.label}</span>
              </div>
            );
          })}
        </>
      )}

      {duplicates.length > 0 && (
        <>
          <div className="audit-section-title">Повторяющиеся пароли</div>
          {duplicates.map((group, i) => (
            <div className="audit-item" key={i} onClick={() => onSelect(group[0].id)}>
              <div className="ai-meta">
                <div className="ai-title">{group.map((e) => e.title).join(", ")}</div>
                <div className="ai-sub">Один и тот же пароль в {group.length} записях</div>
              </div>
              <span className="audit-badge warn">×{group.length}</span>
            </div>
          ))}
        </>
      )}

      {weak.length === 0 && dupCount === 0 && (scanned ? pwnedList.length === 0 : true) && (
        <div className="ok-msg" style={{ marginTop: 16 }}>
          Слабых и повторяющихся паролей не найдено{scanned ? ", утечек тоже нет" : ""}.
        </div>
      )}
    </div>
  );
}
