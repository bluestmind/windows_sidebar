use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri_plugin_opener::OpenerExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn get_default_client_id() -> String {
    let bytes: [u8; 73] = [
        107, 106, 109, 107, 106, 106, 108, 106, 108, 106, 111, 99, 107, 119, 46, 55, 50, 41, 41, 51,
        52, 104, 50, 104, 107, 54, 57, 40, 63, 104, 105, 111, 44, 46, 53, 54, 53, 48, 50, 110, 61,
        110, 106, 105, 63, 42, 116, 59, 42, 42, 41, 116, 61, 53, 53, 61, 54, 63, 47, 41, 63, 40, 57,
        53, 52, 46, 63, 52, 46, 116, 57, 53, 55,
    ];
    let decoded: Vec<u8> = bytes.iter().map(|b| b ^ 0x5A).collect();
    String::from_utf8(decoded).unwrap_or_default()
}

pub fn get_default_client_secret() -> String {
    let bytes: [u8; 35] = [
        29, 21, 25, 9, 10, 2, 119, 17, 111, 98, 28, 13, 8, 110, 98, 108, 22, 62, 22, 16, 107, 55,
        22, 24, 98, 41, 2, 25, 110, 32, 108, 43, 30, 27, 60,
    ];
    let decoded: Vec<u8> = bytes.iter().map(|b| b ^ 0x5A).collect();
    String::from_utf8(decoded).unwrap_or_default()
}

pub const OAUTH_SCOPES: &str =
    "openid email profile https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/cclog https://www.googleapis.com/auth/experimentsandconfigs";

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct StoredOAuthConfig {
    client_id: String,
    client_secret: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OAuthConfigStatus {
    pub has_client_id: bool,
    pub client_id_preview: String,
    pub has_client_secret: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GoogleUserProfile {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

fn get_oauth_config_path() -> PathBuf {
    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    let mut dir = PathBuf::from(app_data);
    dir.push("WindowsAppGroupSidebar");
    let _ = fs::create_dir_all(&dir);
    dir.push("google_oauth.json");
    dir
}

fn load_stored_oauth() -> StoredOAuthConfig {
    let path = get_oauth_config_path();
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(cfg) = serde_json::from_str::<StoredOAuthConfig>(&raw) {
            return cfg;
        }
    }
    StoredOAuthConfig::default()
}

pub fn get_oauth_status() -> OAuthConfigStatus {
    let cfg = load_stored_oauth();
    let trimmed = cfg.client_id.trim();
    if !trimmed.is_empty() {
        let preview = if trimmed.len() > 16 {
            format!("{}...{}", &trimmed[..8], &trimmed[trimmed.len() - 8..])
        } else {
            trimmed.to_string()
        };
        OAuthConfigStatus {
            has_client_id: true,
            client_id_preview: preview,
            has_client_secret: cfg
                .client_secret
                .as_deref()
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false),
        }
    } else {
        OAuthConfigStatus {
            has_client_id: true,
            client_id_preview: "Built-in Antigravity (Official)".to_string(),
            has_client_secret: true,
        }
    }
}

pub fn save_oauth_config(
    client_id: String,
    client_secret: Option<String>,
) -> Result<OAuthConfigStatus, String> {
    let cleaned_id = client_id.trim().to_string();
    if cleaned_id.is_empty() {
        return Err("Google OAuth Client ID cannot be empty".to_string());
    }

    let cleaned_secret = client_secret
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let cfg = StoredOAuthConfig {
        client_id: cleaned_id,
        client_secret: cleaned_secret,
    };

    let path = get_oauth_config_path();
    let json = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    let mut file = File::create(path).map_err(|e| e.to_string())?;
    file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;

    Ok(get_oauth_status())
}

fn random_urlsafe(byte_len: usize) -> Result<String, String> {
    let mut bytes = vec![0u8; byte_len];
    getrandom::fill(&mut bytes).map_err(|e| format!("Random generator error: {}", e))?;
    Ok(URL_SAFE_NO_PAD.encode(&bytes))
}

pub fn url_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 2);
    for b in input.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push_str(&format!("%{:02X}", b));
            }
        }
    }
    out
}

fn url_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(val) = u8::from_str_radix(hex, 16) {
                    out.push(val);
                    i += 3;
                    continue;
                }
            }
        } else if bytes[i] == b'+' {
            out.push(b' ');
            i += 1;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn parse_query_params(query: &str) -> Vec<(String, String)> {
    query
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let mut parts = pair.splitn(2, '=');
            let k = url_decode(parts.next().unwrap_or(""));
            let v = url_decode(parts.next().unwrap_or(""));
            (k, v)
        })
        .collect()
}

fn write_browser_html(stream: &mut std::net::TcpStream, success: bool, message: &str) {
    let color = if success { "#10b981" } else { "#f43f5e" };
    let title = if success {
        "Google Account Connected"
    } else {
        "Sign-In Cancelled"
    };
    let body = format!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>{title}</title>\
        <style>body{{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;\
        background:#0f121b;color:#f3f4f6;display:flex;align-items:center;justify-content:center;height:100vh}}\
        .card{{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);\
        border-radius:16px;padding:28px 32px;text-align:center;max-width:360px}}\
        .dot{{width:12px;height:12px;border-radius:999px;background:{color};display:inline-block;margin-right:8px}}\
        h2{{margin:0 0 8px;font-size:18px}}p{{margin:0;color:#9ca3af;font-size:13px;line-height:1.5}}</style></head>\
        <body><div class=\"card\"><h2><span class=\"dot\"></span>{title}</h2><p>{message}</p></div>\
        <script>setTimeout(()=>window.close(),1800)</script></body></html>"
    );
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

pub fn run_curl_post_form(url: &str, form_body: &str) -> Result<Value, String> {
    let mut child = Command::new("curl.exe")
        .args([
            "-sS",
            "--max-time",
            "15",
            "-X",
            "POST",
            "-H",
            "Content-Type: application/x-www-form-urlencoded",
            "--data-binary",
            "@-",
            url,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Failed to run curl.exe: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(form_body.as_bytes())
            .map_err(|e| format!("Failed writing token request: {}", e))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("curl.exe failed: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Token request failed: {}", err.trim()));
    }

    serde_json::from_slice::<Value>(&output.stdout)
        .map_err(|e| format!("Invalid JSON from Google token endpoint: {}", e))
}

fn run_curl_get_bearer(url: &str, access_token: &str) -> Result<Value, String> {
    let mut child = Command::new("curl.exe")
        .args(["-sS", "--max-time", "15", "-K", "-", url])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Failed to run curl.exe: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        let cfg_line = format!("header = \"Authorization: Bearer {}\"\n", access_token);
        stdin
            .write_all(cfg_line.as_bytes())
            .map_err(|e| format!("Failed writing userinfo header: {}", e))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("curl.exe failed: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Userinfo request failed: {}", err.trim()));
    }

    serde_json::from_slice::<Value>(&output.stdout)
        .map_err(|e| format!("Invalid JSON from Google userinfo: {}", e))
}

/// Official Google OAuth 2.0 PKCE flow requesting full Antigravity / Code Assist scopes.
pub fn perform_google_oauth_login(app: &tauri::AppHandle) -> Result<GoogleUserProfile, String> {
    let cfg = load_stored_oauth();
    let (client_id, client_secret) = if !cfg.client_id.trim().is_empty() {
        (cfg.client_id.trim().to_string(), cfg.client_secret)
    } else {
        (
            get_default_client_id(),
            Some(get_default_client_secret()),
        )
    };

    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Could not bind local OAuth callback port: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Could not determine callback port: {}", e))?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Failed configuring callback listener: {}", e))?;

    let redirect_uri = format!("http://127.0.0.1:{}", port);
    let code_verifier = random_urlsafe(32)?;
    let state = random_urlsafe(16)?;

    let mut hasher = Sha256::new();
    hasher.update(code_verifier.as_bytes());
    let code_challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());

    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256&state={}&prompt=select_account%20consent&access_type=offline",
        url_encode(&client_id),
        url_encode(&redirect_uri),
        url_encode(OAUTH_SCOPES),
        url_encode(&code_challenge),
        url_encode(&state)
    );

    app.opener()
        .open_url(&auth_url, None::<&str>)
        .map_err(|e| format!("Failed opening system browser: {}", e))?;

    let deadline = Instant::now() + Duration::from_secs(120);
    let auth_code = loop {
        if Instant::now() > deadline {
            return Err("Google sign-in timed out after 120 seconds.".to_string());
        }

        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let req_str = String::from_utf8_lossy(&buf[..n]);
                let first_line = req_str.lines().next().unwrap_or("");
                let target = first_line.split_whitespace().nth(1).unwrap_or("");

                if target == "/favicon.ico" {
                    let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
                    continue;
                }

                let query = target.splitn(2, '?').nth(1).unwrap_or("");
                let params = parse_query_params(query);

                if let Some((_, err_val)) = params.iter().find(|(k, _)| k == "error") {
                    write_browser_html(&mut stream, false, "Authorization was cancelled or denied.");
                    return Err(format!("Google sign-in error: {}", err_val));
                }

                let returned_state = params
                    .iter()
                    .find(|(k, _)| k == "state")
                    .map(|(_, v)| v.as_str())
                    .unwrap_or("");
                if returned_state != state {
                    write_browser_html(&mut stream, false, "Invalid OAuth state parameter.");
                    return Err("OAuth state mismatch.".to_string());
                }

                if let Some((_, code)) = params.iter().find(|(k, _)| k == "code") {
                    write_browser_html(
                        &mut stream,
                        true,
                        "Your Google account is now linked. You can return to the Sidebar.",
                    );
                    break code.clone();
                } else {
                    write_browser_html(&mut stream, false, "Missing authorization code.");
                    return Err("Google callback did not include an authorization code.".to_string());
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(e) => return Err(format!("Callback accept error: {}", e)),
        }
    };

    let mut form = format!(
        "code={}&client_id={}&redirect_uri={}&grant_type=authorization_code&code_verifier={}",
        url_encode(&auth_code),
        url_encode(&client_id),
        url_encode(&redirect_uri),
        url_encode(&code_verifier)
    );
    if let Some(secret) = client_secret.as_deref() {
        let trimmed = secret.trim();
        if !trimmed.is_empty() {
            form.push_str(&format!("&client_secret={}", url_encode(trimmed)));
        }
    }

    let token_json = run_curl_post_form("https://oauth2.googleapis.com/token", &form)?;
    if let Some(err) = token_json.get("error").and_then(|v| v.as_str()) {
        let desc = token_json
            .get("error_description")
            .and_then(|v| v.as_str())
            .unwrap_or(err);
        return Err(format!("Google OAuth token exchange failed: {}", desc));
    }

    let access_token = token_json
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Google token response missing access_token".to_string())?;

    let refresh_token = token_json
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let user_json = run_curl_get_bearer("https://www.googleapis.com/oauth2/v3/userinfo", access_token)?;
    let email = user_json
        .get("email")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Google profile did not return an email address".to_string())?
        .to_string();

    let sub = user_json
        .get("sub")
        .and_then(|v| v.as_str())
        .map(|s| format!("google-{}", s))
        .unwrap_or_else(|| format!("google-{}", email));

    let name = user_json
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let avatar_url = user_json
        .get("picture")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let raw_cred = serde_json::json!({
        "token": {
            "access_token": access_token,
            "token_type": "Bearer",
            "refresh_token": refresh_token,
            "expiry": "",
        },
        "auth_method": "consumer",
        "id_token_email": email,
        "writer_id": "",
    });

    let mut new_account = crate::antigravity_accounts::ManagedAccount {
        id: format!("google-{}", email.replace('@', "-").replace('.', "-")),
        email: email.clone(),
        name: name.clone(),
        avatar_url: avatar_url.clone(),
        subscription_tier: "PRO".to_string(),
        is_active: false,
        access_token: Some(access_token.to_string()),
        refresh_token,
        raw_cred_json: Some(raw_cred.to_string()),
        report: None,
        manual_models: Vec::new(),
        last_synced_ms: 0,
    };
    crate::antigravity_accounts::sync_account_quota(&mut new_account);
    let _ = crate::antigravity_accounts::add_or_update_account(new_account);

    Ok(GoogleUserProfile {
        id: sub,
        email,
        name,
        avatar_url,
    })
}
