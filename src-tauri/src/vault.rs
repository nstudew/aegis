//! Модель данных хранилища, его (де)сериализация на диск и
//! криптостойкий генератор паролей.

use rand::seq::SliceRandom;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::path::Path;
use zeroize::Zeroize;

use crate::crypto::{self, MasterKey, NONCE_LEN, SALT_LEN};
use crate::error::AegisError;

const MAGIC: &[u8; 6] = b"AEGIS\x01";

/// Тип записи: обычный логин или крипто-кошелёк.
fn default_kind() -> String {
    "login".to_string()
}

/// Одна запись хранилища (логин/пароль/заметка/крипто-кошелёк).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub title: String,
    /// "login" | "crypto"
    #[serde(default = "default_kind")]
    pub kind: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub notes: String,
    /// Сид-фраза / приватный ключ крипто-кошелька.
    #[serde(default)]
    pub seed: String,
    /// Секрет TOTP (base32) для генерации 2FA-кодов.
    #[serde(default)]
    pub totp: String,
    /// Сеть/блокчейн для крипто-кошельков (ETH, BTC, Solana…).
    #[serde(default)]
    pub network: String,
    #[serde(default)]
    pub favorite: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

/// Пользовательские настройки (хранятся внутри зашифрованного файла).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    /// Таймаут автоблокировки при бездействии, секунды (0 - выключено).
    pub auto_lock_secs: u64,
    /// Через сколько секунд очищать буфер обмена после копирования.
    pub clipboard_clear_secs: u64,
    /// Блокировать при сворачивании окна.
    pub lock_on_minimize: bool,
    /// Параметры генератора по умолчанию.
    pub gen_length: usize,
    pub gen_lowercase: bool,
    pub gen_uppercase: bool,
    pub gen_digits: bool,
    pub gen_symbols: bool,
    pub gen_exclude_ambiguous: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            auto_lock_secs: 300,
            clipboard_clear_secs: 240,
            lock_on_minimize: true,
            gen_length: 20,
            gen_lowercase: true,
            gen_uppercase: true,
            gen_digits: true,
            gen_symbols: true,
            gen_exclude_ambiguous: false,
        }
    }
}

/// Внутреннее содержимое хранилища (то, что шифруется).
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct VaultData {
    pub entries: Vec<Entry>,
    #[serde(default)]
    pub settings: Settings,
}

impl Drop for VaultData {
    fn drop(&mut self) {
        // Затираем секреты в памяти при сбросе.
        for e in &mut self.entries {
            e.password.zeroize();
            e.notes.zeroize();
            e.seed.zeroize();
            e.totp.zeroize();
        }
    }
}

/// Текущее millis-время (UTC).
pub fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Сгенерировать короткий случайный id.
pub fn new_id() -> String {
    let mut bytes = [0u8; 12];
    rand::thread_rng().fill(&mut bytes);
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Создать новый файл хранилища с заданным мастер-паролем.
/// Соль генерируется и записывается в заголовок файла.
pub fn create(path: &Path, master_password: &str) -> Result<(MasterKey, VaultData), AegisError> {
    if path.exists() {
        return Err(AegisError::AlreadyExists);
    }
    let salt = crypto::random_salt();
    let key = crypto::derive_key(master_password, &salt)?;
    let data = VaultData::default();
    write_to_disk(path, &salt, &key, &data)?;
    Ok((key, data))
}

/// Открыть существующее хранилище. Возвращает ключ + расшифрованные данные.
pub fn open(path: &Path, master_password: &str) -> Result<(MasterKey, VaultData), AegisError> {
    let raw = std::fs::read(path).map_err(|_| AegisError::NotFound)?;
    if raw.len() < MAGIC.len() + SALT_LEN + NONCE_LEN || &raw[..MAGIC.len()] != MAGIC {
        return Err(AegisError::Corrupted);
    }

    let mut off = MAGIC.len();
    let salt = &raw[off..off + SALT_LEN];
    off += SALT_LEN;
    let nonce = &raw[off..off + NONCE_LEN];
    off += NONCE_LEN;
    let ciphertext = &raw[off..];

    let key = crypto::derive_key(master_password, salt)?;
    let mut plaintext = crypto::decrypt(&key, nonce, ciphertext)?;

    let data: VaultData =
        serde_json::from_slice(&plaintext).map_err(|_| AegisError::Corrupted)?;
    plaintext.zeroize();
    Ok((key, data))
}

/// Перешифровать и атомарно записать данные. Соль читается из существующего
/// файла, чтобы ключ оставался валидным.
pub fn save(path: &Path, key: &MasterKey, data: &VaultData) -> Result<(), AegisError> {
    let salt = read_salt(path)?;
    write_to_disk(path, &salt, key, data)
}

fn read_salt(path: &Path) -> Result<[u8; SALT_LEN], AegisError> {
    let raw = std::fs::read(path).map_err(|_| AegisError::NotFound)?;
    if raw.len() < MAGIC.len() + SALT_LEN || &raw[..MAGIC.len()] != MAGIC {
        return Err(AegisError::Corrupted);
    }
    let mut salt = [0u8; SALT_LEN];
    salt.copy_from_slice(&raw[MAGIC.len()..MAGIC.len() + SALT_LEN]);
    Ok(salt)
}

fn write_to_disk(
    path: &Path,
    salt: &[u8],
    key: &MasterKey,
    data: &VaultData,
) -> Result<(), AegisError> {
    let mut plaintext = serde_json::to_vec(data)
        .map_err(|e| AegisError::Internal(e.to_string()))?;
    let (nonce, ciphertext) = crypto::encrypt(key, &plaintext)?;
    plaintext.zeroize();

    let mut out = Vec::with_capacity(MAGIC.len() + salt.len() + nonce.len() + ciphertext.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(salt);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);

    // Атомарная запись: пишем во временный файл, затем переименовываем.
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, &out)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Генератор паролей
// ---------------------------------------------------------------------------

const LOWER: &str = "abcdefghijkmnpqrstuvwxyz"; // без l, o
const LOWER_FULL: &str = "abcdefghijklmnopqrstuvwxyz";
const UPPER: &str = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // без I, O
const UPPER_FULL: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS: &str = "23456789"; // без 0, 1
const DIGITS_FULL: &str = "0123456789";
const SYMBOLS: &str = "!@#$%^&*()-_=+[]{};:,.?/";

/// Опции генерации пароля, приходящие с фронтенда.
#[derive(Debug, Deserialize)]
pub struct GenOptions {
    pub length: usize,
    pub lowercase: bool,
    pub uppercase: bool,
    pub digits: bool,
    pub symbols: bool,
    #[serde(default)]
    pub exclude_ambiguous: bool,
}

/// Сгенерировать пароль по опциям. Гарантирует наличие хотя бы одного
/// символа из каждой выбранной категории.
pub fn generate_password(opts: &GenOptions) -> String {
    let mut rng = rand::thread_rng();
    let length = opts.length.clamp(4, 256);

    let mut categories: Vec<Vec<char>> = Vec::new();
    if opts.lowercase {
        categories.push(pick(opts.exclude_ambiguous, LOWER, LOWER_FULL));
    }
    if opts.uppercase {
        categories.push(pick(opts.exclude_ambiguous, UPPER, UPPER_FULL));
    }
    if opts.digits {
        categories.push(pick(opts.exclude_ambiguous, DIGITS, DIGITS_FULL));
    }
    if opts.symbols {
        categories.push(SYMBOLS.chars().collect());
    }

    // Если ничего не выбрано - откатываемся к буквам нижнего регистра.
    if categories.is_empty() {
        categories.push(LOWER_FULL.chars().collect());
    }

    let pool: Vec<char> = categories.iter().flatten().copied().collect();

    let mut chars: Vec<char> = Vec::with_capacity(length);
    // По одному символу из каждой категории.
    for cat in &categories {
        if let Some(&c) = cat.choose(&mut rng) {
            chars.push(c);
        }
    }
    // Добиваем до нужной длины из общего пула.
    while chars.len() < length {
        if let Some(&c) = pool.choose(&mut rng) {
            chars.push(c);
        }
    }
    chars.truncate(length);
    chars.shuffle(&mut rng);
    chars.into_iter().collect()
}

fn pick(exclude_ambiguous: bool, reduced: &str, full: &str) -> Vec<char> {
    if exclude_ambiguous {
        reduced.chars().collect()
    } else {
        full.chars().collect()
    }
}
