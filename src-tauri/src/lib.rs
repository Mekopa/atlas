// Atlas — Tauri entry point.
//
// Atlas is a cockpit UI over agent daemons/CLIs. This Rust side provides a thin
// bridge: run an external CLI binary and return its stdout. All fleet logic
// lives in the TS service layers (agentService for herdr, opencodeHistory for
// opencode, acpService for ACP), so swapping a backend later only touches its
// TS layer.

use serde::Serialize;
use std::process::Command;

mod realtime;

#[derive(Serialize)]
struct CliResult {
    ok: bool,
    json: Option<serde_json::Value>,
    error: Option<String>,
}

/// Runs `binary <args...>` and returns its JSON stdout.
///
/// The binary must print JSON to stdout (herdr CLI does; `opencode export`
/// prints a raw JSON object). Anything on stderr is captured as error.
async fn run_cli(binary: &str, args: Vec<String>) -> CliResult {
    let output = match Command::new(binary).args(&args).output() {
        Ok(o) => o,
        Err(e) => {
            return CliResult {
                ok: false,
                json: None,
                error: Some(format!("failed to spawn {binary}: {e}")),
            }
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return CliResult {
            ok: false,
            json: None,
            error: Some(if !stderr.is_empty() {
                stderr
            } else {
                format!("{binary} exited with {}", output.status)
            }),
        };
    }

    match serde_json::from_str::<serde_json::Value>(&stdout) {
        Ok(v) => CliResult {
            ok: true,
            json: Some(v),
            error: None,
        },
        Err(e) => CliResult {
            ok: false,
            json: None,
            error: Some(format!("{binary} returned non-JSON: {e}")),
        },
    }
}

/// Runs `herdr <args...>` and returns its JSON stdout.
#[tauri::command]
async fn herdr(args: Vec<String>) -> CliResult {
    run_cli("herdr", args).await
}

/// Runs `opencode <args...>` and returns its JSON stdout (e.g. `export <id>`).
#[tauri::command]
async fn opencode(args: Vec<String>) -> CliResult {
    run_cli("/Users/mekopa/.opencode/bin/opencode", args).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![herdr, opencode])
        .setup(|app| {
            realtime::start(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
