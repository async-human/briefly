use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_autostart::MacosLauncher;
#[cfg(not(debug_assertions))]
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_deep_link::DeepLinkExt;

const DASHBOARD_URL: &str = "https://www.sendbriefly.app/dashboard";
const CONNECT_URL: &str = "https://www.sendbriefly.app/desktop/connect";

#[derive(Clone, serde::Serialize)]
struct DesktopAuthPayload {
    token: String,
    api_base: Option<String>,
}

#[derive(Default)]
struct WakewordState {
    child: Mutex<Option<Child>>,
}

#[derive(Default)]
struct AuthRelayState {
    cancel: Mutex<Option<Arc<AtomicBool>>>,
}

#[derive(serde::Serialize)]
struct WakewordStartOut {
    active: bool,
    mode: String,
}

fn decode_query_component(v: &str) -> String {
    v.replace('+', " ")
        .replace("%3A", ":")
        .replace("%3a", ":")
        .replace("%2F", "/")
        .replace("%2f", "/")
        .replace("%3F", "?")
        .replace("%3f", "?")
        .replace("%3D", "=")
        .replace("%3d", "=")
        .replace("%26", "&")
        .replace("%25", "%")
}

fn parse_auth_deep_link(arg: &str) -> Option<DesktopAuthPayload> {
    if !arg.starts_with("briefly://auth?") {
        return None;
    }
    let query = arg.split_once('?')?.1;
    let mut token: Option<String> = None;
    let mut api_base: Option<String> = None;
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let v = decode_query_component(v);
        match k {
            "token" if !v.is_empty() => token = Some(v),
            "api_base" if !v.is_empty() => api_base = Some(v),
            _ => {}
        }
    }
    Some(DesktopAuthPayload {
        token: token?,
        api_base,
    })
}

/// Hand the token to the orb UI and reveal the window.
fn deliver_auth_payload(app: &tauri::AppHandle, payload: DesktopAuthPayload) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("desktop-auth", payload);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Parse a `briefly://auth?...` arg and, if valid, hand the token to the orb UI
/// and reveal the window. Returns true if the arg was an auth deep link.
fn handle_auth_deep_link(app: &tauri::AppHandle, arg: &str) -> bool {
    let Some(payload) = parse_auth_deep_link(arg) else {
        return false;
    };
    deliver_auth_payload(app, payload);
    true
}

fn cors_header(origin: &str) -> String {
    const ALLOWED: &[&str] = &[
        "https://www.sendbriefly.app",
        "https://sendbriefly.app",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ];
    let allow = if ALLOWED.contains(&origin) {
        origin.to_string()
    } else {
        "https://www.sendbriefly.app".to_string()
    };
    format!(
        "Access-Control-Allow-Origin: {allow}\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\n"
    )
}

fn write_http_response(stream: &mut TcpStream, status: u16, status_text: &str, cors: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status} {status_text}\r\n{cors}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len(),
        body = body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn handle_relay_connection(mut stream: TcpStream, app: &tauri::AppHandle) -> bool {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(8)));
    let mut reader = BufReader::new(&stream);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return false;
    }
    let mut origin = String::new();
    let mut content_length: usize = 0;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() {
            break;
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        let lower = line.to_lowercase();
        if let Some(v) = lower.strip_prefix("origin:") {
            origin = v.trim().to_string();
        }
        if let Some(v) = lower.strip_prefix("content-length:") {
            content_length = v.trim().parse().unwrap_or(0);
        }
    }
    let cors = cors_header(&origin);
    let method = request_line.split_whitespace().next().unwrap_or("");
    let path = request_line.split_whitespace().nth(1).unwrap_or("");

    if method == "OPTIONS" {
        write_http_response(&mut stream, 204, "No Content", &cors, "");
        return false;
    }
    if method != "POST" || path != "/auth" {
        write_http_response(&mut stream, 404, "Not Found", &cors, r#"{"ok":false}"#);
        return false;
    }
    if content_length == 0 || content_length > 8192 {
        write_http_response(&mut stream, 400, "Bad Request", &cors, r#"{"ok":false}"#);
        return false;
    }
    let mut body = vec![0u8; content_length];
    if Read::read_exact(&mut reader, &mut body).is_err() {
        write_http_response(&mut stream, 400, "Bad Request", &cors, r#"{"ok":false}"#);
        return false;
    }
    let Ok(parsed) = serde_json::from_slice::<serde_json::Value>(&body) else {
        write_http_response(&mut stream, 400, "Bad Request", &cors, r#"{"ok":false}"#);
        return false;
    };
    let token = parsed
        .get("token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if token.is_empty() {
        write_http_response(&mut stream, 400, "Bad Request", &cors, r#"{"ok":false}"#);
        return false;
    }
    let api_base = parsed
        .get("api_base")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty());
    deliver_auth_payload(
        app,
        DesktopAuthPayload { token, api_base },
    );
    write_http_response(&mut stream, 200, "OK", &cors, r#"{"ok":true}"#);
    true
}

fn start_auth_relay(app: tauri::AppHandle, relay_state: &AuthRelayState) -> Result<u16, String> {
    if let Ok(mut guard) = relay_state.cancel.lock() {
        if let Some(prev) = guard.take() {
            prev.store(true, Ordering::Relaxed);
        }
    }
    let stop = Arc::new(AtomicBool::new(false));
    if let Ok(mut guard) = relay_state.cancel.lock() {
        *guard = Some(stop.clone());
    }

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let app_handle = app.clone();
    thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(300);
        while Instant::now() < deadline && !stop.load(Ordering::Relaxed) {
            if listener.set_nonblocking(true).is_err() {
                break;
            }
            match listener.accept() {
                Ok((stream, _)) => {
                    if handle_relay_connection(stream, &app_handle) {
                        break;
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(80));
                }
                Err(_) => break,
            }
        }
    });
    Ok(port)
}

fn open_connect_in_browser(app: &tauri::AppHandle) {
    use tauri_plugin_opener::OpenerExt;
    let relay_state = app.state::<AuthRelayState>();
    let url = match start_auth_relay(app.clone(), &relay_state) {
        Ok(port) => format!("{CONNECT_URL}?relay_port={port}"),
        Err(_) => CONNECT_URL.to_string(),
    };
    let _ = app.opener().open_url(&url, None::<&str>);
}

#[tauri::command]
fn start_auth_relay_cmd(
    app: tauri::AppHandle,
    relay_state: tauri::State<'_, AuthRelayState>,
) -> Result<u16, String> {
    start_auth_relay(app, &relay_state)
}

/// Toggle the floating orb window visibility.
fn toggle_orb(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

/// Show the orb and ask the frontend to trigger push-to-talk.
fn trigger_speak(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("speak-briefing", ());
    }
}

/// Park the orb in the bottom-right corner of the primary display.
fn position_bottom_right(window: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let screen = monitor.size();
        let win = window
            .outer_size()
            .unwrap_or(tauri::PhysicalSize::new(220, 260));
        let margin: i32 = 28;
        let x = screen.width as i32 - win.width as i32 - margin;
        let y = screen.height as i32 - win.height as i32 - (margin * 3);
        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    }
}

fn wakeword_exe_and_args() -> Option<(String, Vec<String>)> {
    let exe = std::env::var("BRIEFLY_WAKEWORD_EXE").ok()?;
    // Require a trained wake model — the default openWakeWord bundle has no "hey briefly".
    if std::env::var("BRIEFLY_WAKEWORD_MODEL").ok().filter(|v| !v.is_empty()).is_none() {
        return None;
    }
    let args = std::env::var("BRIEFLY_WAKEWORD_ARGS")
        .ok()
        .map(|v| v.split_whitespace().map(|s| s.to_string()).collect())
        .unwrap_or_default();
    Some((exe, args))
}

#[tauri::command]
fn wakeword_start(app: tauri::AppHandle, state: tauri::State<'_, WakewordState>) -> WakewordStartOut {
    if state
        .child
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|_| true))
        .unwrap_or(false)
    {
        return WakewordStartOut {
            active: true,
            mode: "native".into(),
        };
    }
    let Some((exe, args)) = wakeword_exe_and_args() else {
        return WakewordStartOut {
            active: false,
            mode: "fallback".into(),
        };
    };

    let mut cmd = Command::new(exe);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::null());
    let Ok(mut child) = cmd.spawn() else {
        return WakewordStartOut {
            active: false,
            mode: "fallback".into(),
        };
    };
    if let Some(stdout) = child.stdout.take() {
        let app_handle = app.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if line.trim() == "WAKE" {
                    let _ = app_handle.emit("wake-detected", ());
                }
            }
        });
    }
    if let Ok(mut guard) = state.child.lock() {
        *guard = Some(child);
    }
    WakewordStartOut {
        active: true,
        mode: "native".into(),
    }
}

#[tauri::command]
fn wakeword_stop(state: tauri::State<'_, WakewordState>) -> bool {
    let Ok(mut guard) = state.child.lock() else {
        return false;
    };
    let Some(mut child) = guard.take() else {
        return false;
    };
    let _ = child.kill();
    true
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    fn attach_single_instance(b: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
        // Single-instance MUST be the first plugin registered. It keeps exactly one
        // orb alive and forwards a second launch's argv (which carries the
        // briefly:// auth deep link on Windows/Linux) into the running instance.
        b.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            for arg in argv.iter() {
                handle_auth_deep_link(app, arg);
            }
        }))
    }

    #[cfg(not(desktop))]
    fn attach_single_instance(b: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
        b
    }

    attach_single_instance(tauri::Builder::default())
        .manage(WakewordState::default())
        .manage(AuthRelayState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![wakeword_start, wakeword_stop, start_auth_relay_cmd])
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            // Register the briefly:// scheme at runtime so `npm run dev` works
            // without an installer (bundled installs register it at install time).
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                let _ = app.deep_link().register_all();
            }
            // macOS delivers deep links as an event, not argv — handle those here.
            let dl_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    handle_auth_deep_link(&dl_handle, url.as_str());
                }
            });
            // Register to launch on login — production only (avoid dev autostart).
            #[cfg(not(debug_assertions))]
            {
                let _ = app.autolaunch().enable();
            }

            // ── System-tray icon + menu ───────────────────────────────────────
            let speak_i =
                MenuItem::with_id(app, "speak", "Push to talk", true, None::<&str>)?;
            let show_i =
                MenuItem::with_id(app, "show", "Show / hide orb", true, None::<&str>)?;
            let connect_i =
                MenuItem::with_id(app, "connect", "Connect account", true, None::<&str>)?;
            let open_i =
                MenuItem::with_id(app, "open", "Open Briefly in browser", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&speak_i, &show_i, &connect_i, &open_i, &quit_i])?;

            let _tray = TrayIconBuilder::with_id("main")
                .tooltip("Briefly")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "speak" => trigger_speak(app),
                    "show" => toggle_orb(app),
                    "connect" => open_connect_in_browser(app),
                    "open" => {
                        use tauri_plugin_opener::OpenerExt;
                        let _ = app.opener().open_url(DASHBOARD_URL, None::<&str>);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click the tray icon toggles the orb.
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_orb(tray.app_handle());
                    }
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                position_bottom_right(&window);
            }
            // Cold-start deep link: briefly://auth?token=bcap_...&api_base=...
            // (the OS launches the orb with the URL as an argv on first open).
            let app_handle = app.handle().clone();
            for arg in std::env::args() {
                if handle_auth_deep_link(&app_handle, &arg) {
                    break;
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Briefly orb");
}
