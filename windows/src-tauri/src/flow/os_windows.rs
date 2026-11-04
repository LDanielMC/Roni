// Flow dictation on Windows: the key, through a low-level keyboard hook (it
// only watches, it never swallows a key); the paste, through SendInput; and
// the app in front, from the foreground window's program.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::{
    GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
    VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, EnumWindows, GetForegroundWindow, GetMessageW, GetWindowTextLengthW,
    GetWindowThreadProcessId, IsWindowVisible, PostThreadMessageW, SetWindowsHookExW, TranslateMessage,
    UnhookWindowsHookEx, KBDLLHOOKSTRUCT, LLKHF_INJECTED, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_QUIT,
    WM_SYSKEYDOWN, WM_SYSKEYUP,
};

use super::logic::FlowKey;
use super::KeyEvent;

const VK_ESCAPE: u32 = 0x1B;
const VK_V: u16 = 0x56;
const VK_CONTROL: u16 = 0x11;
const VK_SHIFT_KEY: u16 = 0x10;
const VK_LSHIFT: u32 = 0xA0;
const VK_RSHIFT: u32 = 0xA1;
const VK_LCONTROL: u32 = 0xA2;
const VK_RCONTROL: u32 = 0xA3;
const VK_LMENU: u32 = 0xA4;
const VK_RMENU: u32 = 0xA5;
const VK_LWIN: u32 = 0x5B;
const VK_RWIN: u32 = 0x5C;

/// Modifier keys never count as "another key": AltGr even sends a fake left
/// Ctrl with every right Alt.
fn is_modifier(vk: u32) -> bool {
    matches!(vk, 0x10 | 0x11 | 0x12 | VK_LSHIFT..=VK_RMENU | VK_LWIN | VK_RWIN | 0x14)
}

static SINK: Mutex<Option<Sender<(KeyEvent, Instant)>>> = Mutex::new(None);
static KEY: AtomicU8 = AtomicU8::new(0);
/// For Ctrl + Win: which of the two is down (bit 0 Ctrl, bit 1 Win).
static COMBO: AtomicU8 = AtomicU8::new(0);
static HELD: AtomicU8 = AtomicU8::new(0);
/// The right Shift went down alone and nothing else has been pressed since: a tap, not a shortcut.
static SHIFT_TAP: AtomicBool = AtomicBool::new(false);
/// The right Shift is down (its key repeats are not new presses), and when it went down.
static SHIFT_HELD: AtomicBool = AtomicBool::new(false);
static SHIFT_DOWN_MS: AtomicU64 = AtomicU64::new(0);
/// The other modifiers that are down (a bit each: left/right Ctrl, left/right Alt, left/right Win,
/// left Shift): a right Shift tap with one of them is a shortcut (Alt+Shift changes the keyboard language).
static MODS: AtomicU8 = AtomicU8::new(0);
/// A tap is a quick touch: longer than this it is a key held on purpose.
const TAP_MS: u64 = 400;
/// When the log last said what the hook was given for a Ctrl (milliseconds since 1970).
static LAST_CTRL_NOTE: AtomicU64 = AtomicU64::new(0);

fn key_code(key: FlowKey) -> u8 {
    match key {
        FlowKey::RightCtrl => 0,
        FlowKey::RightAlt => 1,
        FlowKey::RightShift => 2,
        FlowKey::LeftCtrlSuper => 3,
    }
}

/// Whether the event was queued for the dictation thread (false: nobody is listening).
fn send(event: KeyEvent) -> bool {
    match SINK.lock().unwrap().as_ref() {
        Some(tx) => tx.send((event, Instant::now())).is_ok(),
        None => false,
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// The modifiers `MODS` follows, and the bit of each.
const MOD_KEYS: [(u32, u8); 7] = [(VK_LCONTROL, 1), (VK_RCONTROL, 2), (VK_LMENU, 4), (VK_RMENU, 8), (VK_LWIN, 16), (VK_RWIN, 32), (VK_LSHIFT, 64)];

/// Keeps `MODS` up to date.
fn track_modifier(vk: u32, down: bool, up: bool) {
    let Some(&(_, bit)) = MOD_KEYS.iter().find(|(key, _)| *key == vk) else { return };
    if down {
        MODS.fetch_or(bit, Ordering::Relaxed);
    } else if up {
        MODS.fetch_and(!bit, Ordering::Relaxed);
    }
}

/// The hook does not see every release (Ctrl+Alt+Del, Win+L, a permission prompt, a while without
/// keys): before trusting `MODS`, forget the keys Windows says are up.
fn forget_released_modifiers() {
    for (vk, bit) in MOD_KEYS {
        if unsafe { GetAsyncKeyState(vk as i32) } as u16 & 0x8000 == 0 {
            MODS.fetch_and(!bit, Ordering::Relaxed);
        }
    }
}

/// The right Ctrl (or a Ctrl without a side) went down: what the hook was given, once a
/// second at most, written from another thread so the hook is never slowed.
fn note_ctrl(vk: u32, injected: bool) {
    let now = now_ms();
    if now.saturating_sub(LAST_CTRL_NOTE.load(Ordering::Relaxed)) < 1000 {
        return;
    }
    LAST_CTRL_NOTE.store(now, Ordering::Relaxed);
    let _ = std::thread::Builder::new()
        .spawn(move || crate::log::line(format!("flow: hook was given Ctrl vk={vk:#x} injected={injected}")));
}

unsafe extern "system" fn hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        let injected = info.flags.0 & LLKHF_INJECTED.0 != 0;
        if matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN) && matches!(info.vkCode, 0x11 | VK_RCONTROL) {
            note_ctrl(info.vkCode, injected);
        }
        // Our own Ctrl+V, and other programs' synthetic keys, are not the user's.
        if !injected {
            let down = matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
            let up = matches!(wparam.0 as u32, WM_KEYUP | WM_SYSKEYUP);
            on_key(info.vkCode, down, up);
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

fn on_key(vk: u32, down: bool, up: bool) {
    track_modifier(vk, down, up);
    // Any key but the right Shift itself (modifiers too) ends a tap in the making.
    if down && vk != VK_RSHIFT {
        SHIFT_TAP.store(false, Ordering::Relaxed);
    }
    let key = KEY.load(Ordering::Relaxed);
    let ours = match key {
        0 => vk == VK_RCONTROL,
        1 => vk == VK_RMENU,
        2 => vk == VK_RSHIFT,
        _ => false,
    };
    if key == 3 && matches!(vk, VK_LCONTROL | VK_LWIN) {
        let bit = if vk == VK_LCONTROL { 1 } else { 2 };
        let before = COMBO.load(Ordering::Relaxed);
        let after = if down { before | bit } else if up { before & !bit } else { before };
        COMBO.store(after, Ordering::Relaxed);
        if before != 3 && after == 3 {
            send(KeyEvent::Down);
        } else if before == 3 && after != 3 {
            send(KeyEvent::Up);
        } else if after == 3 && down {
            send(KeyEvent::Down); // repeat
        }
        return;
    }
    if ours {
        if down {
            let first = HELD.swap(1, Ordering::Relaxed) == 0;
            let delivered = send(KeyEvent::Down);
            // The first press of each hold only (not the repeats), to see whether a key that
            // "does nothing" reached this hook and whether it was queued for the dictation thread.
            // Written from another thread: a hook that is slow is removed by Windows without a word.
            if first && !cfg!(test) {
                // Builder, not spawn: a panic here would close the app from inside the hook.
                let _ = std::thread::Builder::new()
                    .spawn(move || crate::log::line(format!("flow: hook saw the dictation key go down (queued {delivered})")));
            }
        } else if up {
            HELD.store(0, Ordering::Relaxed);
            send(KeyEvent::Up);
        }
        return;
    }
    // A clean tap on the right Shift pastes a hands-free take (it does nothing outside hands-free):
    // pressed alone (no other modifier down), nothing pressed while it is down, and let go quickly.
    // The repeats of a held Shift are not new presses.
    if vk == VK_RSHIFT {
        if down {
            let first_press = !SHIFT_HELD.swap(true, Ordering::Relaxed);
            // The tests pretend to hold keys that Windows knows nothing about.
            if first_press && !cfg!(test) {
                forget_released_modifiers();
            }
            if first_press && MODS.load(Ordering::Relaxed) == 0 {
                SHIFT_DOWN_MS.store(now_ms(), Ordering::Relaxed);
                SHIFT_TAP.store(true, Ordering::Relaxed);
            }
        } else if up {
            SHIFT_HELD.store(false, Ordering::Relaxed);
            if SHIFT_TAP.swap(false, Ordering::Relaxed) && now_ms().saturating_sub(SHIFT_DOWN_MS.load(Ordering::Relaxed)) < TAP_MS {
                send(KeyEvent::Confirm);
            }
        }
        return;
    }
    if !down {
        return;
    }
    if vk == VK_ESCAPE {
        send(KeyEvent::Escape);
    } else if !is_modifier(vk) {
        send(KeyEvent::Other);
    }
}

/// The hook's thread; it ends when dropped.
pub struct KeyListener {
    thread_id: u32,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Drop for KeyListener {
    fn drop(&mut self) {
        unsafe {
            let _ = PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
        *SINK.lock().unwrap() = None;
    }
}

pub fn listen(key: FlowKey, tx: Sender<(KeyEvent, Instant)>) -> Result<KeyListener, String> {
    KEY.store(key_code(key), Ordering::Relaxed);
    COMBO.store(0, Ordering::Relaxed);
    *SINK.lock().unwrap() = Some(tx);
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<u32, String>>();
    let thread = std::thread::Builder::new()
        .name("roni-flow-keys".into())
        .spawn(move || unsafe {
            let module = GetModuleHandleW(None).ok();
            let handle = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook), module.map(Into::into), 0) {
                Ok(h) => h,
                Err(err) => {
                    let _ = ready_tx.send(Err(err.to_string()));
                    return;
                }
            };
            let _ = ready_tx.send(Ok(GetCurrentThreadId()));
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            let _ = UnhookWindowsHookEx(handle);
        })
        .map_err(|e| e.to_string())?;
    match ready_rx.recv_timeout(Duration::from_secs(3)) {
        Ok(Ok(thread_id)) => {
            Ok(KeyListener { thread_id, thread: Some(thread) })
        }
        Ok(Err(err)) => Err(err),
        Err(_) => Err("the keyboard hook did not start".into()),
    }
}

/// Waits (up to a second) until the dictation key is up, so the paste is a
/// plain Ctrl+V and not Ctrl+Alt+V or Ctrl+Shift+V.
pub fn wait_key_released(key: FlowKey) {
    let vk = match key {
        FlowKey::RightCtrl => VK_RCONTROL,
        FlowKey::RightAlt => VK_RMENU,
        FlowKey::RightShift => VK_RSHIFT,
        FlowKey::LeftCtrlSuper => VK_LWIN,
    } as i32;
    let until = Instant::now() + Duration::from_secs(1);
    while Instant::now() < until {
        let state = unsafe { GetAsyncKeyState(vk) } as u16;
        if state & 0x8000 == 0 {
            return;
        }
        std::thread::sleep(Duration::from_millis(15));
    }
}

fn key_input(vk: u16, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(vk),
                wScan: 0,
                dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

/// Ctrl+V in the app in front. Ctrl+Shift+V for a terminal that wants it.
pub fn send_paste(shift: bool) -> Result<(), String> {
    let mut inputs = vec![key_input(VK_CONTROL, false)];
    if shift {
        inputs.push(key_input(VK_SHIFT_KEY, false));
    }
    inputs.push(key_input(VK_V, false));
    inputs.push(key_input(VK_V, true));
    if shift {
        inputs.push(key_input(VK_SHIFT_KEY, true));
    }
    inputs.push(key_input(VK_CONTROL, true));
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        Ok(())
    } else {
        Err("Windows refused the keystrokes".into())
    }
}

/// A window's program: "outlook", "Outlook".
fn program_of(hwnd: HWND) -> Option<(String, String)> {
    unsafe {
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32));
        if pid == 0 || pid == std::process::id() {
            return None;
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(process);
        if !ok {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        let stem = std::path::Path::new(&path).file_stem()?.to_string_lossy().to_string();
        Some((stem.to_lowercase(), super::display_name(&stem)))
    }
}

/// The app in front: (id, name), None for Coucou itself or the desktop.
pub fn foreground_app() -> Option<(String, String)> {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return None;
    }
    program_of(hwnd)
}

/// Apps with a visible window, for "Add an app" in Styles.
pub fn running_apps() -> Vec<(String, String)> {
    unsafe extern "system" fn each(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
        let list = &mut *(lparam.0 as *mut Vec<(String, String)>);
        if IsWindowVisible(hwnd).as_bool() && GetWindowTextLengthW(hwnd) > 0 {
            if let Some(app) = program_of(hwnd) {
                if !list.iter().any(|(id, _)| *id == app.0) && !super::is_shell(&app.0) {
                    list.push(app);
                }
            }
        }
        windows::core::BOOL(1)
    }
    let mut list: Vec<(String, String)> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(each), LPARAM(&mut list as *mut _ as isize));
    }
    list
}

/// Whether the platform can listen for the key at all.
pub fn keys_supported() -> Result<(), &'static str> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn events(rx: &std::sync::mpsc::Receiver<(KeyEvent, Instant)>) -> Vec<KeyEvent> {
        rx.try_iter().map(|(e, _)| e).collect()
    }

    /// The hook's state is global: the tests take turns.
    static TURN: Mutex<()> = Mutex::new(());

    /// A hook with nothing down, listening on a fresh channel.
    fn fresh() -> (std::sync::MutexGuard<'static, ()>, std::sync::mpsc::Receiver<(KeyEvent, Instant)>) {
        let turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
        let (tx, rx) = std::sync::mpsc::channel();
        *SINK.lock().unwrap() = Some(tx);
        KEY.store(0, Ordering::Relaxed); // the dictation key is the right Ctrl
        MODS.store(0, Ordering::Relaxed);
        SHIFT_TAP.store(false, Ordering::Relaxed);
        SHIFT_HELD.store(false, Ordering::Relaxed);
        HELD.store(0, Ordering::Relaxed);
        (turn, rx)
    }

    #[test]
    fn a_clean_tap_on_the_right_shift_confirms() {
        let (_turn, rx) = fresh();
        on_key(VK_RSHIFT, true, false);
        on_key(VK_RSHIFT, false, true);
        assert_eq!(events(&rx), [KeyEvent::Confirm]);
        *SINK.lock().unwrap() = None;
    }

    #[test]
    fn typing_a_capital_or_holding_the_shift_or_a_shortcut_does_not_confirm() {
        let (_turn, rx) = fresh();
        // A capital letter with the right Shift.
        on_key(VK_RSHIFT, true, false);
        on_key(0x41, true, false);
        on_key(0x41, false, true);
        on_key(VK_RSHIFT, false, true);
        assert_eq!(events(&rx), [KeyEvent::Other]);
        // ...and a key repeat of the Shift after the letter does not arm it again.
        on_key(VK_RSHIFT, true, false);
        on_key(0x41, true, false);
        on_key(VK_RSHIFT, true, false); // the repeat
        on_key(0x41, false, true);
        on_key(VK_RSHIFT, false, true);
        assert_eq!(events(&rx), [KeyEvent::Other]);
        // Held on purpose: not a tap.
        on_key(VK_RSHIFT, true, false);
        SHIFT_DOWN_MS.store(now_ms().saturating_sub(1000), Ordering::Relaxed);
        on_key(VK_RSHIFT, false, true);
        assert_eq!(events(&rx), []);
        // Ctrl, Alt or Win already down (Alt+Shift changes the keyboard language): a shortcut.
        for vk in [VK_LCONTROL, VK_RCONTROL, VK_LMENU, VK_RMENU, VK_LWIN, VK_RWIN, VK_LSHIFT] {
            on_key(vk, true, false);
            on_key(VK_RSHIFT, true, false);
            on_key(VK_RSHIFT, false, true);
            on_key(vk, false, true);
            let got = events(&rx);
            assert!(!got.contains(&KeyEvent::Confirm), "{vk:#x} + right Shift must not confirm: {got:?}");
        }
        // Another modifier pressed while the Shift is down.
        on_key(VK_RSHIFT, true, false);
        on_key(VK_LMENU, true, false);
        on_key(VK_RSHIFT, false, true);
        on_key(VK_LMENU, false, true);
        assert!(!events(&rx).contains(&KeyEvent::Confirm));
        // Everything let go: a tap works again.
        on_key(VK_RSHIFT, true, false);
        on_key(VK_RSHIFT, false, true);
        assert_eq!(events(&rx), [KeyEvent::Confirm]);
        *SINK.lock().unwrap() = None;
    }

    #[test]
    fn when_the_right_shift_is_the_dictation_key_it_dictates_and_does_not_confirm() {
        let (_turn, rx) = fresh();
        KEY.store(2, Ordering::Relaxed);
        on_key(VK_RSHIFT, true, false);
        on_key(VK_RSHIFT, false, true);
        assert_eq!(events(&rx), [KeyEvent::Down, KeyEvent::Up]);
        KEY.store(0, Ordering::Relaxed);
        *SINK.lock().unwrap() = None;
    }
}
