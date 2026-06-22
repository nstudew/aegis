//! Криптографическое ядро Aegis.
//!
//! Схема защиты:
//!   master password --Argon2id(salt)--> 32-байтный ключ
//!   данные хранилища --AES-256-GCM(key, nonce)--> шифртекст
//!
//! Каждое сохранение использует свежий случайный nonce. Мастер-ключ
//! никогда не пишется на диск и зануляется в памяти (zeroize) при блокировке.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use zeroize::Zeroize;

use crate::error::AegisError;

pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 12;
pub const KEY_LEN: usize = 32;

/// Параметры Argon2id. Подобраны как компромисс между стойкостью и
/// временем разблокировки на типичном десктопе (~0.3-0.7 c).
const ARGON_MEM_KIB: u32 = 64 * 1024; // 64 MiB
const ARGON_ITERS: u32 = 3;
const ARGON_PARALLELISM: u32 = 1;

/// Защищённый 32-байтный ключ, который зануляется при сбросе из памяти.
pub struct MasterKey([u8; KEY_LEN]);

impl Drop for MasterKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl MasterKey {
    fn cipher(&self) -> Aes256Gcm {
        Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.0))
    }
}

/// Сгенерировать криптостойкую случайную соль.
pub fn random_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    salt
}

/// Вывести мастер-ключ из пароля и соли через Argon2id.
pub fn derive_key(master_password: &str, salt: &[u8]) -> Result<MasterKey, AegisError> {
    let params = Params::new(ARGON_MEM_KIB, ARGON_ITERS, ARGON_PARALLELISM, Some(KEY_LEN))
        .map_err(|e| AegisError::Crypto(e.to_string()))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut key = [0u8; KEY_LEN];
    argon
        .hash_password_into(master_password.as_bytes(), salt, &mut key)
        .map_err(|e| AegisError::Crypto(e.to_string()))?;

    let mk = MasterKey(key);
    key.zeroize();
    Ok(mk)
}

/// Зашифровать произвольные данные. Возвращает (nonce, ciphertext).
pub fn encrypt(key: &MasterKey, plaintext: &[u8]) -> Result<(Vec<u8>, Vec<u8>), AegisError> {
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = key
        .cipher()
        .encrypt(nonce, plaintext)
        .map_err(|_| AegisError::Crypto("ошибка шифрования".into()))?;

    Ok((nonce_bytes.to_vec(), ciphertext))
}

/// Расшифровать данные. Неверный пароль => ошибка аутентификации тега.
pub fn decrypt(key: &MasterKey, nonce: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, AegisError> {
    let nonce = Nonce::from_slice(nonce);
    key.cipher()
        .decrypt(nonce, ciphertext)
        .map_err(|_| AegisError::WrongPassword)
}
