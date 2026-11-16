use std::io::Cursor;
use base64::Engine;
use base64::prelude::BASE64_STANDARD;
use image::{ImageBuffer, Rgba};
use windows::core::{PCWSTR, Interface};
use windows::Win32::Foundation::HWND;
use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
use windows::Win32::UI::Shell::{
    SHGetFileInfoW, ShellExecuteExW, IShellLinkW, ShellLink,
    SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHELLEXECUTEINFOW,
    SEE_MASK_NOCLOSEPROCESS,
};
use windows::Win32::System::Com::IPersistFile;
use windows::Win32::UI::WindowsAndMessaging::{
    GetIconInfo, DestroyIcon, ICONINFO, SW_SHOW,
};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW,
    BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HDC, HGDIOBJ,
};
use windows::Win32::System::Com::{
    CoInitializeEx, CoCreateInstance, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM,
};

/// Resolve .lnk shortcut to actual target path, arguments, and working directory
pub fn resolve_shortcut(path: &str) -> (String, Option<String>, Option<String>) {
    if !path.to_lowercase().ends_with(".lnk") {
        return (path.to_string(), None, None);
    }

    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        if let Ok(shell_link) = CoCreateInstance::<_, IShellLinkW>(&ShellLink, None, CLSCTX_INPROC_SERVER) {
            if let Ok(persist_file) = shell_link.cast::<IPersistFile>() {
                let wide_path: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
                if persist_file.Load(PCWSTR(wide_path.as_ptr()), STGM(0)).is_ok() {
                    let mut target_buf = [0u16; 1024];
                    let mut args_buf = [0u16; 1024];
                    let mut dir_buf = [0u16; 1024];

                    let _ = shell_link.GetPath(&mut target_buf, std::ptr::null_mut(), 0);
                    let _ = shell_link.GetArguments(&mut args_buf);
                    let _ = shell_link.GetWorkingDirectory(&mut dir_buf);

                    let target = String::from_utf16_lossy(&target_buf)
                        .trim_matches(char::from(0))
                        .to_string();
                    let args = String::from_utf16_lossy(&args_buf)
                        .trim_matches(char::from(0))
                        .to_string();
                    let dir = String::from_utf16_lossy(&dir_buf)
                        .trim_matches(char::from(0))
                        .to_string();

                    let real_target = if target.is_empty() { path.to_string() } else { target };
                    let real_args = if args.is_empty() { None } else { Some(args) };
                    let real_dir = if dir.is_empty() { None } else { Some(dir) };

                    return (real_target, real_args, real_dir);
                }
            }
        }
    }

    (path.to_string(), None, None)
}

/// Extract real Windows shell icon as base64 PNG data URI
pub fn extract_icon_base64(path: &str) -> Option<String> {
    unsafe {
        let wide_path: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
        let mut shfi = SHFILEINFOW::default();

        let res = SHGetFileInfoW(
            PCWSTR(wide_path.as_ptr()),
            FILE_FLAGS_AND_ATTRIBUTES(0),
            Some(&mut shfi),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        );

        if res == 0 || shfi.hIcon.is_invalid() {
            return None;
        }

        let h_icon = shfi.hIcon;
        let mut icon_info = ICONINFO::default();
        if GetIconInfo(h_icon, &mut icon_info).is_err() {
            let _ = DestroyIcon(h_icon);
            return None;
        }

        let hbm_color = icon_info.hbmColor;
        let hbm_mask = icon_info.hbmMask;

        let mut bm = BITMAP::default();
        if GetObjectW(
            HGDIOBJ(hbm_color.0),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bm as *mut _ as *mut _),
        ) == 0 {
            let _ = DeleteObject(HGDIOBJ(hbm_color.0));
            let _ = DeleteObject(HGDIOBJ(hbm_mask.0));
            let _ = DestroyIcon(h_icon);
            return None;
        }

        let width = bm.bmWidth as u32;
        let height = bm.bmHeight as u32;

        let hdc: HDC = CreateCompatibleDC(None);
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32), // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut raw_pixels = vec![0u8; (width * height * 4) as usize];
        let lines = GetDIBits(
            hdc,
            hbm_color,
            0,
            height,
            Some(raw_pixels.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        let _ = DeleteDC(hdc);
        let _ = DeleteObject(HGDIOBJ(hbm_color.0));
        let _ = DeleteObject(HGDIOBJ(hbm_mask.0));
        let _ = DestroyIcon(h_icon);

        if lines == 0 {
            return None;
        }

        // Convert BGRA to RGBA and verify alpha
        let mut has_non_zero_alpha = false;
        for chunk in raw_pixels.chunks_exact_mut(4) {
            let b = chunk[0];
            let r = chunk[2];
            let a = chunk[3];
            chunk[0] = r;
            chunk[2] = b;
            if a > 0 {
                has_non_zero_alpha = true;
            }
        }

        // If alpha is all zeros, set to opaque 255
        if !has_non_zero_alpha {
            for chunk in raw_pixels.chunks_exact_mut(4) {
                chunk[3] = 255;
            }
        }

        let img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_raw(width, height, raw_pixels)?;
        let mut png_bytes = Vec::new();
        img.write_to(&mut Cursor::new(&mut png_bytes), image::ImageFormat::Png).ok()?;

        let encoded = BASE64_STANDARD.encode(&png_bytes);
        Some(format!("data:image/png;base64,{}", encoded))
    }
}

/// Launch application with normal or elevated privileges
pub fn launch_target(path: &str, args: Option<&str>, run_as_admin: bool) -> Result<(), String> {
    unsafe {
        let verb_str = if run_as_admin { "runas" } else { "open" };
        let wide_verb: Vec<u16> = verb_str.encode_utf16().chain(Some(0)).collect();
        let wide_file: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
        let wide_args: Option<Vec<u16>> = args.map(|a| a.encode_utf16().chain(Some(0)).collect());

        let mut sei = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOCLOSEPROCESS,
            hwnd: HWND::default(),
            lpVerb: PCWSTR(wide_verb.as_ptr()),
            lpFile: PCWSTR(wide_file.as_ptr()),
            lpParameters: match &wide_args {
                Some(a) => PCWSTR(a.as_ptr()),
                None => PCWSTR::null(),
            },
            nShow: SW_SHOW.0 as i32,
            ..Default::default()
        };

        if ShellExecuteExW(&mut sei).is_err() {
            return Err("Failed to launch application with ShellExecute".to_string());
        }

        Ok(())
    }
}

/// Open containing directory and select the item in Windows Explorer
pub fn open_folder_and_select(path: &str) -> Result<(), String> {
    let arg = format!("/select,\"{}\"", path);
    std::process::Command::new("explorer.exe")
        .arg(arg)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
