use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::UI::Shell::{
    SHAppBarMessage, APPBARDATA, ABM_NEW, ABM_REMOVE, ABM_QUERYPOS, ABM_SETPOS,
    ABE_LEFT, ABE_RIGHT,
};
use std::sync::atomic::{AtomicBool, Ordering};

static IS_REGISTERED_APPBAR: AtomicBool = AtomicBool::new(false);

pub fn register_appbar(hwnd_val: isize, edge: &str, width: i32, height: i32) {
    let hwnd = HWND(hwnd_val as *mut _);
    let is_right = edge.to_lowercase() != "left";
    let abe_edge = if is_right { ABE_RIGHT } else { ABE_LEFT };

    if IS_REGISTERED_APPBAR.load(Ordering::SeqCst) {
        unregister_appbar(hwnd_val);
    }

    let mut abd = APPBARDATA {
        cbSize: std::mem::size_of::<APPBARDATA>() as u32,
        hWnd: hwnd,
        uCallbackMessage: 0,
        uEdge: abe_edge,
        rc: RECT {
            left: 0,
            top: 0,
            right: width,
            bottom: height,
        },
        ..Default::default()
    };

    unsafe {
        SHAppBarMessage(ABM_NEW, &mut abd);
        SHAppBarMessage(ABM_QUERYPOS, &mut abd);
        SHAppBarMessage(ABM_SETPOS, &mut abd);
    }
    IS_REGISTERED_APPBAR.store(true, Ordering::SeqCst);
}

pub fn unregister_appbar(hwnd_val: isize) {
    if IS_REGISTERED_APPBAR.load(Ordering::SeqCst) {
        let hwnd = HWND(hwnd_val as *mut _);
        let mut abd = APPBARDATA {
            cbSize: std::mem::size_of::<APPBARDATA>() as u32,
            hWnd: hwnd,
            ..Default::default()
        };
        unsafe {
            SHAppBarMessage(ABM_REMOVE, &mut abd);
        }
        IS_REGISTERED_APPBAR.store(false, Ordering::SeqCst);
    }
}
