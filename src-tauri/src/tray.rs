//! System tray integration — port of v1 `app/tray.ts` + play-session status.
//!
//! FiveLaunch only uses tray behavior when the user enables minimize-to-tray
//! (mostly during game launch). The tray is created lazily on first use. The
//! context menu carries a live status line ("Playing <client> — N min"),
//! updated by the restore-on-game-exit watcher.

use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

const IDLE_STATUS: &str = "Not playing";

static TRAY: Mutex<Option<(TrayIcon<Wry>, MenuItem<Wry>)>> = Mutex::new(None);

pub fn restore_from_tray(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_skip_taskbar(false);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn minimize_to_tray(app: &AppHandle) {
    ensure_tray(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
        let _ = window.set_skip_taskbar(true);
    }
}

/// Update the status line shown in the tray menu + tooltip.
/// `None` resets to the idle text.
pub fn set_tray_status(text: Option<&str>) {
    if let Ok(guard) = TRAY.lock() {
        if let Some((tray, status_item)) = guard.as_ref() {
            let line = text.unwrap_or(IDLE_STATUS);
            let _ = status_item.set_text(line);
            let tooltip = match text {
                Some(t) => format!("FiveLaunch — {t}"),
                None => "FiveLaunch".to_string(),
            };
            let _ = tray.set_tooltip(Some(tooltip));
        }
    }
}

/// Create the tray icon + menu once (idempotent).
pub fn ensure_tray(app: &AppHandle) {
    if let Ok(guard) = TRAY.lock() {
        if guard.is_some() {
            return;
        }
    }
    if let Err(err) = build_tray(app) {
        log::warn!("Failed to create tray icon: {err}");
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    // Disabled status line at the top of the menu.
    let status = MenuItem::with_id(app, "status", IDLE_STATUS, false, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show FiveLaunch", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &status,
            &PredefinedMenuItem::separator(app)?,
            &show,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("FiveLaunch")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => restore_from_tray(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                restore_from_tray(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    let tray = builder.build(app)?;
    if let Ok(mut guard) = TRAY.lock() {
        *guard = Some((tray, status));
    }
    Ok(())
}
