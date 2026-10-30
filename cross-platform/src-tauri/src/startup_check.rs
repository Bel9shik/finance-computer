// Read-only smoke check in the packaged desktop app, including the real WebView and IPC.
use std::{io::Write, sync::mpsc, thread, time::Duration};
use tauri::Manager;

pub fn requested() -> bool {
    std::env::args().any(|arg| arg == "--check-startup")
}

pub fn run(app: tauri::AppHandle) {
    thread::spawn(move || {
        for _ in 0..60 {
            thread::sleep(Duration::from_millis(500));
            let Some(window) = app.get_webview_window("main") else {
                break;
            };
            let (send, receive) = mpsc::channel();
            if window
                .eval_with_callback(include_str!("../../tests/startup-check.js"), move |value| {
                    let _ = send.send(value);
                })
                .is_err()
            {
                break;
            }
            match receive.recv_timeout(Duration::from_secs(1)).as_deref() {
                Ok(verdict @ ("\"PASS\"" | "\"SANDBOX_PASS\"")) => {
                    if verdict == "\"SANDBOX_PASS\"" {
                        println!("SANDBOX UI PASS: charts, filters, category click, sorting");
                    }
                    println!("STARTUP CHECK PASS: interface, native IPC, offline restrictions");
                    let _ = std::io::stdout().flush();
                    app.exit(0);
                    return;
                }
                Ok(verdict) if verdict.starts_with("\"FAIL") => {
                    eprintln!("STARTUP CHECK DETAIL: {verdict}");
                    break;
                }
                _ => {}
            }
        }
        eprintln!("STARTUP CHECK FAIL: interface or offline restrictions did not pass");
        app.exit(1);
    });
}
