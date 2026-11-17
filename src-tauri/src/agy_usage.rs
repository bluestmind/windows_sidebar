use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Read;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UsageBucket {
    pub id: String,
    pub name: String,
    pub window: String,
    pub description: String,
    pub remaining_percent: f64,
    pub reset_time: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UsageGroup {
    pub name: String,
    pub description: String,
    pub buckets: Vec<UsageBucket>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AgyUsageReport {
    pub groups: Vec<UsageGroup>,
    pub summary: String,
    pub fetched_at_ms: u64,
}

/// Locate the official Antigravity CLI (`agy`) binary.
fn find_agy_exe() -> Option<PathBuf> {
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let p = PathBuf::from(local).join("agy").join("bin").join("agy.exe");
        if p.exists() {
            return Some(p);
        }
    }
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let p = dir.join("agy.exe");
            if p.exists() {
                return Some(p);
            }
        }
    }
    None
}

fn str_field(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string()
}

fn parse_report(root: &Value) -> Result<AgyUsageReport, String> {
    if let Some(status) = root.get("status").and_then(|s| s.as_str()) {
        if status != "SUCCESS" {
            let msg = root
                .get("response")
                .and_then(|r| r.as_str())
                .unwrap_or(status);
            return Err(format!("Antigravity CLI returned {}: {}", status, msg.trim()));
        }
    }

    let data = root
        .get("command")
        .and_then(|c| c.get("data"))
        .ok_or_else(|| {
            "Antigravity CLI did not return usage data. Make sure you are signed in (run `agy` once)."
                .to_string()
        })?;

    let groups_json = data
        .get("groups")
        .and_then(|g| g.as_array())
        .cloned()
        .unwrap_or_default();

    let groups = groups_json
        .iter()
        .map(|g| {
            let buckets = g
                .get("buckets")
                .and_then(|b| b.as_array())
                .map(|arr| {
                    arr.iter()
                        .map(|b| {
                            let frac = b
                                .get("remaining_fraction")
                                .and_then(|f| f.as_f64())
                                .unwrap_or(0.0);
                            let reset = str_field(b, "reset_time");
                            UsageBucket {
                                id: str_field(b, "id"),
                                name: str_field(b, "name"),
                                window: str_field(b, "window"),
                                description: str_field(b, "description"),
                                remaining_percent: (frac * 100.0).clamp(0.0, 100.0),
                                reset_time: if reset.is_empty() { None } else { Some(reset) },
                            }
                        })
                        .collect()
                })
                .unwrap_or_default();

            UsageGroup {
                name: str_field(g, "name"),
                description: str_field(g, "description"),
                buckets,
            }
        })
        .collect::<Vec<_>>();

    if groups.is_empty() {
        return Err("Antigravity CLI returned no quota groups.".to_string());
    }

    let fetched_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    Ok(AgyUsageReport {
        groups,
        summary: str_field(data, "description"),
        fetched_at_ms,
    })
}

/// Runs the official `agy -p "/usage" --output-format json` command
/// (slash command only: no model turn, no conversation created) and parses the result.
pub fn fetch_agy_usage() -> Result<AgyUsageReport, String> {
    let exe = find_agy_exe().ok_or_else(|| {
        "Antigravity CLI (agy) not found. Install it from antigravity.google and sign in once."
            .to_string()
    })?;

    let mut child = Command::new(&exe)
        .args([
            "-p",
            "/usage",
            "--output-format",
            "json",
            "--print-timeout",
            "45s",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Failed to start agy: {}", e))?;

    // Hard deadline so a hung CLI never blocks the sidebar.
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if Instant::now() > deadline {
                    let _ = child.kill();
                    return Err("Antigravity CLI timed out while fetching usage.".to_string());
                }
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(e) => return Err(format!("Failed waiting for agy: {}", e)),
        }
    }

    let mut stdout = String::new();
    if let Some(mut out) = child.stdout.take() {
        let _ = out.read_to_string(&mut stdout);
    }
    let mut stderr = String::new();
    if let Some(mut err) = child.stderr.take() {
        let _ = err.read_to_string(&mut stderr);
    }

    // The JSON object is the last non-empty line that parses.
    let parsed = stdout
        .lines()
        .rev()
        .map(|l| l.trim())
        .filter(|l| l.starts_with('{'))
        .find_map(|l| serde_json::from_str::<Value>(l).ok())
        .ok_or_else(|| {
            let detail = if !stderr.trim().is_empty() {
                stderr.trim().to_string()
            } else {
                stdout.trim().chars().take(300).collect()
            };
            format!("Could not parse agy usage output: {}", detail)
        })?;

    parse_report(&parsed)
}
