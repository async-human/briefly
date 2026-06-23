use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
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

const DASHBOARD_URL: &str = "https://app.sendbriefly.app/dashboard";
const CONNECT_URL: &str = "https://app.sendbriefly.app/desktop/connect";

#[derive(Clone, serde::Serialize)]
struct DesktopAuthPayload {
    token: String,
    api_base: Option<String>,
}

#[derive(Default)]
struct WakewordState {
    child: Mutex<Option<Child>>,
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

/// Parse a `briefly://auth?...` arg and, if valid, hand the token to the orb UI
/// and reveal the window. Returns true if the arg was an auth deep link.
fn handle_auth_deep_link(app: &tauri::AppHandle, arg: &str) -> bool {
    let Some(payload) = parse_auth_deep_link(arg) else {
        return false;
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("desktop-auth", payload);
        let _ = window.show();
        let _ = window.set_focus();
    }
    true
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
    #[cfg(all(desktop, not(debug_assertions)))]
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

    #[cfg(not(all(desktop, not(debug_assertions))))]
    fn attach_single_instance(b: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
        b
    }

    attach_single_instance(tauri::Builder::default())
        .manage(WakewordState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![wakeword_start, wakeword_stop])
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
                    "connect" => {
                        use tauri_plugin_opener::OpenerExt;
                        let _ = app.opener().open_url(CONNECT_URL, None::<&str>);
                    }
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
