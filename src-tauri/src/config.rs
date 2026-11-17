use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub icon_base64: Option<String>,
    pub args: Option<String>,
    pub category_id: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppGroup {
    pub id: String,
    pub name: String,
    pub color: String,
    pub is_collapsed: bool,
    pub items: Vec<AppItem>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SidebarSettings {
    pub dock_edge: String, // "right" | "left"
    pub width: u32,
    pub is_appbar: bool,   // reserve desktop screen space
    pub always_on_top: bool,
    pub auto_hide: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppConfig {
    pub settings: SidebarSettings,
    pub groups: Vec<AppGroup>,
}

pub fn get_config_path() -> PathBuf {
    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    let mut dir = PathBuf::from(app_data);
    dir.push("WindowsAppGroupSidebar");
    let _ = fs::create_dir_all(&dir);
    dir.push("config.json");
    dir
}

pub fn get_default_config() -> AppConfig {
    let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".to_string());
    let notepad_path = format!("{}\\System32\\notepad.exe", windir);
    let cmd_path = format!("{}\\System32\\cmd.exe", windir);
    let explorer_path = format!("{}\\explorer.exe", windir);
    let calc_path = format!("{}\\System32\\calc.exe", windir);

    let notepad_icon = crate::shell_utils::extract_icon_base64(&notepad_path);
    let cmd_icon = crate::shell_utils::extract_icon_base64(&cmd_path);
    let explorer_icon = crate::shell_utils::extract_icon_base64(&explorer_path);
    let calc_icon = crate::shell_utils::extract_icon_base64(&calc_path);

    let mut utilities_items = Vec::new();
    utilities_items.push(AppItem {
        id: "notepad-1".to_string(),
        name: "Notepad".to_string(),
        path: notepad_path,
        icon_base64: notepad_icon,
        args: None,
        category_id: "group-utils".to_string(),
    });
    utilities_items.push(AppItem {
        id: "cmd-1".to_string(),
        name: "Command Prompt".to_string(),
        path: cmd_path,
        icon_base64: cmd_icon,
        args: None,
        category_id: "group-utils".to_string(),
    });
    utilities_items.push(AppItem {
        id: "explorer-1".to_string(),
        name: "File Explorer".to_string(),
        path: explorer_path,
        icon_base64: explorer_icon,
        args: None,
        category_id: "group-utils".to_string(),
    });
    utilities_items.push(AppItem {
        id: "calc-1".to_string(),
        name: "Calculator".to_string(),
        path: calc_path,
        icon_base64: calc_icon,
        args: None,
        category_id: "group-utils".to_string(),
    });

    AppConfig {
        settings: SidebarSettings {
            dock_edge: "right".to_string(),
            width: 260,
            is_appbar: false,
            always_on_top: false,
            auto_hide: false,
        },
        groups: vec![
            AppGroup {
                id: "group-favorites".to_string(),
                name: "⭐ Favorites".to_string(),
                color: "#f59e0b".to_string(),
                is_collapsed: false,
                items: vec![],
            },
            AppGroup {
                id: "group-utils".to_string(),
                name: "🛠️ System Utilities".to_string(),
                color: "#3b82f6".to_string(),
                is_collapsed: false,
                items: utilities_items,
            },
            AppGroup {
                id: "group-work".to_string(),
                name: "💼 Productivity & Dev".to_string(),
                color: "#10b981".to_string(),
                is_collapsed: false,
                items: vec![],
            },
        ],
    }
}

pub fn load_config() -> AppConfig {
    let path = get_config_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                return config;
            }
        }
    }

    let default = get_default_config();
    let _ = save_config(&default);
    default
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = get_config_path();
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    let mut file = File::create(path).map_err(|e| e.to_string())?;
    file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}
