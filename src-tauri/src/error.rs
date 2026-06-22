use serde::Serialize;

/// Ошибки приложения. Сериализуются в строку для фронтенда.
#[derive(Debug, thiserror::Error)]
pub enum AegisError {
    #[error("неверный мастер-пароль")]
    WrongPassword,

    #[error("хранилище заблокировано")]
    Locked,

    #[error("хранилище уже существует")]
    AlreadyExists,

    #[error("хранилище не найдено")]
    NotFound,

    #[error("запись не найдена")]
    EntryNotFound,

    #[error("повреждённый файл хранилища")]
    Corrupted,

    #[error("ошибка шифрования: {0}")]
    Crypto(String),

    #[error("ошибка ввода-вывода: {0}")]
    Io(String),

    #[error("внутренняя ошибка: {0}")]
    Internal(String),
}

impl From<std::io::Error> for AegisError {
    fn from(e: std::io::Error) -> Self {
        AegisError::Io(e.to_string())
    }
}

impl Serialize for AegisError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
