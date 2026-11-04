// Flow dictation: hold a key anywhere, speak, let go, and the words are pasted
// where you type. Port of FlowDictation.swift for Windows and Linux.
//
// One thread owns the dictation: the key's events come in from the OS listener
// (os_windows.rs / os_linux.rs) and the pill's buttons, KeyLogic turns them
// into start / lock / finish / cancel, the microphone is opened on the first
// press, and when you let go the words go to Parakeet on this computer, then
// through the dictionary, the snippets and (if turned on) Claude's clean-up,
// and are pasted. The thread sleeps on its channel while nothing happens.

pub mod cleanup;
pub mod logic;
pub mod paste;
pub mod pill;
pub mod store;
pub mod text;

#[cfg(windows)]
#[path = "os_windows.rs"]
pub mod os;
#[cfg(target_os = "linux")]
#[path = "os_linux.rs"]
pub mod os;
#[cfg(target_os = "linux")]
pub mod wayland;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::i18n::t;
use crate::speech::{self, audio};
use logic::{Action, KeyLogic};
use store::{AppStyle, Entry, Prefs, Store, Words};
use text::Snippet;

/// What reaches the dictation thread.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyEvent {
    Down,
    Up,
    /// Another key while the dictation key is held: a shortcut.
    Other,
    Escape,
    /// The pill's microphone: hands-free straight away.
    HandsFree,
    /// The pill's âœ“: paste now.
    Finish,
    /// The pill's âœ•.
    Cancel,
    /// The chat's text field saw the dictation key go down / up: a second pair of eyes for
    /// when the global key watcher hears nothing. Dropped when the watcher reported the same press.
    ChatDown,
    ChatUp,
    Quit,
}

pub struct Flow {
    pub store: Mutex<Store>,
    running: Mutex<Option<Running>>,
}

struct Running {
    tx: Sender<(KeyEvent, Instant)>,
    /// The OS's key listener (or, on Wayland, the portal's shortcut); dropping it stops it.
    _listener: Option<Box<dyn std::any::Any + Send>>,
}

impl Flow {
    fn send(&self, event: KeyEvent) {
        if let Some(r) = self.running.lock().unwrap().as_ref() {
            let _ = r.tx.send((event, Instant::now()));
        }
    }
}

pub fn get(app: &AppHandle) -> Option<Arc<Flow>> {
    app.try_state::<Arc<Flow>>().map(|s| s.inner().clone())
}

/// A program's name as people know it: "outlook" â†’ "Outlook".
pub fn display_name(stem: &str) -> String {
    let id = stem.to_lowercase();
    if let Some(s) = store::default_app_styles().into_iter().find(|s| s.id == id) {
        return s.name;
    }
    let mut chars = stem.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// Parts of the desktop itself, never a place to dictate into.
pub fn is_shell(id: &str) -> bool {
    matches!(
        id,
        "explorer" | "applicationframehost" | "textinputhost" | "shellexperiencehost" | "searchhost"
            | "startmenuexperiencehost" | "lockapp" | "roni" | "gnome-shell" | "plasmashell" | "xfdesktop"
    )
}

fn is_terminal(id: &str) -> bool {
    #[cfg(target_os = "linux")]
    {
        os::is_terminal(id)
    }
    #[cfg(windows)]
    {
        // Windows Terminal, conhost and the rest paste with Ctrl+V.
        let _ = id;
        false
    }
}

// â”€â”€ The island's chat â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// When the chat's text field has the keyboard, what you dictate goes into the
// field as text, straight from here: no clipboard, no Ctrl+V sent to whichever
// window Windows thinks is in front. The field reports its focus (`chat_input_focus`).

static CHAT_FOCUS: AtomicBool = AtomicBool::new(false);

pub fn chat_focused() -> bool {
    CHAT_FOCUS.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn chat_input_focus(focused: bool) {
    CHAT_FOCUS.store(focused, Ordering::Relaxed);
}

/// What the chat's microphone button shows: the phase of the dictation and whether it is on.
#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DictationState {
    pub phase: String,
    pub enabled: bool,
    /// The dictation key as the pages write it ("right_ctrl"â€¦), so the chat's field can watch for it too.
    pub key: String,
}

#[tauri::command]
pub fn dictation_state(app: AppHandle) -> DictationState {
    let s = pill::get(&app).map(|p| p.state()).unwrap_or_default();
    DictationState { phase: if s.phase.is_empty() { "idle".into() } else { s.phase }, enabled: s.enabled, key: s.key }
}

/// Hands the words to the chat's text field, and says whether it could. Only when
/// the island is the window with the keyboard too: the field's own report can be
/// stale (a page reloaded with the field focused), and a dictation meant for
/// Notepad or the big window must never land in the island instead.
fn deliver_to_chat(app: &AppHandle, text: &str) -> bool {
    let Some(island) = crate::island::window(app) else { return false };
    crate::platform::is_foreground(&island) && app.emit_to(crate::island::WINDOW_LABEL, "flow-text", text).is_ok()
}

// â”€â”€ Setup, on and off â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

pub fn setup(app: &AppHandle) {
    let flow = Arc::new(Flow { store: Mutex::new(Store::load()), running: Mutex::new(None) });
    app.manage(flow.clone());
    pill::setup(app);
    let prefs = flow.store.lock().unwrap().prefs.clone();
    pill::update(app, |s| {
        s.edge = pill::edge_name(prefs.edge).into();
        s.key = key_id(prefs.key);
    });
    if prefs.enabled {
        enable(app, &flow);
    }
    crate::voice::sync(app);
}

/// The key as the pages write it ("right_ctrl"â€¦), or "wayland" where the
/// desktop holds the shortcut.
fn key_id(key: logic::FlowKey) -> String {
    if os::keys_supported() == Err("wayland") {
        return "wayland".into();
    }
    serde_json::to_value(key).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default()
}

fn enable(app: &AppHandle, flow: &Arc<Flow>) {
    let mut running = flow.running.lock().unwrap();
    if running.is_some() {
        return;
    }
    let prefs = flow.store.lock().unwrap().prefs.clone();
    let (tx, rx) = mpsc::channel::<(KeyEvent, Instant)>();
    let listener: Option<Box<dyn std::any::Any + Send>> = match os::keys_supported() {
        Ok(()) => match os::listen(prefs.key, tx.clone()) {
            Ok(l) => Some(Box::new(l)),
            Err(err) => {
                crate::log::line(format!("flow: the key can't be watched: {err}"));
                None
            }
        },
        #[cfg(target_os = "linux")]
        Err("wayland") => wayland::listen(tx.clone()).map(|h| Box::new(h) as Box<dyn std::any::Any + Send>),
        Err(why) => {
            crate::log::line(format!("flow: no key on this desktop ({why}); the pill's buttons still work"));
            None
        }
    };
    let app2 = app.clone();
    let flow2 = flow.clone();
    std::thread::Builder::new()
        .name("roni-flow".into())
        .spawn(move || run(app2, flow2, rx))
        .ok();
    *running = Some(Running { tx, _listener: listener });
    drop(running);
    speech::preload();
    pill::update(app, |s| s.enabled = true);
    crate::log::line(format!("flow dictation on ({})", prefs.key.label()));
}

fn disable(app: &AppHandle, flow: &Arc<Flow>) {
    let running = flow.running.lock().unwrap().take();
    if let Some(r) = running {
        let _ = r.tx.send((KeyEvent::Quit, Instant::now()));
    }
    pill::update(app, |s| {
        s.enabled = false;
        s.phase = "idle".into();
    });
    if !crate::notes::is_recording(app) && !crate::voice::is_listening() {
        speech::unload();
    }
}

// â”€â”€ The dictation thread â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

struct Listening {
    capture: audio::Capture,
    take: Arc<Mutex<audio::Take>>,
    started: Instant,
    app: Option<(String, String)>,
}

fn run(app: AppHandle, flow: Arc<Flow>, rx: mpsc::Receiver<(KeyEvent, Instant)>) {
    let epoch = Instant::now();
    let secs = |at: Instant| at.saturating_duration_since(epoch).as_secs_f64();
    let mut logic = KeyLogic::default();
    let mut listening: Option<Listening> = None;
    let busy = Arc::new(AtomicBool::new(false));
    let mut ignored_logged: Option<Instant> = None;
    let mut key_held = false;
    // The dictation key reaches this thread from two eyes: the global watcher and the chat's field.
    let mut sources = KeySources::default();
    loop {
        let active = listening.is_some() || logic.is_active();
        let received = if active {
            match rx.recv_timeout(Duration::from_millis(33)) {
                Ok(m) => Some(m),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => break,
            }
        } else {
            match rx.recv() {
                Ok(m) => Some(m),
                Err(_) => break,
            }
        };
        let action = match received {
            Some((KeyEvent::Quit, _)) => {
                drop(listening.take());
                break;
            }
            Some((ev @ (KeyEvent::Down | KeyEvent::Up | KeyEvent::ChatDown | KeyEvent::ChatUp), at)) => {
                sources.key_action(&mut logic, ev, at, secs(at))
            }
            Some((KeyEvent::Other, _)) => logic.other_key(),
            Some((KeyEvent::Escape, _)) => logic.escape(),
            Some((KeyEvent::HandsFree, _)) => {
                if logic.is_active() {
                    Action::None
                } else {
                    logic.lock();
                    if listening.is_none() {
                        listening = begin(&app, &flow);
                        if listening.is_none() {
                            logic.reset();
                        }
                    }
                    if listening.is_some() {
                        pill::update(&app, |s| s.phase = "locked".into());
                    }
                    Action::None
                }
            }
            Some((KeyEvent::Finish, _)) => {
                if logic.is_active() || listening.is_some() {
                    logic.reset();
                    Action::Finish
                } else {
                    Action::None
                }
            }
            Some((KeyEvent::Cancel, _)) => {
                logic.reset();
                Action::Cancel
            }
            None => logic.tick(secs(Instant::now())),
        };
        // The dictation key itself (never any other key) leaves a trace, so a Ctrl that
        // "does nothing" shows whether the press arrived and what the key logic did with it.
        // A repeat of a held key is not written down, except once in a while when a take
        // seems stuck.
        if let Some((ev @ (KeyEvent::Down | KeyEvent::Up | KeyEvent::ChatDown | KeyEvent::ChatUp), _)) = received {
            // A repeat is the key still being down, whatever the key logic did with it
            // (after a refused start the logic is idle again and would start anew).
            let from_watcher = matches!(ev, KeyEvent::Down | KeyEvent::Up);
            let repeat = from_watcher && ev == KeyEvent::Down && key_held;
            if from_watcher {
                key_held = ev == KeyEvent::Down;
            }
            let quiet = ignored_logged.is_some_and(|at| at.elapsed() < Duration::from_secs(5));
            if !repeat || !quiet {
                crate::log::line(format!("flow: key {ev:?} -> {action:?} (key logic active {}, listening {})", logic.is_active(), listening.is_some()));
                ignored_logged = if repeat { Some(Instant::now()) } else { None };
            }
        }
        match action {
            Action::None => {}
            Action::Start => {
                listening = begin(&app, &flow);
                if listening.is_none() {
                    logic.reset();
                }
            }
            Action::Restart => {
                log_dropped(&listening, "restart", received.map(|(e, _)| e));
                drop(listening.take());
                listening = begin(&app, &flow);
                if listening.is_none() {
                    logic.reset();
                }
            }
            Action::Lock => pill::update(&app, |s| s.phase = "locked".into()),
            Action::Cancel => {
                log_dropped(&listening, "cancelled", received.map(|(e, _)| e));
                drop(listening.take());
                pill::update(&app, |s| s.phase = "idle".into());
            }
            Action::Finish => {
                if let Some(l) = listening.take() {
                    finish(&app, &flow, l, busy.clone());
                } else {
                    pill::update(&app, |s| s.phase = "idle".into());
                }
            }
        }
        // The pill's dots, about 30 times a second while you speak.
        if let Some(l) = &listening {
            let levels = l.take.lock().unwrap().meter.levels;
            let _ = app.emit_to(pill::LABEL, "pill-bands", levels);
        }
    }
    pill::update(&app, |s| s.phase = "idle".into());
}

/// The dictation key as two eyes see it: the global watcher (every program) and the chat's
/// field (only itself). Both feed the same key logic, so a press both report would count twice.
/// Whoever reports a press or a release first goes through; the other's copy, which follows a few
/// milliseconds later, is dropped once. A copy is only dropped when the other eye reported that
/// very kind of event first and less than `COPY_WINDOW` ago, so with one eye shut the other works
/// alone, and a second real press is never taken for the copy of the first.
#[derive(Default)]
struct KeySources {
    /// [down, up]: when the chat reported it first (the watcher's copy is due).
    watcher_due: [Option<Instant>; 2],
    /// [down, up]: when the watcher reported it first (the chat's copy is due).
    chat_due: [Option<Instant>; 2],
}

/// Long enough for the page to answer, short enough to be over before the next real press.
const COPY_WINDOW: Duration = Duration::from_millis(400);

impl KeySources {
    fn key_action(&mut self, logic: &mut logic::KeyLogic, ev: KeyEvent, at: Instant, t: f64) -> Action {
        let (from_watcher, up) = match ev {
            KeyEvent::Down => (true, false),
            KeyEvent::Up => (true, true),
            KeyEvent::ChatDown => (false, false),
            _ => (false, true),
        };
        let i = usize::from(up);
        let (mine, theirs) = if from_watcher {
            (&mut self.watcher_due[i], &mut self.chat_due[i])
        } else {
            (&mut self.chat_due[i], &mut self.watcher_due[i])
        };
        let is_copy = mine.take().is_some_and(|first| at.saturating_duration_since(first) < COPY_WINDOW);
        if is_copy {
            return Action::None;
        }
        *theirs = Some(at);
        if up {
            logic.key_up(t)
        } else {
            logic.key_down(t)
        }
    }
}

/// Writes down a take that was thrown away without being transcribed, so a dictation
/// that "did nothing" leaves a trace. `cause` is the event that ended it; None is the
/// short tap that timed out.
fn log_dropped(listening: &Option<Listening>, what: &str, cause: Option<KeyEvent>) {
    if let Some(l) = listening {
        crate::log::line(format!("flow: take {what} after {:.1}s ({cause:?})", l.started.elapsed().as_secs_f64()));
    }
}

/// Opens the microphone. None (and the pill says why) when it can't.
fn begin(app: &AppHandle, flow: &Arc<Flow>) -> Option<Listening> {
    if !speech::is_ready() {
        // Holding the key repeats the start about 30 times a second: one line in a while.
        static LAST_LINE: Mutex<Option<Instant>> = Mutex::new(None);
        let mut last = LAST_LINE.lock().unwrap();
        if last.map_or(true, |at| at.elapsed() >= Duration::from_secs(5)) {
            *last = Some(Instant::now());
            crate::log::line("flow: not listening: the voice model is not ready");
        }
        drop(last);
        pill::announce(
            app,
            "download",
            "#3B9EFF",
            t("Download the voice model first, in Roni â†’ Settings â†’ Recognition."),
            Some((t("Open Settings"), "openSettings")),
            10,
        );
        return None;
    }
    let mic = flow.store.lock().unwrap().prefs.mic.clone();
    let take = Arc::new(Mutex::new(audio::Take::default()));
    let sink_take = take.clone();
    let source = audio::Source::Mic(if mic.is_empty() { None } else { Some(mic) });
    let capture = audio::Capture::start(source, move |samples| {
        let mut t = sink_take.lock().unwrap();
        // Ten minutes at most: a dictation left open by mistake stops growing.
        if t.samples.len() < 16_000 * 600 {
            t.samples.extend_from_slice(samples);
        }
        t.peak = samples.iter().fold(t.peak, |m, &s| m.max(s.abs()));
        t.meter.feed(samples);
    });
    match capture {
        Ok(capture) => {
            let app_front = os::foreground_app().filter(|(id, _)| !is_shell(id));
            pill::update(app, |s| s.phase = "listening".into());
            Some(Listening { capture, take, started: Instant::now(), app: app_front })
        }
        Err(err) => {
            crate::log::line(format!("flow: microphone: {err}"));
            pill::update(app, |s| s.phase = "failed".into());
            pill::rest_after(app, "failed", 1800);
            pill::announce(
                app,
                "mic",
                "#FF6B6B",
                t("Roni can't hear you: the microphone is not allowed or not available."),
                None,
                8,
            );
            None
        }
    }
}

/// Stops listening and turns what was said into pasted text, on a worker
/// thread so the key works again at once.
fn finish(app: &AppHandle, flow: &Arc<Flow>, mut l: Listening, busy: Arc<AtomicBool>) {
    l.capture.stop();
    let seconds = l.started.elapsed().as_secs_f64();
    let (samples, peak) = {
        let mut t = l.take.lock().unwrap();
        (std::mem::take(&mut t.samples), t.peak)
    };
    // Too short or silent: nothing to send to the model.
    if samples.len() < 16_000 / 4 || peak < 0.004 {
        crate::log::line(format!("flow: nothing to transcribe ({} samples, {seconds:.1}s held, peak {peak:.4})", samples.len()));
        pill::update(app, |s| s.phase = "idle".into());
        return;
    }
    pill::update(app, |s| s.phase = "thinking".into());
    let app = app.clone();
    let flow = flow.clone();
    let front = l.app.clone();
    std::thread::spawn(move || {
        busy.store(true, Ordering::Relaxed);
        let result = process(&app, &flow, &samples, front.as_ref(), seconds);
        busy.store(false, Ordering::Relaxed);
        if let Err(err) = result {
            crate::log::line(format!("flow: {err}"));
            pill::update(&app, |s| s.phase = "idle".into());
        }
    });
}

fn process(app: &AppHandle, flow: &Arc<Flow>, samples: &[f32], front: Option<&(String, String)>, seconds: f64) -> Result<(), String> {
    let started = Instant::now();
    let transcript = speech::transcribe(samples).ok_or("the voice model is not loaded")?;
    let raw = transcript.text.trim().to_string();
    if raw.is_empty() {
        crate::log::line(format!("flow: the model heard no words ({seconds:.1}s held, {:?} to decode)", started.elapsed()));
        pill::update(app, |s| s.phase = "idle".into());
        return Ok(());
    }
    let (prepared, style, cleanup, words, key) = {
        let store = flow.store.lock().unwrap();
        let app_id = front.map(|(id, _)| id.as_str());
        (store.prepare(&raw), store.style_for(app_id), store.prefs.cleanup, store.words.words.clone(), store.prefs.key)
    };
    let mut written = prepared.text.clone();
    if cleanup && style != store::Style::Verbatim && cleanup::has_key() {
        let app_name = front.map(|(_, n)| n.clone());
        let cleaned = tauri::async_runtime::block_on(cleanup::clean(&prepared.text, style, app_name.as_deref(), &words));
        if text::keeps_marks(&cleaned, &prepared.snippets) {
            written = cleaned;
        }
    }
    let final_text = text::finish(&written, &prepared.snippets);
    crate::log::line(format!("flow: {} words in {:?}", text::word_count(&final_text), started.elapsed()));

    os::wait_key_released(key);
    let terminal = front.is_some_and(|(id, _)| is_terminal(id));
    // The chat's text field has the keyboard: the words go into it, not onto the clipboard.
    let outcome = if chat_focused() && deliver_to_chat(app, &final_text) {
        paste::Outcome::Pasted
    } else {
        paste::paste(&final_text, terminal)
    };
    let entry = {
        let mut store = flow.store.lock().unwrap();
        store.record(&final_text, front.map(|(_, n)| n.as_str()), seconds, store::today(), store::now_ms())
    };
    let _ = app.emit_to(crate::HUB_LABEL, "flow-history", entry);
    match outcome {
        paste::Outcome::Pasted => pill::update(app, |s| s.phase = "idle".into()),
        paste::Outcome::Copied => {
            pill::update(app, |s| s.phase = "copied".into());
            pill::rest_after(app, "copied", 1800);
            pill::announce(
                app,
                "clipboard",
                "#F7B32B",
                t("Your words are copied: click where you want them and press Ctrl+V."),
                None,
                8,
            );
        }
        paste::Outcome::Failed => {
            pill::update(app, |s| s.phase = "idle".into());
            return Err("the clipboard refused the text".into());
        }
    }
    Ok(())
}

/// "Paste again": the last dictation, in the app in front now.
fn paste_again(app: &AppHandle, flow: &Arc<Flow>) {
    let Some(text) = flow.store.lock().unwrap().last_text() else { return };
    let front = os::foreground_app();
    let terminal = front.as_ref().is_some_and(|(id, _)| is_terminal(id));
    if paste::paste(&text, terminal) == paste::Outcome::Pasted {
        pill::update(app, |s| s.phase = "pastedAgain".into());
        pill::rest_after(app, "pastedAgain", 1600);
    }
}

// â”€â”€ Commands â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowStatus {
    prefs: Prefs,
    models: speech::ModelsStatus,
    /// "ok", or why the key can't be watched here ("wayland", "no-display").
    keys: String,
    has_claude_key: bool,
    mics: Vec<audio::InputDevice>,
    platform: &'static str,
    /// Coucou started with the computer.
    autostarted: bool,
    /// The user's first name, for "Hello Louis".
    user_name: Option<String>,
}

#[tauri::command]
pub fn flow_status(flow: State<Arc<Flow>>) -> FlowStatus {
    FlowStatus {
        prefs: flow.store.lock().unwrap().prefs.clone(),
        models: speech::status(),
        keys: match os::keys_supported() {
            Ok(()) => "ok".into(),
            Err(why) => why.into(),
        },
        has_claude_key: cleanup::has_key(),
        mics: audio::input_devices(),
        platform: if cfg!(windows) { "windows" } else { "linux" },
        autostarted: crate::launched_at_login(),
        user_name: crate::platform::user_full_name()
            .and_then(|n| n.split_whitespace().next().map(String::from))
            .filter(|n| !n.is_empty()),
    }
}

#[tauri::command]
pub fn flow_set_prefs(app: AppHandle, flow: State<Arc<Flow>>, prefs: Prefs) {
    let flow = flow.inner().clone();
    let before = {
        let mut store = flow.store.lock().unwrap();
        let before = store.prefs.clone();
        store.prefs = prefs.clone();
        store.save_prefs();
        if before.keep_days != prefs.keep_days {
            store.prune(store::now_ms());
        }
        before
    };
    pill::update(&app, |s| {
        s.edge = pill::edge_name(prefs.edge).into();
        s.key = key_id(prefs.key);
    });
    let restart = before.key != prefs.key;
    if before.enabled && (!prefs.enabled || restart) {
        disable(&app, &flow);
    }
    if prefs.enabled && (!before.enabled || restart) {
        enable(&app, &flow);
    }
    if before.voice != prefs.voice || before.mic != prefs.mic {
        if before.mic != prefs.mic {
            crate::voice::restart(&app);
        } else {
            crate::voice::sync(&app);
        }
    }
    let _ = app.emit("flow-prefs", &prefs);
}

#[tauri::command]
pub fn flow_history(flow: State<Arc<Flow>>) -> Vec<Entry> {
    flow.store.lock().unwrap().history.clone()
}

#[tauri::command]
pub fn flow_delete(flow: State<Arc<Flow>>, id: String) {
    flow.store.lock().unwrap().delete(&id);
}

#[tauri::command]
pub fn flow_clear(flow: State<Arc<Flow>>, everything: bool) {
    let mut store = flow.store.lock().unwrap();
    if everything {
        store.clear_everything();
    } else {
        store.clear_history();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    words: u64,
    seconds: f64,
    dictations: u64,
    words_per_minute: u64,
    minutes_saved: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsView {
    week: Totals,
    month: Totals,
    all: Totals,
    /// The words of the last 30 days, oldest first: ("2026-10-14", words).
    daily: Vec<(String, u64)>,
    apps: std::collections::BTreeMap<String, u64>,
    streak: u32,
}

#[tauri::command]
pub fn flow_stats(flow: State<Arc<Flow>>) -> StatsView {
    let store = flow.store.lock().unwrap();
    let today = store::today();
    let totals = |from: Option<text::Day>| {
        let (words, seconds, dictations) = store.totals(from);
        Totals {
            words,
            seconds,
            dictations,
            words_per_minute: text::words_per_minute(words, seconds),
            minutes_saved: text::minutes_saved(words, seconds),
        }
    };
    let daily = (0..30)
        .rev()
        .map(|back| {
            let key = today.minus(back).key();
            let words = store.stats.days.get(&key).map(|d| d.words).unwrap_or(0);
            (key, words)
        })
        .collect();
    StatsView {
        week: totals(Some(today.minus(6))),
        month: totals(Some(today.minus(29))),
        all: totals(None),
        daily,
        apps: store.stats.apps.clone(),
        streak: store.streak(today),
    }
}

#[tauri::command]
pub fn flow_words(flow: State<Arc<Flow>>) -> Words {
    flow.store.lock().unwrap().words.clone()
}

#[tauri::command]
pub fn flow_set_words(flow: State<Arc<Flow>>, words: Words) {
    let mut store = flow.store.lock().unwrap();
    store.words = words;
    store.save_words();
}

#[tauri::command]
pub fn flow_snippets(flow: State<Arc<Flow>>) -> Vec<Snippet> {
    flow.store.lock().unwrap().snippets.clone()
}

#[tauri::command]
pub fn flow_set_snippets(flow: State<Arc<Flow>>, snippets: Vec<Snippet>) {
    let mut store = flow.store.lock().unwrap();
    store.snippets = snippets;
    store.save_snippets();
}

#[tauri::command]
pub fn flow_styles(flow: State<Arc<Flow>>) -> Vec<AppStyle> {
    flow.store.lock().unwrap().app_styles.clone()
}

#[tauri::command]
pub fn flow_set_styles(flow: State<Arc<Flow>>, styles: Vec<AppStyle>) {
    let mut store = flow.store.lock().unwrap();
    store.app_styles = styles;
    store.save_styles();
}

#[derive(Serialize, Deserialize)]
pub struct RunningApp {
    id: String,
    name: String,
}

#[tauri::command]
pub async fn flow_running_apps() -> Vec<RunningApp> {
    tauri::async_runtime::spawn_blocking(|| os::running_apps().into_iter().map(|(id, name)| RunningApp { id, name }).collect())
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub fn flow_copy(text: String) -> bool {
    paste::copy(&text)
}

#[tauri::command]
pub fn flow_paste_again(app: AppHandle, flow: State<Arc<Flow>>) {
    let flow = flow.inner().clone();
    std::thread::spawn(move || paste_again(&app, &flow));
}

#[tauri::command]
pub fn flow_models_download(app: AppHandle) {
    speech::download(app);
}

#[tauri::command]
pub fn flow_models_remove(app: AppHandle) {
    speech::remove(&app);
}

// â”€â”€ The pill's page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[tauri::command]
pub fn pill_state(app: AppHandle) -> Option<pill::PillState> {
    pill::get(&app).map(|p| p.state())
}

#[tauri::command]
pub fn pill_hot(app: AppHandle, rects: Vec<(f64, f64, f64, f64)>) {
    pill::set_hot(&app, rects);
}

#[tauri::command]
pub fn pill_hover(app: AppHandle, inside: bool) {
    if let Some(p) = pill::get(&app) {
        p.hovered.store(inside, Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn pill_action(app: AppHandle, flow: State<Arc<Flow>>, action: String, id: Option<u64>) {
    let flow = flow.inner().clone();
    match action.as_str() {
        "dictate" => {
            if flow.running.lock().unwrap().is_none() {
                // Dictation off: the pill only shows for a call or a message.
                return;
            }
            flow.send(KeyEvent::HandsFree);
        }
        // The chat's field saw the dictation key (see `KeyEvent::ChatDown`); "chatKeyOther" is
        // another key pressed while it is held: a shortcut, not dictation.
        "chatKeyDown" | "chatKeyUp" | "chatKeyOther" => {
            if flow.running.lock().unwrap().is_none() {
                return;
            }
            flow.send(match action.as_str() {
                "chatKeyDown" => KeyEvent::ChatDown,
                "chatKeyUp" => KeyEvent::ChatUp,
                _ => KeyEvent::Other,
            });
        }
        "finish" => flow.send(KeyEvent::Finish),
        "cancel" => flow.send(KeyEvent::Cancel),
        "note" => crate::notes::toggle(&app),
        "stopNote" => crate::notes::stop(&app),
        "hub" => crate::show_hub(&app, None),
        "announcement" | "dismiss" => {
            let state = pill::get(&app).map(|p| p.state());
            let current = state.and_then(|s| s.announcement).filter(|a| Some(a.id) == id);
            if let Some(a) = current {
                pill::dismiss(&app, a.id);
                if action == "announcement" {
                    match a.action_id.as_deref() {
                        Some("openSettings") => crate::show_hub(&app, Some("settings")),
                        Some("openNotes") => crate::show_hub(&app, Some("notes")),
                        _ => {}
                    }
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod chat_tests {
    use super::*;

    #[test]
    fn the_chat_field_says_when_it_has_the_keyboard_and_when_it_lets_go() {
        chat_input_focus(false);
        assert!(!chat_focused());
        chat_input_focus(true);
        assert!(chat_focused());
        chat_input_focus(false);
        assert!(!chat_focused());
    }

    #[test]
    fn the_island_hears_the_phase_in_the_shape_the_page_reads() {
        let s = DictationState { phase: "locked".into(), enabled: true, key: "right_ctrl".into() };
        assert_eq!(serde_json::to_value(&s).unwrap(), serde_json::json!({ "phase": "locked", "enabled": true, "key": "right_ctrl" }));
    }

    /// Plays the key events of a take through the very function `run` uses, and returns what the
    /// key logic decided, leaving out the nothings. `HandsFree` is the chat's microphone button
    /// (counted as a Start); the rest is the dictation key.
    fn play(events: &[(KeyEvent, u64)]) -> Vec<Action> {
        let t0 = Instant::now();
        let mut logic = logic::KeyLogic::default();
        let mut sources = KeySources::default();
        let mut out = Vec::new();
        for &(ev, ms) in events {
            let (at, t) = (t0 + Duration::from_millis(ms), ms as f64 / 1000.0);
            let action = match ev {
                KeyEvent::HandsFree => {
                    logic.lock();
                    Action::Start
                }
                KeyEvent::Other => logic.other_key(),
                _ => sources.key_action(&mut logic, ev, at, t),
            };
            if action != Action::None {
                out.push(action);
            }
        }
        out
    }

    #[test]
    fn both_eyes_on_one_key_start_one_take_and_stop_it_once() {
        use Action::{Finish, Start};
        use KeyEvent::{ChatDown, ChatUp, Down, Up};
        // The watcher first (the usual order), the chat a moment later.
        assert_eq!(play(&[(Down, 0), (ChatDown, 25), (Up, 1500), (ChatUp, 1525)]), [Start, Finish]);
        // The chat first, the watcher a moment later.
        assert_eq!(play(&[(ChatDown, 0), (Down, 10), (ChatUp, 1500), (Up, 1510)]), [Start, Finish]);
        // The watcher is silent: the chat alone dictates.
        assert_eq!(play(&[(ChatDown, 0), (ChatUp, 1500)]), [Start, Finish]);
        // The chat is silent (the field has no keyboard): the watcher alone, as always.
        assert_eq!(play(&[(Down, 0), (Up, 1500)]), [Start, Finish]);
        // Key repeats while held (the watcher sends them), then the release and its copy.
        assert_eq!(play(&[(Down, 0), (ChatDown, 20), (Down, 500), (Down, 530), (Up, 3000), (ChatUp, 3020)]), [Start, Finish]);
        // Two holds one after the other, both eyes open: two takes, none lost as the copy of the other.
        assert_eq!(
            play(&[(Down, 0), (ChatDown, 20), (Up, 1500), (ChatUp, 1520), (Down, 2000), (ChatDown, 2020), (Up, 3500), (ChatUp, 3520)]),
            [Start, Finish, Start, Finish]
        );
    }

    #[test]
    fn a_quick_tap_stays_a_tap_and_two_quick_taps_still_go_hands_free() {
        use Action::{Lock, Start};
        use KeyEvent::{ChatDown, ChatUp, Down, Up};
        // A tap the watcher saw: the chat's late copy must not come back as the first half of a double tap.
        assert_eq!(play(&[(Down, 0), (Up, 80), (ChatDown, 90), (ChatUp, 170)]), [Start]);
        // The same, the chat first.
        assert_eq!(play(&[(ChatDown, 0), (ChatUp, 80), (Down, 10), (Up, 90)]), [Start]);
        // A real double tap, both eyes open and very quick: the second press is not the first one's copy.
        assert_eq!(
            play(&[(Down, 0), (ChatDown, 20), (Up, 80), (ChatUp, 100), (Down, 200), (ChatDown, 220), (Up, 280), (ChatUp, 300)]),
            [Start, Lock]
        );
    }

    #[test]
    fn the_key_ends_a_hands_free_take_once_and_a_shortcut_does_not_end_it() {
        use Action::{Finish, Start};
        use KeyEvent::{ChatDown, ChatUp, Down, HandsFree, Other, Up};
        // Started with the microphone button, ended by the key: the watcher first...
        assert_eq!(play(&[(HandsFree, 0), (Down, 3000), (ChatDown, 3020), (Up, 3100), (ChatUp, 3120)]), [Start, Finish]);
        // ...and the chat first.
        assert_eq!(play(&[(HandsFree, 0), (ChatDown, 3000), (Down, 3010), (ChatUp, 3100), (Up, 3110)]), [Start, Finish]);
        // Another key while hands-free is typing, not a cancel.
        assert_eq!(play(&[(HandsFree, 0), (Other, 500)]), [Start]);
    }
}
