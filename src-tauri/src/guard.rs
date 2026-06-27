//! Защита от перебора мастер-пароля.
//!
//! Логика чистая (без ввода-вывода и системного времени), чтобы её можно было
//! покрыть юнит-тестами. Состояние (число неудач и время окончания блокировки)
//! хранится на диске в `guard.json`, чтобы перезапуск приложения не сбрасывал
//! счётчик.
//!
//! Правила:
//!   - после FIRST_THRESHOLD (3) неверных попыток -> блокировка на LOCKOUT (30 мин);
//!   - после WIPE_THRESHOLD (6) неверных попыток всего -> полное удаление данных.
//! Успешный вход сбрасывает счётчик.

use serde::{Deserialize, Serialize};

pub const FIRST_THRESHOLD: u32 = 3;
pub const WIPE_THRESHOLD: u32 = 6;
pub const LOCKOUT_MS: u64 = 30 * 60 * 1000;

/// Этап, на котором сейчас находится защита (что будет при следующих неудачах).
#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Stage {
    Lockout,
    Wipe,
}

impl Stage {
    pub fn as_str(self) -> &'static str {
        match self {
            Stage::Lockout => "lockout",
            Stage::Wipe => "wipe",
        }
    }
}

/// Результат попытки входа.
#[derive(Debug, PartialEq)]
pub enum Outcome {
    Ok,
    Wrong { attempts_left: u32, next: Stage },
    Locked { remaining_secs: u64 },
    Wiped,
}

/// Сохраняемое состояние защиты.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Guard {
    #[serde(default)]
    pub failed: u32,
    #[serde(default)]
    pub lockout_until_ms: u64,
}

impl Guard {
    /// Если сейчас действует блокировка - возвращает оставшиеся секунды.
    pub fn locked_remaining(&self, now_ms: u64) -> Option<u64> {
        if self.lockout_until_ms > now_ms {
            Some((self.lockout_until_ms - now_ms + 999) / 1000)
        } else {
            None
        }
    }

    /// Зарегистрировать неверную попытку. Меняет состояние и возвращает исход.
    pub fn register_failure(&mut self, now_ms: u64) -> Outcome {
        self.failed += 1;
        if self.failed >= WIPE_THRESHOLD {
            Outcome::Wiped
        } else if self.failed == FIRST_THRESHOLD {
            self.lockout_until_ms = now_ms + LOCKOUT_MS;
            Outcome::Locked {
                remaining_secs: LOCKOUT_MS / 1000,
            }
        } else {
            let (attempts_left, next) = if self.failed < FIRST_THRESHOLD {
                (FIRST_THRESHOLD - self.failed, Stage::Lockout)
            } else {
                (WIPE_THRESHOLD - self.failed, Stage::Wipe)
            };
            Outcome::Wrong { attempts_left, next }
        }
    }

    /// Сбросить после успешного входа.
    pub fn reset(&mut self) {
        self.failed = 0;
        self.lockout_until_ms = 0;
    }

    /// Текущий статус для интерфейса (без совершения попытки):
    /// (заблокировано, осталось секунд, осталось попыток, следующий этап).
    pub fn status(&self, now_ms: u64) -> (bool, u64, u32, Stage) {
        if let Some(rem) = self.locked_remaining(now_ms) {
            (true, rem, WIPE_THRESHOLD.saturating_sub(self.failed), Stage::Wipe)
        } else if self.failed >= FIRST_THRESHOLD {
            (false, 0, WIPE_THRESHOLD.saturating_sub(self.failed), Stage::Wipe)
        } else {
            (false, 0, FIRST_THRESHOLD.saturating_sub(self.failed), Stage::Lockout)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_two_failures_warn_lockout() {
        let mut g = Guard::default();
        assert_eq!(
            g.register_failure(0),
            Outcome::Wrong { attempts_left: 2, next: Stage::Lockout }
        );
        assert_eq!(
            g.register_failure(0),
            Outcome::Wrong { attempts_left: 1, next: Stage::Lockout }
        );
    }

    #[test]
    fn third_failure_locks_out() {
        let mut g = Guard::default();
        g.register_failure(0);
        g.register_failure(0);
        let out = g.register_failure(1000);
        assert_eq!(out, Outcome::Locked { remaining_secs: LOCKOUT_MS / 1000 });
        assert!(g.locked_remaining(1000).is_some());
        // Через 30 минут блокировка снимается.
        assert!(g.locked_remaining(1000 + LOCKOUT_MS).is_none());
    }

    #[test]
    fn post_lockout_failures_warn_wipe_then_wipe() {
        let mut g = Guard::default();
        for _ in 0..3 {
            g.register_failure(0);
        }
        // Этап 2: попытки 4 и 5 предупреждают про удаление.
        assert_eq!(
            g.register_failure(LOCKOUT_MS + 1),
            Outcome::Wrong { attempts_left: 2, next: Stage::Wipe }
        );
        assert_eq!(
            g.register_failure(LOCKOUT_MS + 1),
            Outcome::Wrong { attempts_left: 1, next: Stage::Wipe }
        );
        // Шестая неудача - удаление.
        assert_eq!(g.register_failure(LOCKOUT_MS + 1), Outcome::Wiped);
    }

    #[test]
    fn reset_clears_state() {
        let mut g = Guard::default();
        g.register_failure(0);
        g.register_failure(0);
        g.reset();
        assert_eq!(g, Guard::default());
    }

    #[test]
    fn status_reflects_stage() {
        let mut g = Guard::default();
        let (locked, _, left, next) = g.status(0);
        assert!(!locked && left == 3 && next == Stage::Lockout);
        g.register_failure(0);
        g.register_failure(0);
        g.register_failure(1000); // lockout
        let (locked, rem, left, next) = g.status(1000);
        assert!(locked && rem > 0 && left == 3 && next == Stage::Wipe);
    }
}
