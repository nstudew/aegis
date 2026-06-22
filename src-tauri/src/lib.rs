mod crypto;
mod error;
mod vault;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{Manager, State};

use crypto::MasterKey;
use error::AegisError;
use vault::{Entry, GenOptions, Settings, VaultData};

/// Разблокированное состояние, живущее только в памяти процесса.
struct Unlocked {
    key: MasterKey,
    data: VaultData,
}

/// Глобальное состояние приложения.
#[derive(Default)]
struct AppState {
    inner: Mutex<Option<Unlocked>>,
}

/// Путь к файлу хранилища в каталоге данных приложения.
fn vault_path(app: &tauri::AppHandle) -> Result<PathBuf, AegisError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AegisError::Internal(e.to_string()))?;
    Ok(dir.join("vault.aegis"))
}

/// Данные записи, приходящие с фронтенда (без служебных полей).
#[derive(serde::Deserialize)]
struct EntryInput {
    title: String,
    #[serde(default = "default_login_kind")]
    kind: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    password: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    seed: String,
    #[serde(default)]
    totp: String,
    #[serde(default)]
    network: String,
    #[serde(default)]
    favorite: bool,
}

fn default_login_kind() -> String {
    "login".to_string()
}

// ---------------------------------------------------------------------------
// Команды
// ---------------------------------------------------------------------------

#[tauri::command]
fn vault_exists(app: tauri::AppHandle) -> Result<bool, AegisError> {
    Ok(vault_path(&app)?.exists())
}

#[tauri::command]
fn is_unlocked(state: State<AppState>) -> bool {
    state.inner.lock().unwrap().is_some()
}

#[tauri::command]
fn create_vault(
    app: tauri::AppHandle,
    state: State<AppState>,
    master_password: String,
) -> Result<Vec<Entry>, AegisError> {
    if master_password.trim().is_empty() {
        return Err(AegisError::Internal("пустой мастер-пароль".into()));
    }
    let path = vault_path(&app)?;
    let (key, data) = vault::create(&path, &master_password)?;
    let entries = data.entries.clone();
    *state.inner.lock().unwrap() = Some(Unlocked { key, data });
    Ok(entries)
}

#[tauri::command]
fn unlock(
    app: tauri::AppHandle,
    state: State<AppState>,
    master_password: String,
) -> Result<Vec<Entry>, AegisError> {
    let path = vault_path(&app)?;
    let (key, data) = vault::open(&path, &master_password)?;
    let entries = data.entries.clone();
    *state.inner.lock().unwrap() = Some(Unlocked { key, data });
    Ok(entries)
}

#[tauri::command]
fn lock(state: State<AppState>) {
    // Сбрасываем состояние - Drop зануляет ключ и пароли.
    *state.inner.lock().unwrap() = None;
}

#[tauri::command]
fn list_entries(state: State<AppState>) -> Result<Vec<Entry>, AegisError> {
    let guard = state.inner.lock().unwrap();
    let u = guard.as_ref().ok_or(AegisError::Locked)?;
    Ok(u.data.entries.clone())
}

#[tauri::command]
fn add_entry(
    app: tauri::AppHandle,
    state: State<AppState>,
    input: EntryInput,
) -> Result<Entry, AegisError> {
    let path = vault_path(&app)?;
    let mut guard = state.inner.lock().unwrap();
    let u = guard.as_mut().ok_or(AegisError::Locked)?;

    let entry = build_entry(input);
    u.data.entries.push(entry.clone());
    vault::save(&path, &u.key, &u.data)?;
    Ok(entry)
}

fn build_entry(input: EntryInput) -> Entry {
    let now = vault::now_ms();
    Entry {
        id: vault::new_id(),
        title: input.title,
        kind: input.kind,
        username: input.username,
        password: input.password,
        url: input.url,
        notes: input.notes,
        seed: input.seed,
        totp: input.totp,
        network: input.network,
        favorite: input.favorite,
        created_at: now,
        updated_at: now,
    }
}

#[tauri::command]
fn update_entry(
    app: tauri::AppHandle,
    state: State<AppState>,
    id: String,
    input: EntryInput,
) -> Result<Entry, AegisError> {
    let path = vault_path(&app)?;
    let mut guard = state.inner.lock().unwrap();
    let u = guard.as_mut().ok_or(AegisError::Locked)?;

    let entry = u
        .data
        .entries
        .iter_mut()
        .find(|e| e.id == id)
        .ok_or(AegisError::EntryNotFound)?;
    entry.title = input.title;
    entry.kind = input.kind;
    entry.username = input.username;
    entry.password = input.password;
    entry.url = input.url;
    entry.notes = input.notes;
    entry.seed = input.seed;
    entry.totp = input.totp;
    entry.network = input.network;
    entry.favorite = input.favorite;
    entry.updated_at = vault::now_ms();
    let result = entry.clone();

    vault::save(&path, &u.key, &u.data)?;
    Ok(result)
}

#[tauri::command]
fn delete_entry(
    app: tauri::AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<(), AegisError> {
    let path = vault_path(&app)?;
    let mut guard = state.inner.lock().unwrap();
    let u = guard.as_mut().ok_or(AegisError::Locked)?;

    let before = u.data.entries.len();
    u.data.entries.retain(|e| e.id != id);
    if u.data.entries.len() == before {
        return Err(AegisError::EntryNotFound);
    }
    vault::save(&path, &u.key, &u.data)?;
    Ok(())
}

#[tauri::command]
fn change_master_password(
    app: tauri::AppHandle,
    state: State<AppState>,
    current_password: String,
    new_password: String,
) -> Result<(), AegisError> {
    if new_password.trim().is_empty() {
        return Err(AegisError::Internal("пустой новый пароль".into()));
    }
    let path = vault_path(&app)?;
    let mut guard = state.inner.lock().unwrap();
    let u = guard.as_mut().ok_or(AegisError::Locked)?;

    // Проверяем текущий пароль, заново открыв файл.
    vault::open(&path, &current_password)?;

    // Создаём новую соль/ключ путём перезаписи файла с нуля.
    let data_json = serde_json::to_vec(&u.data)
        .map_err(|e| AegisError::Internal(e.to_string()))?;
    let new_data: VaultData =
        serde_json::from_slice(&data_json).map_err(|_| AegisError::Corrupted)?;

    std::fs::remove_file(&path).ok();
    let (new_key, _) = vault::create(&path, &new_password)?;
    vault::save(&path, &new_key, &new_data)?;
    u.key = new_key;
    Ok(())
}

#[tauri::command]
fn generate_password(options: GenOptions) -> String {
    vault::generate_password(&options)
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Result<Settings, AegisError> {
    let guard = state.inner.lock().unwrap();
    let u = guard.as_ref().ok_or(AegisError::Locked)?;
    Ok(u.data.settings.clone())
}

#[tauri::command]
fn set_settings(
    app: tauri::AppHandle,
    state: State<AppState>,
    settings: Settings,
) -> Result<(), AegisError> {
    let path = vault_path(&app)?;
    let mut guard = state.inner.lock().unwrap();
    let u = guard.as_mut().ok_or(AegisError::Locked)?;
    u.data.settings = settings;
    vault::save(&path, &u.key, &u.data)?;
    Ok(())
}

/// Массовый импорт записей (например, из CSV). Возвращает полный список.
#[tauri::command]
fn import_entries(
    app: tauri::AppHandle,
    state: State<AppState>,
    items: Vec<EntryInput>,
) -> Result<Vec<Entry>, AegisError> {
    let path = vault_path(&app)?;
    let mut guard = state.inner.lock().unwrap();
    let u = guard.as_mut().ok_or(AegisError::Locked)?;
    for input in items {
        u.data.entries.push(build_entry(input));
    }
    vault::save(&path, &u.key, &u.data)?;
    Ok(u.data.entries.clone())
}

/// Прочитать текстовый файл по абсолютному пути (для импорта CSV).
#[tauri::command]
fn read_text(path: String) -> Result<String, AegisError> {
    std::fs::read_to_string(&path).map_err(AegisError::from)
}

/// Экспорт зашифрованного файла хранилища в выбранный путь (как есть, зашифрован).
#[tauri::command]
fn export_vault(app: tauri::AppHandle, dest: String) -> Result<(), AegisError> {
    let path = vault_path(&app)?;
    if !path.exists() {
        return Err(AegisError::NotFound);
    }
    std::fs::copy(&path, &dest)?;
    Ok(())
}

/// Импорт зашифрованного файла хранилища. Заменяет текущий файл и блокирует
/// приложение - далее требуется разблокировка мастер-паролем этого файла.
#[tauri::command]
fn import_vault(
    app: tauri::AppHandle,
    state: State<AppState>,
    src: String,
) -> Result<(), AegisError> {
    let raw = std::fs::read(&src).map_err(|_| AegisError::NotFound)?;
    // Базовая проверка формата перед заменой.
    if raw.len() < 6 || &raw[..6] != b"AEGIS\x01" {
        return Err(AegisError::Corrupted);
    }
    let path = vault_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, &raw)?;
    *state.inner.lock().unwrap() = None; // блокируем
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            vault_exists,
            is_unlocked,
            create_vault,
            unlock,
            lock,
            list_entries,
            add_entry,
            update_entry,
            delete_entry,
            change_master_password,
            generate_password,
            get_settings,
            set_settings,
            import_entries,
            export_vault,
            import_vault,
            read_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
