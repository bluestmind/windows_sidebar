mod appbar;
mod config;
mod shell_utils;

use config::{AppConfig, AppItem};
use tauri::Manager;
use std::path::Path;

pub fn apply_docking(window: &tauri::WebviewWindow, edge: &str, width: u32, is_appbar: bool) {
    println!("[Sidebar] Applying docking: edge={}, width={}, appbar={}", edge, width, is_appbar);

    // 1. Get Windows Work Area (excluding taskbar)
    let mut work_area = windows::Win32::Foundation::RECT::default();
    unsafe {
        let _ = windows::Win32::UI::WindowsAndMessaging::SystemParametersInfoW(
            windows::Win32::UI::WindowsAndMessaging::SPI_GETWORKAREA,
            0,
            Some(&mut work_area as *mut _ as _),
            windows::Win32::UI::WindowsAndMessaging::SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        );
    }

    let work_left = work_area.left;
    let work_top = work_area.top;
    let work_right = work_area.right;
    let work_bottom = work_area.bottom;
    let work_h = (work_bottom - work_top).max(600) as u32;

    println!("[Sidebar] WorkArea: [{}, {}, {}, {}] (h={})", work_left, work_top, work_right, work_bottom, work_h);

    let phys_width = width.clamp(200, 700);
    let phys_x = if edge.to_lowercase() == "left" {
        work_left
    } else {
        work_right.saturating_sub(phys_width as i32)
    };
    let phys_y = work_top;
    let phys_height = work_h;

    println!("[Sidebar] Setting window pos: x={}, y={}, width={}, height={}", phys_x, phys_y, phys_width, phys_height);

    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
        width: phys_width,
        height: phys_height,
    }));
    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
        x: phys_x,
        y: phys_y,
    }));
    let _ = window.set_always_on_top(true);
    let _ = window.show();
    let _ = window.set_focus();

    // 2. Apply authentic macOS Vibrancy / Windows Blur (Flicker-Free)
    #[cfg(target_os = "windows")]
    {
        let _ = window_vibrancy::apply_blur(window, Some((20, 22, 34, 180)))
            .or_else(|_| window_vibrancy::apply_acrylic(window, Some((20, 22, 34, 180))));
    }

    if let Ok(hwnd) = window.hwnd() {
        if is_appbar {
            appbar::register_appbar(hwnd.0 as isize, edge, phys_width as i32, phys_height as i32);
        } else {
            appbar::unregister_appbar(hwnd.0 as isize);
        }
    }
}

#[tauri::command]
fn get_config() -> Result<AppConfig, String> {
    Ok(config::load_config())
}

#[tauri::command]
fn save_config(config: AppConfig) -> Result<(), String> {
    config::save_config(&config)
}

#[tauri::command]
fn pick_app_file(category_id: String) -> Result<Option<AppItem>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("Executables & Shortcuts", &["exe", "lnk", "bat", "cmd"])
        .pick_file();

    if let Some(p) = file {
        let path_str = p.to_string_lossy().to_string();
        let name = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "App".to_string());
        let (real_target, args, _) = shell_utils::resolve_shortcut(&path_str);
        let icon_base64 = shell_utils::extract_icon_base64(&path_str)
            .or_else(|| shell_utils::extract_icon_base64(&real_target));

        let id = format!("item-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());

        Ok(Some(AppItem {
            id,
            name,
            path: path_str,
            icon_base64,
            args,
            category_id,
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn resolve_and_add_path(path: String, category_id: String) -> Result<AppItem, String> {
    let p = Path::new(&path);
    let name = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "App".to_string());
    let (real_target, args, _) = shell_utils::resolve_shortcut(&path);
    let icon_base64 = shell_utils::extract_icon_base64(&path)
        .or_else(|| shell_utils::extract_icon_base64(&real_target));

    let id = format!("item-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());

    Ok(AppItem {
        id,
        name,
        path,
        icon_base64,
        args,
        category_id,
    })
}

#[tauri::command]
fn launch_app(path: String, args: Option<String>, run_as_admin: bool) -> Result<(), String> {
    shell_utils::launch_target(&path, args.as_deref(), run_as_admin)
}

#[tauri::command]
fn open_in_folder(path: String) -> Result<(), String> {
    shell_utils::open_folder_and_select(&path)
}

#[tauri::command]
fn dock_window(app: tauri::AppHandle, edge: String, width: u32, is_appbar: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        apply_docking(&window, &edge, width, is_appbar);
        return Ok(());
    }
    Err("Could not retrieve window handle".to_string())
}

#[tauri::command]
fn close_sidebar(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(hwnd) = window.hwnd() {
            appbar::unregister_appbar(hwnd.0 as isize);
        }
    }
    app.cleanup_before_exit();
    std::process::exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| {
            println!("[Sidebar] App setup complete");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            pick_app_file,
            resolve_and_add_path,
            launch_app,
            open_in_folder,
            dock_window,
            close_sidebar
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
