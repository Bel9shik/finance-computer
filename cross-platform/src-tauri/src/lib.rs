use std::{
    fs,
    io::Write,
    path::Path,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
#[cfg(desktop)]
mod startup_check;
#[cfg(windows)]
mod windows_offline;
struct DatabaseLock(Mutex<()>);
#[tauri::command]
fn load_ledger(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("ledger.json");
    match fs::read_to_string(path) {
        Ok(data) => Ok(Some(data)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
#[tauri::command]
fn save_ledger(
    app: tauri::AppHandle,
    state: tauri::State<DatabaseLock>,
    data: String,
    backup: bool,
) -> Result<(), String> {
    #[cfg(desktop)]
    if startup_check::requested() {
        return Err("Проверка запуска не изменяет базу".into());
    }
    let _guard = state.0.lock().map_err(|e| e.to_string())?;
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
    save_in(&directory, &data, backup)
}
fn save_in(directory: &Path, data: &str, backup: bool) -> Result<(), String> {
    if data.len() > 256 * 1024 * 1024 {
        return Err("База больше 256 МБ".into());
    }
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    let path = directory.join("ledger.json");
    if backup && path.exists() {
        let backups = directory.join("Backups");
        fs::create_dir_all(&backups).map_err(|e| e.to_string())?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        fs::copy(&path, backups.join(format!("ledger-{stamp}.json"))).map_err(|e| e.to_string())?;
    }
    atomicwrites::AtomicFile::new(&path, atomicwrites::AllowOverwrite)
        .write(|file| {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                file.set_permissions(fs::Permissions::from_mode(0o600))?;
            }
            file.write_all(data.as_bytes())?;
            file.sync_all()
        })
        .map_err(|e| e.to_string())
}
fn bundled_url(url: &tauri::Url) -> bool {
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https")
            && url.host_str() == Some("tauri.localhost")
            && url.port().is_none())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn navigation_stays_in_bundled_app() {
        for url in [
            "tauri://localhost/",
            "http://tauri.localhost/",
            "https://tauri.localhost/index.html",
        ] {
            assert!(bundled_url(&url.parse().unwrap()), "{url}");
        }
        for url in [
            "https://example.com/",
            "https://tauri.localhost.evil.test/",
            "http://127.0.0.1/",
            "http://tauri.localhost:8080/",
            "file:///tmp/test.html",
            "data:text/html,test",
            "javascript:alert(1)",
        ] {
            assert!(!bundled_url(&url.parse().unwrap()), "{url}");
        }
    }
    #[test]
    fn replacement_is_atomic_and_requires_a_backup() {
        let directory = std::env::temp_dir().join(format!(
            "finance-storage-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        save_in(&directory, "old", false).unwrap();
        fs::write(directory.join("Backups"), "blocked").unwrap();
        assert!(save_in(&directory, "new", true).is_err());
        assert_eq!(
            fs::read_to_string(directory.join("ledger.json")).unwrap(),
            "old"
        );
        fs::remove_file(directory.join("Backups")).unwrap();
        save_in(&directory, "new", true).unwrap();
        let backup = fs::read_dir(directory.join("Backups"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(fs::read_to_string(backup).unwrap(), "old");
        assert_eq!(
            fs::read_to_string(directory.join("ledger.json")).unwrap(),
            "new"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(directory.join("ledger.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        fs::remove_dir_all(directory).unwrap();
    }
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DatabaseLock(Mutex::new(())))
        .plugin(
            tauri::plugin::Builder::<_, ()>::new("offline-navigation")
                .on_navigation(|webview, url| {
                    bundled_url(url)
                        || (cfg!(dev)
                            && webview
                                .app_handle()
                                .config()
                                .build
                                .dev_url
                                .as_ref()
                                .is_some_and(|dev| url.origin() == dev.origin()))
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            #[cfg(windows)]
            windows_offline::install(&app.get_webview_window("main").expect("Main window"))?;
            #[cfg(desktop)]
            if startup_check::requested() {
                startup_check::run(app.handle().clone());
            }
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![load_ledger, save_ledger])
        .run(tauri::generate_context!())
        .expect("Не удалось запустить приложение");
}
