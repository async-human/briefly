use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_autostart::{ManagerExt, MacosLauncher};

const DASHBOARD_URL: &str = "https://app.sendbriefly.app/dashboard";

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

/// Show the orb and ask the frontend to speak the briefing.
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            // Register to launch on login — this is the "always on" behaviour.
            // Safe to call every launch; it's a no-op once registered.
            let _ = app.autolaunch().enable();

            // ── System-tray icon + menu ───────────────────────────────────────
            let speak_i =
                MenuItem::with_id(app, "speak", "Speak my briefing", true, None::<&str>)?;
            let show_i =
                MenuItem::with_id(app, "show", "Show / hide orb", true, None::<&str>)?;
            let open_i =
                MenuItem::with_id(app, "open", "Open Briefly in browser", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&speak_i, &show_i, &open_i, &quit_i])?;

            let _tray = TrayIconBuilder::with_id("main")
                .tooltip("Briefly")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "speak" => trigger_speak(app),
                    "show" => toggle_orb(app),
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

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Briefly orb");
}
