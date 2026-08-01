// realtime.rs — persistent herdr socket client for Atlas.
//
// This is the PUSH half of the herdr bridge. Where the `herdr` tauri command
// is request/response (spawn CLI, read stdout), this module keeps ONE
// persistent connection to herdr's API socket (`~/.config/herdr/herdr.sock`),
// subscribes to structure/status events, and re-emits them to the webview as
// Tauri events.
//
// herdr does NOT push pane *output* over the API (a pane.output_changed schema
// exists on main but the runtime loop does not emit it; and older servers lack
// the output/status tags entirely), so the webview reacts to these events by
// calling the existing `readPane` invoke path on demand, and falls back to a
// light poll when the output tags are unavailable.
//
// Resilience: the subscribe request fails wholesale if ANY tag is unknown
// (protocol mismatch across herdr versions), so we probe each tag with a
// short-lived connection at startup and subscribe only to what the server
// accepts. Works against both old (0.6.x) and new (main) herdr.
//
// Only reads over the PUBLIC API socket — never herdr's private TUI client
// socket, and never herdr's code. Boundary stays agentService.ts in the UI.

use std::io::{BufRead, BufReader, Write as _};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use interprocess::local_socket::{prelude::*, GenericFilePath};
use serde_json::json;
use tauri::{AppHandle, Emitter};

const SOCKET_PATH: &str = "/Users/mekopa/.config/herdr/herdr.sock";
const RECONNECT_DELAY_MS: u64 = 2000;

/// Events emitted to the webview.
pub const EVENT_STRUCTURE: &str = "herdr:structure";
pub const EVENT_STATUS: &str = "herdr:status";
pub const EVENT_PANE: &str = "herdr:pane";

/// All herdr `Subscription` serde tags we understand. Some are rejected by
/// older servers; the accepted subset is probed at startup.
const SUBSCRIPTIONS: &[&str] = &[
    "workspace.created",
    "workspace.updated",
    "workspace.renamed",
    "workspace.closed",
    "workspace.focused",
    "tab.created",
    "tab.closed",
    "tab.focused",
    "tab.renamed",
    "tab.moved",
    "pane.created",
    "pane.closed",
    "pane.updated",
    "pane.focused",
    "pane.moved",
    "pane.exited",
    "pane.agent_detected",
    "pane.agent_status_changed",
    "pane.scroll_changed",
];

/// Cached set of tags the connected server accepts (probed once).
static ACCEPTED: Mutex<Option<Vec<String>>> = Mutex::new(None);

fn connect() -> Option<interprocess::local_socket::Stream> {
    let name = SOCKET_PATH.to_fs_name::<GenericFilePath>().ok()?;
    interprocess::local_socket::Stream::connect(name).ok()
}

/// Sends one JSON-RPC request and reads the first response line.
fn request_once(
    stream: &mut interprocess::local_socket::Stream,
    req: serde_json::Value,
) -> Option<serde_json::Value> {
    let mut payload = req.to_string().into_bytes();
    payload.push(b'\n');
    stream.write_all(&payload).ok()?;
    stream.flush().ok()?;
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).ok().filter(|_| !line.is_empty())?;
    serde_json::from_str(line.trim()).ok()
}

/// Probes a single subscription tag with a short-lived connection.
fn tag_supported(tag: &str) -> bool {
    let mut stream = match connect() {
        Some(s) => s,
        None => return false,
    };
    let req = json!({
        "id": "atlas:probe",
        "method": "events.subscribe",
        "params": { "subscriptions": [ { "type": tag } ] }
    });
    match request_once(&mut stream, req) {
        Some(resp) => resp.get("error").is_none(),
        None => false,
    }
}

/// Returns the subset of SUBSCRIPTIONS the server accepts (cached).
fn accepted_tags() -> Vec<String> {
    if let Ok(guard) = ACCEPTED.lock() {
        if let Some(cached) = guard.as_ref() {
            return cached.clone();
        }
    }
    let accepted = SUBSCRIPTIONS
        .iter()
        .filter(|tag| tag_supported(tag))
        .map(|s| s.to_string())
        .collect::<Vec<_>>();
    if let Ok(mut guard) = ACCEPTED.lock() {
        *guard = Some(accepted.clone());
    }
    println!("[realtime] subscribed tags: {}", accepted.join(", "));
    accepted
}

/// Forwards one newline-delimited event line to the webview, routed by kind.
fn forward_event(app: &AppHandle, line: &str) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return;
    };
    let Some(event) = value.get("event").and_then(|e| e.as_str()) else {
        return;
    };

    match event {
        "pane.updated" | "pane.output_changed" | "pane.scroll_changed" => {
            let pane_id = value
                .pointer("/data/pane_id")
                .or_else(|| value.pointer("/data/pane/pane_id"))
                .and_then(|v| v.as_str());
            if let Some(id) = pane_id {
                let _ = app.emit(EVENT_PANE, json!({ "pane_id": id }));
            }
        }
        "pane.agent_status_changed" | "pane.agent_detected" => {
            let _ = app.emit(EVENT_STATUS, &value);
        }
        _ => {
            let _ = app.emit(EVENT_STRUCTURE, &value);
        }
    }
}

/// Connects, subscribes to the accepted tags, and forwards events until close.
fn run(app: AppHandle, mut stream: interprocess::local_socket::Stream) {
    let subs: Vec<serde_json::Value> = accepted_tags()
        .into_iter()
        .map(|t| json!({ "type": t }))
        .collect();
    if subs.is_empty() {
        return;
    }

    let subscribe = json!({
        "id": "atlas:subscribe",
        "method": "events.subscribe",
        "params": { "subscriptions": subs }
    })
    .to_string();
    let mut payload = subscribe.into_bytes();
    payload.push(b'\n');

    if stream.write_all(&payload).is_err() || stream.flush().is_err() {
        return;
    }

    let mut reader = BufReader::new(stream);
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => return,
            Ok(_) => forward_event(&app, line.trim()),
        }
    }
}

/// Connects to herdr's API socket and forwards events forever, reconnecting
/// on failure or close.
pub fn start(app: AppHandle) {
    thread::spawn(move || loop {
        if let Some(stream) = connect() {
            run(app.clone(), stream);
        }
        thread::sleep(Duration::from_millis(RECONNECT_DELAY_MS));
    });
}
