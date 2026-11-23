use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, File};
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::ptr::null_mut;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::agy_usage::{fetch_agy_usage, AgyUsageReport, UsageBucket, UsageGroup};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const CRED_TYPE_GENERIC: u32 = 1;
const CRED_PERSIST_LOCAL_MACHINE: u32 = 2;

#[repr(C)]
struct CREDENTIALW {
    flags: u32,
    cred_type: u32,
    target_name: *mut u16,
    comment: *mut u16,
    last_written: [u32; 2],
    credential_blob_size: u32,
    credential_blob: *mut u8,
    persist: u32,
    attribute_count: u32,
    attributes: *mut std::ffi::c_void,
    target_alias: *mut u16,
    user_name: *mut u16,
}

#[link(name = "advapi32")]
unsafe extern "system" {
    fn CredReadW(
        target_name: *const u16,
        cred_type: u32,
        flags: u32,
        credential: *mut *mut CREDENTIALW,
    ) -> i32;

    fn CredWriteW(credential: *const CREDENTIALW, flags: u32) -> i32;

    fn CredFree(buffer: *mut std::ffi::c_void);
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModelQuotaInfo {
    pub id: String,
    pub display_name: String,
    pub percentage: f64,
    pub reset_time: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ManagedAccount {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub subscription_tier: String, // "PRO" | "ULTRA" | "FREE"
    pub is_active: bool,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub raw_cred_json: Option<String>,
    pub report: Option<AgyUsageReport>,
    pub manual_models: Vec<ModelQuotaInfo>,
    pub last_synced_ms: u64,
}

fn to_wide_null(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn read_antigravity_credential() -> Option<(String, Value)> {
    let target = to_wide_null("gemini:antigravity");
    let mut cred_ptr: *mut CREDENTIALW = null_mut();

    let success = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut cred_ptr) };
    if success == 0 || cred_ptr.is_null() {
        return None;
    }

    let cred = unsafe { &*cred_ptr };
    let size = cred.credential_blob_size as usize;
    let mut bytes = vec![0u8; size];
    if size > 0 && !cred.credential_blob.is_null() {
        unsafe {
            std::ptr::copy_nonoverlapping(cred.credential_blob, bytes.as_mut_ptr(), size);
        }
    }
    unsafe {
        CredFree(cred_ptr as *mut std::ffi::c_void);
    }

    let raw = String::from_utf8(bytes).ok()?;
    let val = serde_json::from_str::<Value>(&raw).ok()?;
    Some((raw, val))
}

pub fn write_antigravity_credential(raw_json: &str) -> Result<(), String> {
    let mut target = to_wide_null("gemini:antigravity");
    let mut user = to_wide_null("antigravity");
    let mut blob_bytes = raw_json.as_bytes().to_vec();

    let cred = CREDENTIALW {
        flags: 0,
        cred_type: CRED_TYPE_GENERIC,
        target_name: target.as_mut_ptr(),
        comment: null_mut(),
        last_written: [0, 0],
        credential_blob_size: blob_bytes.len() as u32,
        credential_blob: blob_bytes.as_mut_ptr(),
        persist: CRED_PERSIST_LOCAL_MACHINE,
        attribute_count: 0,
        attributes: null_mut(),
        target_alias: null_mut(),
        user_name: user.as_mut_ptr(),
    };

    let success = unsafe { CredWriteW(&cred, 0) };
    if success == 0 {
        return Err("Failed to write credential to Windows Credential Manager.".to_string());
    }
    Ok(())
}

fn get_storage_path() -> PathBuf {
    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    let mut dir = PathBuf::from(app_data);
    dir.push("WindowsAppGroupSidebar");
    let _ = fs::create_dir_all(&dir);
    dir.push("managed_accounts_v2.json");
    dir
}

pub fn load_managed_accounts() -> Vec<ManagedAccount> {
    let path = get_storage_path();
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(list) = serde_json::from_str::<Vec<ManagedAccount>>(&raw) {
            return list;
        }
    }
    Vec::new()
}

pub fn save_managed_accounts(accounts: &[ManagedAccount]) -> Result<(), String> {
    let path = get_storage_path();
    let json = serde_json::to_string_pretty(accounts).map_err(|e| e.to_string())?;
    let mut file = File::create(path).map_err(|e| e.to_string())?;
    file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn parse_quota_response(val: &Value) -> Result<AgyUsageReport, String> {
    let groups_json = val
        .get("groups")
        .and_then(|g| g.as_array())
        .ok_or_else(|| "Missing groups in quota response".to_string())?;

    let mut groups = Vec::new();

    for g in groups_json {
        let name = g
            .get("displayName")
            .or_else(|| g.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("Model Group")
            .to_string();

        let desc = g
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let mut buckets = Vec::new();
        if let Some(arr) = g.get("buckets").and_then(|b| b.as_array()) {
            for b in arr {
                let id = b
                    .get("bucketId")
                    .or_else(|| b.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let b_name = b
                    .get("displayName")
                    .or_else(|| b.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let window = b
                    .get("window")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let b_desc = b
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let fraction = b
                    .get("remainingFraction")
                    .or_else(|| b.get("remaining_fraction"))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);

                let reset_time = b
                    .get("resetTime")
                    .or_else(|| b.get("reset_time"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                buckets.push(UsageBucket {
                    id,
                    name: b_name,
                    window,
                    description: b_desc,
                    remaining_percent: (fraction * 100.0).clamp(0.0, 100.0),
                    reset_time,
                });
            }
        }

        groups.push(UsageGroup {
            name,
            description: desc,
            buckets,
        });
    }

    let summary = val
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    Ok(AgyUsageReport {
        groups,
        summary,
        fetched_at_ms: now_ms,
    })
}

pub fn fetch_quota_with_token(access_token: &str) -> Result<AgyUsageReport, String> {
    let endpoints = [
        "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
        "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
    ];

    let mut last_err = String::new();

    for url in endpoints {
        let mut child = match Command::new("curl.exe")
            .args([
                "-sS",
                "--max-time",
                "12",
                "-X",
                "POST",
                "-H",
                "Content-Type: application/json",
                "-H",
                "User-Agent: antigravity/2.34.0",
                "-K",
                "-",
                "-d",
                "{}",
                url,
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                last_err = format!("Failed to spawn curl: {}", e);
                continue;
            }
        };

        if let Some(mut stdin) = child.stdin.take() {
            let auth_line = format!("header = \"Authorization: Bearer {}\"\n", access_token);
            let _ = stdin.write_all(auth_line.as_bytes());
        }

        let output = match child.wait_with_output() {
            Ok(o) => o,
            Err(e) => {
                last_err = format!("curl execution error: {}", e);
                continue;
            }
        };

        if !output.status.success() {
            last_err = format!(
                "curl failed on {}: {}",
                url,
                String::from_utf8_lossy(&output.stderr).trim()
            );
            continue;
        }

        if let Ok(val) = serde_json::from_slice::<Value>(&output.stdout) {
            if val.get("groups").is_some() {
                return parse_quota_response(&val);
            }
            if let Some(err_obj) = val.get("error") {
                last_err = format!(
                    "API error {}: {}",
                    url,
                    err_obj.get("message").and_then(|m| m.as_str()).unwrap_or("unknown")
                );
                continue;
            }
        }
    }

    Err(if last_err.is_empty() {
        "Failed fetching quota from endpoints".to_string()
    } else {
        last_err
    })
}

/// Refreshes quota for a given managed account.
/// If access_token fails or is missing and account is active, falls back to `agy /usage`.
pub fn sync_account_quota(account: &mut ManagedAccount) {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let mut success = false;

    if let Some(token) = account.access_token.as_deref() {
        if let Ok(report) = fetch_quota_with_token(token) {
            account.report = Some(report);
            account.last_synced_ms = now_ms;
            success = true;
        }
    }

    if !success && account.is_active {
        // Fallback to official local agy CLI
        if let Ok(report) = fetch_agy_usage() {
            account.report = Some(report);
            account.last_synced_ms = now_ms;
        }
    }
}

/// Returns all managed accounts, automatically synchronizing with the active `gemini:antigravity` account.
pub fn get_or_sync_managed_accounts() -> Vec<ManagedAccount> {
    let mut accounts = load_managed_accounts();

    // Check Windows Credential Manager for the current active Antigravity account
    if let Some((raw_json, val)) = read_antigravity_credential() {
        let email = val
            .get("id_token_email")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        let access_token = val
            .get("token")
            .and_then(|t| t.get("access_token"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let refresh_token = val
            .get("token")
            .and_then(|t| t.get("refresh_token"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        if !email.is_empty() {
            let mut found = false;
            for acc in &mut accounts {
                if acc.email.eq_ignore_ascii_case(&email) {
                    acc.is_active = true;
                    if access_token.is_some() {
                        acc.access_token = access_token.clone();
                    }
                    if refresh_token.is_some() {
                        acc.refresh_token = refresh_token.clone();
                    }
                    acc.raw_cred_json = Some(raw_json.clone());
                    found = true;
                } else {
                    acc.is_active = false;
                }
            }

            if !found {
                let mut new_acc = ManagedAccount {
                    id: format!("agy-{}", email.replace('@', "-").replace('.', "-")),
                    email: email.clone(),
                    name: Some("Active Antigravity Account".to_string()),
                    avatar_url: None,
                    subscription_tier: "PRO".to_string(),
                    is_active: true,
                    access_token: access_token.clone(),
                    refresh_token: refresh_token.clone(),
                    raw_cred_json: Some(raw_json),
                    report: None,
                    manual_models: Vec::new(),
                    last_synced_ms: 0,
                };
                sync_account_quota(&mut new_acc);
                accounts.insert(0, new_acc);
            }
        }
    }

    let _ = save_managed_accounts(&accounts);
    accounts
}

pub fn refresh_single_account(account_id: &str) -> Result<ManagedAccount, String> {
    let mut accounts = load_managed_accounts();
    let acc = accounts
        .iter_mut()
        .find(|a| a.id == account_id)
        .ok_or_else(|| format!("Account {} not found", account_id))?;

    sync_account_quota(acc);
    let updated = acc.clone();
    let _ = save_managed_accounts(&accounts);
    Ok(updated)
}

pub fn refresh_all_accounts() -> Result<Vec<ManagedAccount>, String> {
    let mut accounts = get_or_sync_managed_accounts();
    for acc in &mut accounts {
        sync_account_quota(acc);
    }
    let _ = save_managed_accounts(&accounts);
    Ok(accounts)
}

pub fn switch_active_account(account_id: &str) -> Result<Vec<ManagedAccount>, String> {
    let mut accounts = load_managed_accounts();
    let mut target_cred: Option<String> = None;

    for acc in &mut accounts {
        if acc.id == account_id {
            acc.is_active = true;
            target_cred = acc.raw_cred_json.clone();
        } else {
            acc.is_active = false;
        }
    }

    if let Some(cred_json) = target_cred {
        write_antigravity_credential(&cred_json)?;
    }

    let _ = save_managed_accounts(&accounts);
    Ok(accounts)
}

pub fn import_active_antigravity() -> Result<ManagedAccount, String> {
    let accounts = get_or_sync_managed_accounts();
    let active = accounts
        .into_iter()
        .find(|a| a.is_active)
        .ok_or_else(|| "No active Antigravity account found in Windows Credential Manager.".to_string())?;
    Ok(active)
}

pub fn remove_managed_account(account_id: &str) -> Result<Vec<ManagedAccount>, String> {
    let mut accounts = load_managed_accounts();
    accounts.retain(|a| a.id != account_id);
    let _ = save_managed_accounts(&accounts);
    Ok(accounts)
}

pub fn add_or_update_account(account: ManagedAccount) -> Result<Vec<ManagedAccount>, String> {
    let mut accounts = load_managed_accounts();
    let mut found = false;
    for a in &mut accounts {
        if a.id == account.id || a.email.eq_ignore_ascii_case(&account.email) {
            *a = account.clone();
            found = true;
            break;
        }
    }
    if !found {
        accounts.push(account);
    }
    let _ = save_managed_accounts(&accounts);
    Ok(accounts)
}
