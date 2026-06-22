import { useCallback, useEffect, useState } from "react";
import { api, GenOptions } from "../api";
import { estimateStrength } from "../strength";
import { copyWithClear } from "../clipboard";
import { Copy, Check, Refresh } from "./icons";

interface Props {
  onUse?: (password: string) => void;
  compact?: boolean;
  defaults?: GenOptions;
  clipboardClearSecs?: number;
}

const FALLBACK: GenOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  exclude_ambiguous: false,
};

export default function Generator({ onUse, compact, defaults, clipboardClearSecs = 240 }: Props) {
  const [opts, setOpts] = useState<GenOptions>(defaults ?? FALLBACK);
  const [password, setPassword] = useState("");
  const [copied, setCopied] = useState(false);

  const regenerate = useCallback(async (o: GenOptions) => {
    setPassword(await api.generatePassword(o));
    setCopied(false);
  }, []);

  useEffect(() => {
    regenerate(opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (patch: Partial<GenOptions>) => {
    const next = { ...opts, ...patch };
    if (!next.lowercase && !next.uppercase && !next.digits && !next.symbols) next.lowercase = true;
    setOpts(next);
    regenerate(next);
  };

  const copy = async () => {
    await copyWithClear(password, clipboardClearSecs);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const strength = estimateStrength(password);

  return (
    <div className={`generator ${compact ? "compact" : ""}`}>
      <div className="gen-output">
        <code className="gen-password">{password}</code>
        <div className="gen-actions">
          <button className="icon-btn" title="Заново" onClick={() => regenerate(opts)}><Refresh /></button>
          <button className="icon-btn" title="Скопировать" onClick={copy}>{copied ? <Check /> : <Copy />}</button>
        </div>
      </div>

      <div className="strength-row">
        <div className="strength-bar">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="strength-seg" style={{ background: i <= strength.score ? strength.color : undefined }} />
          ))}
        </div>
        <span className="strength-label" style={{ color: strength.color }}>{strength.label} · ~{strength.bits} бит</span>
      </div>

      <div className="gen-controls">
        <label className="length-control">
          <span>Длина: {opts.length}</span>
          <input type="range" min={8} max={64} value={opts.length} onChange={(e) => update({ length: Number(e.target.value) })} />
        </label>
        <div className="toggles">
          <Toggle label="a-z" on={opts.lowercase} onClick={() => update({ lowercase: !opts.lowercase })} />
          <Toggle label="A-Z" on={opts.uppercase} onClick={() => update({ uppercase: !opts.uppercase })} />
          <Toggle label="0-9" on={opts.digits} onClick={() => update({ digits: !opts.digits })} />
          <Toggle label="!@#" on={opts.symbols} onClick={() => update({ symbols: !opts.symbols })} />
          <Toggle label="Без похожих" on={opts.exclude_ambiguous} onClick={() => update({ exclude_ambiguous: !opts.exclude_ambiguous })} />
        </div>
      </div>

      {onUse && <button className="btn btn-primary gen-use" onClick={() => onUse(password)}>Использовать этот пароль</button>}
    </div>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return <button className={`toggle ${on ? "on" : ""}`} onClick={onClick} type="button">{label}</button>;
}
