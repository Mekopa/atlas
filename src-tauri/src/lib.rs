// Atlas — Tauri entry point.
//
// Atlas is a cockpit UI over herdr's socket/CLI API. This Rust side only
// provides ONE bridge: run `herdr <args>` and return its stdout as JSON.
// All fleet logic lives in the TS `agentService` layer (src/lib/agentService.ts),
// so swapping herdr for a different daemon later only touches that layer.

use serde::Serialize;
use std::process::Command;

#[derive(Serialize)]
struct HerdrResult {
    ok: bool,
    json: Option<serde_json::Value>,
    error: Option<String>,
}

/// Runs `herdr <args...>` and returns its JSON stdout.
///
/// herdr prints `{"id": ..., "result": ...}` (or `{"error": ...}`) to stdout
/// for every subcommand, so we hand the raw stdout back to the UI and let the
/// TS layer unwrap `.result`. Anything printed to stderr is captured as error.
#[tauri::command]
async fn herdr(args: Vec<String>) -> HerdrResult {
    let output = match Command::new("herdr").args(&args).output() {
        Ok(o) => o,
        Err(e) => {
            return HerdrResult {
                ok: false,
                json: None,
                error: Some(format!("failed to spawn herdr: {e}")),
            }
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return HerdrResult {
            ok: false,
            json: None,
            error: Some(if !stderr.is_empty() {
                stderr
            } else {
                format!("herdr exited with {}", output.status)
            }),
        };
    }

    match serde_json::from_str::<serde_json::Value>(&stdout) {
        Ok(v) => HerdrResult {
            ok: true,
            json: Some(v),
            error: None,
        },
        Err(e) => HerdrResult {
            ok: false,
            json: None,
            error: Some(format!("herdr returned non-JSON: {e}")),
        },
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![herdr])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
