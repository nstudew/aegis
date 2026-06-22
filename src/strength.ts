// Оценка стойкости пароля по приблизительной энтропии (в битах).
// Не заменяет zxcvbn, но даёт честный ориентир без внешних зависимостей.

export interface Strength {
  bits: number;
  score: 0 | 1 | 2 | 3 | 4; // 0 - очень слабо ... 4 - отлично
  label: string;
  color: string;
}

const LABELS = ["Очень слабый", "Слабый", "Средний", "Хороший", "Отличный"];
// Приглушённая палитра без кислотных цветов.
const COLORS = ["#a86a62", "#a88c5e", "#9a9466", "#6f8f72", "#5f9a86"];

export function estimateStrength(pw: string): Strength {
  if (!pw) {
    return { bits: 0, score: 0, label: "-", color: "#3f3f46" };
  }

  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  if (pool === 0) pool = 1;

  // Базовая энтропия.
  let bits = pw.length * Math.log2(pool);

  // Штрафы за повторы и простые последовательности.
  const unique = new Set(pw).size;
  if (unique <= 2) bits *= 0.4;
  else if (unique / pw.length < 0.5) bits *= 0.7;
  if (/^(.)\1+$/.test(pw)) bits *= 0.2;
  if (/^(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|qwerty|password|пароль)/i.test(pw)) {
    bits *= 0.5;
  }

  bits = Math.round(bits);

  let score: Strength["score"];
  if (bits < 30) score = 0;
  else if (bits < 50) score = 1;
  else if (bits < 70) score = 2;
  else if (bits < 100) score = 3;
  else score = 4;

  return { bits, score, label: LABELS[score], color: COLORS[score] };
}
