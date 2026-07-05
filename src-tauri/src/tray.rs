//! System tray integration — port of v1 `app/tray.ts`.
//!
//! FiveLaunch only uses tray behavior when the user enables minimize-to-tray
//! (mostly during game launch). The tray is created lazily on first use.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

static TRAY_CREATED: AtomicBool = AtomicBool::new(false);

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

/// Create the tray icon + menu once (idempotent).
pub fn ensure_tray(app: &AppHandle) {
    if TRAY_CREATED.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Err(err) = build_tray(app) {
        log::warn!("Failed to create tray icon: {err}");
        TRAY_CREATED.store(false, Ordering::SeqCst);
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show FiveLaunch", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &PredefinedMenuItem::separator(app)?, &quit])?;

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

    builder.build(app)?;
    Ok(())
}
