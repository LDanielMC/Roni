// The chat view (src/views/chat.ts) on a fake DOM, through the real bridge:
// the model switcher asks for a provider's models only once it is picked and
// has a key, picking saves the settings, and a streamed answer grows in place.

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fakedom.mjs";
import { calls, emit, internals, sent } from "./tauri.mjs";

installFakeDom();
const { buildPrompt } = await import("../src/views/chat.ts");
const { DEFAULT_SETTINGS, State } = await import("../src/core/state.ts");

/** What the mocked Rust side answers, by command. */
let answers;
const plainInvoke = internals.invoke;
internals.invoke = async (cmd, args) => {
  const result = await plainInvoke(cmd, args);
  if (cmd in answers) return typeof answers[cmd] === "function" ? answers[cmd](args) : answers[cmd];
  return result;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let view;
beforeEach(() => {
  calls.length = 0;
  answers = {};
  // The flows below are the picker's: Claude's chat, with every provider on offer.
  State.settings = { ...DEFAULT_SETTINGS, chatModels: {}, chatProvider: "anthropic", otherProvidersInChat: true };
  State.chatHistory = [];
  State.stateOverride = null;
  State.view = "prompt";
  State.droppedFile = null;
  view = buildPrompt(() => {});
  view.sync();
});

const $ = (cls) => view.el.querySelector(cls);
const chips = () => view.el.find(".picker-chip").map((c) => c.textContent);
const models = () => view.el.find(".picker-model").map((m) => m.textContent);

test("the model button shows the active provider's model", () => {
  assert.equal($(".model-name").textContent, "claude-opus-5");
  State.settings = { ...State.settings, chatProvider: "google" };
  view.sync();
  assert.equal($(".model-name").textContent, "gemini-2.0-flash");
  State.settings = { ...State.settings, chatProvider: "ollama" };
  view.sync();
  assert.equal($(".model-name").textContent, "Choose a model");
});

test("a provider without a key is never asked for its models", async () => {
  answers.secret_present = false;
  $(".model-btn").fire("click");
  await flush();
  assert.ok($(".chat-body").classList.contains("picking"));
  assert.deepEqual(chips(), ["Roni", "Anthropic", "Google", "OpenAI", "OpenRouter"]);
  assert.deepEqual(sent("secret_present"), [{ key: "anthropic-api-key" }]);
  assert.deepEqual(sent("chat_models"), []);
  assert.match($(".picker-status").textContent, /No API key/);
});

test("with a key, the models are listed and picking one saves it", async () => {
  answers.secret_present = true;
  answers.chat_models = [
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  ];
  $(".model-btn").fire("click");
  await flush();
  assert.deepEqual(sent("chat_models"), [{ provider: "anthropic" }]);
  assert.deepEqual(models(), ["Claude Opus 5", "Claude Sonnet 5"]);
  view.el.find(".picker-model")[1].fire("click");
  assert.equal(State.settings.model, "claude-sonnet-5");
  assert.equal(sent("save_settings").at(-1).settings.model, "claude-sonnet-5");
  assert.ok(!$(".chat-body").classList.contains("picking"));
  assert.equal($(".model-name").textContent, "claude-sonnet-5");
});

test("switching provider saves it and asks the new provider only", async () => {
  answers.secret_present = (args) => args.key === "google-api-key";
  answers.chat_models = (args) => (args.provider === "google" ? [{ id: "gemini-2.5-flash", label: "gemini-2.5-flash" }] : []);
  $(".model-btn").fire("click");
  await flush();
  assert.deepEqual(sent("chat_models"), []);
  view.el.find(".picker-chip")[2].fire("click");
  await flush();
  assert.equal(State.settings.chatProvider, "google");
  assert.deepEqual(sent("chat_models"), [{ provider: "google" }]);
  // The saved model was not offered: the flash one is kept instead, and saved.
  assert.equal(State.settings.chatModels.google, "gemini-2.5-flash");
  assert.equal(sent("save_settings").at(-1).settings.chatModels.google, "gemini-2.5-flash");
  assert.deepEqual(models(), ["gemini-2.5-flash"]);
});

test("a local answer streams into one reply, then the finished text replaces it", async () => {
  let finish;
  answers.chat_send = () => new Promise((resolve) => (finish = resolve));
  const input = $(".chat-input");
  input.value = "hello";
  $(".send-btn").fire("click");
  await flush();
  view.sync(); // what State.notify() does in the island
  assert.ok($(".model-btn").disabled, "no switching mid-answer");
  assert.ok($(".typing"), "dots until the first visible text");

  emit("chat-delta", ""); // still thinking
  assert.ok($(".typing"));
  emit("chat-delta", "Hel");
  emit("chat-delta", "Hello **there**");
  view.sync(); // another view update mid-stream must not wipe the live answer
  assert.equal($(".typing"), null);
  const replies = view.el.find(".reply");
  assert.equal(replies.length, 1);
  assert.equal(replies[0].find("STRONG")[0].textContent, "there");

  finish({ text: "Hello **there**!" });
  await flush();
  view.sync();
  assert.equal(view.el.find(".reply").length, 1);
  assert.equal(view.el.find(".reply")[0].textContent, "Hello there!");
  assert.deepEqual(State.chatHistory.map((m) => m.role), ["user", "assistant"]);
  assert.ok(!$(".model-btn").disabled);
});

// ── Roni's gateway ────────────────────────────────────────────────────────────

/** A chat that is Roni's, as it is out of the box. */
function roniChat() {
  State.mode = "expanded";
  State.settings = { ...DEFAULT_SETTINGS, chatModels: {} };
  calls.length = 0;
  view = buildPrompt(() => {});
  view.sync();
}

/** Leaves the chat, which also puts any retry timer away. */
function leave() {
  State.view = "home";
  view.sync();
  State.view = "prompt";
  State.mode = "hidden";
}

test("Roni's chat is a label, not a switcher, until Advanced turns the others on", () => {
  roniChat();
  assert.equal($(".model-name").textContent, "Roni");
  assert.ok($(".model-btn").disabled);
  assert.ok($(".model-btn").classList.contains("static"));
  State.settings = { ...State.settings, otherProvidersInChat: true };
  view.sync();
  assert.ok(!$(".model-btn").disabled);
  assert.ok(!$(".model-btn").classList.contains("static"));
  leave();
});

test("when the gateway answers the chat says nothing, and asks only once", async () => {
  answers.roni_status = { state: "ok", url: "http://127.0.0.1:18789", message: "" };
  roniChat();
  await flush();
  view.sync();
  assert.equal(sent("roni_status").length, 1);
  assert.ok(!$(".roni-banner").classList.contains("on"));
  leave();
});

test("without a token the chat asks for it, keeps it out of the page and hides the banner once it is in", async () => {
  answers.roni_status = { state: "no-token", url: "http://127.0.0.1:18789", message: "No token yet — paste it to talk to Roni." };
  roniChat();
  await flush();
  const banner = $(".roni-banner");
  assert.ok(banner.classList.contains("on"));
  assert.match(banner.textContent, /Paste Roni's gateway token/);
  const [field] = banner.find("input");
  assert.equal(field.getAttribute("type"), "password", "typed as a secret");

  answers.roni_connect = { state: "ok", url: "http://127.0.0.1:18789", message: "" };
  field.value = "  tok-123  ";
  banner.find("button")[0].fire("click");
  await flush();
  assert.deepEqual(sent("roni_connect"), [{ url: "http://127.0.0.1:18789", token: "tok-123" }]);
  assert.equal(field.value, "", "the token is not left in the field");
  assert.ok(!banner.classList.contains("on"));
  // Never through the generic secret command: Rust ties the token to the address.
  assert.deepEqual(sent("secret_set"), []);
  leave();
});

test("a wrong token says so and asks again; an empty field sends nothing", async () => {
  answers.roni_status = { state: "bad-token", url: "http://127.0.0.1:18789", message: "Roni's gateway refused the token. Paste it again in Settings → Chat." };
  roniChat();
  await flush();
  const banner = $(".roni-banner");
  assert.ok(banner.classList.contains("on"));
  assert.match(banner.textContent, /refused the token/);
  try {
    banner.find("input")[0].value = "   "; // a real field starts as ""
    banner.find("button")[0].fire("click");
    await flush();
    assert.deepEqual(sent("roni_connect"), []);
  } finally {
    leave();
  }
});

test("a gateway that does not answer shows why, without a token field, and asks again on its own", async () => {
  answers.roni_status = { state: "unreachable", url: "http://127.0.0.1:18789", message: "Cannot reach Roni at http://127.0.0.1:18789. Is OpenClaw running?" };
  roniChat();
  await flush();
  const banner = $(".roni-banner");
  assert.ok(banner.classList.contains("on"));
  assert.match(banner.textContent, /Is OpenClaw running\?/);
  assert.match(banner.textContent, /Trying again/);
  assert.equal(banner.find("input").length, 0);
  // Leaving the chat stops the asking: nothing keeps polling a hidden island.
  leave();
});

test("another provider's chat never asks Roni's gateway anything", async () => {
  State.settings = { ...DEFAULT_SETTINGS, chatProvider: "google" };
  calls.length = 0;
  view = buildPrompt(() => {});
  view.sync();
  await flush();
  assert.deepEqual(sent("roni_status"), []);
  assert.ok(!$(".roni-banner").classList.contains("on"));
});

test("a hidden island asks nothing more: the chat keeps its view but is not on screen", async () => {
  answers.roni_status = { state: "unreachable", url: "http://127.0.0.1:18789", message: "Cannot reach Roni at http://127.0.0.1:18789. Is OpenClaw running?" };
  roniChat();
  await flush();
  assert.equal(sent("roni_status").length, 1);
  // The island folds away; the view stays "prompt". No timer may be left to wake it.
  State.mode = "compact";
  view.sync();
  const timers = [];
  const real = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => { if (ms >= 1000) { timers.push(ms); return 0; } return real(fn, ms, ...a); };
  try {
    view.sync();
    await flush();
  } finally {
    globalThis.setTimeout = real;
  }
  assert.deepEqual(timers, []);
  assert.equal(sent("roni_status").length, 1);
  leave();
});

test("a refused token is not asked again on a timer, and what is being typed survives a recheck", async () => {
  answers.roni_status = { state: "bad-token", url: "http://127.0.0.1:18789", message: "Roni's gateway refused the token. Paste it again in Settings → Chat." };
  const timers = [];
  const real = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => { if (ms >= 1000) { timers.push(ms); return 0; } return real(fn, ms, ...a); };
  try {
    roniChat();
    await flush();
    assert.deepEqual(timers, [], "no retry for a refused token");
    const banner = $(".roni-banner");
    const [field] = banner.find("input");
    field.value = "half-typed";
    // Same answer again (the island was reopened): the field is the same one, with its text.
    State.mode = "compact";
    view.sync();
    State.mode = "expanded";
    view.sync();
    await flush();
    assert.equal(banner.find("input")[0], field);
    assert.equal(field.value, "half-typed");
  } finally {
    globalThis.setTimeout = real;
    leave();
  }
});

test("an unreachable gateway is asked again every few seconds while the chat is shown", async () => {
  answers.roni_status = { state: "unreachable", url: "http://127.0.0.1:18789", message: "Cannot reach Roni at http://127.0.0.1:18789. Is OpenClaw running?" };
  const timers = [];
  const real = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => { if (ms >= 1000) { timers.push(ms); return 0; } return real(fn, ms, ...a); };
  try {
    roniChat();
    await flush();
    assert.deepEqual(timers, [8000]);
  } finally {
    globalThis.setTimeout = real;
    leave();
  }
});

test("a pending retry that finds the chat left (the island never tells the view) asks nothing", async () => {
  answers.roni_status = { state: "unreachable", url: "http://127.0.0.1:18789", message: "Cannot reach Roni at http://127.0.0.1:18789. Is OpenClaw running?" };
  const callbacks = [];
  const real = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => { if (ms >= 1000) { callbacks.push(fn); return 0; } return real(fn, ms, ...a); };
  try {
    roniChat();
    await flush();
    assert.equal(callbacks.length, 1);
    assert.equal(sent("roni_status").length, 1);
    // Another view takes over; the chat's sync() is not called. Then the timer fires.
    State.view = "home";
    callbacks[0]();
    await flush();
    assert.equal(sent("roni_status").length, 1, "nothing asked");
    assert.equal(callbacks.length, 1, "and nothing scheduled");
    // Coming back asks again.
    State.view = "prompt";
    view.sync();
    await flush();
    assert.equal(sent("roni_status").length, 2);
  } finally {
    globalThis.setTimeout = real;
    leave();
  }
});

test("picking another provider hides Roni's banner, and picking Roni again asks again", async () => {
  answers.roni_status = { state: "no-token", url: "http://127.0.0.1:18789", message: "No token yet — paste it to talk to Roni." };
  answers.secret_present = false;
  roniChat();
  State.settings = { ...State.settings, otherProvidersInChat: true };
  view.sync();
  await flush();
  const banner = $(".roni-banner");
  assert.ok(banner.classList.contains("on"));
  $(".model-btn").fire("click");
  await flush();
  const chipsNow = view.el.find(".picker-chip");
  const google = chipsNow.find((c) => c.textContent === "Google");
  const roni = chipsNow.find((c) => c.textContent === "Roni");
  google.fire("click");
  await flush();
  assert.ok(!banner.classList.contains("on"), "another provider's chat shows nothing of Roni's gateway");
  const asked = sent("roni_status").length;
  view.el.find(".picker-chip").find((c) => c.textContent === "Roni").fire("click");
  await flush();
  assert.equal(sent("roni_status").length, asked + 1);
  assert.ok(banner.classList.contains("on"));
  void roni;
  leave();
});

test("a slow answer that lands while another provider is picked does not leave Roni's banner hidden for good", async () => {
  let finish;
  answers.roni_status = () => new Promise((resolve) => (finish = resolve));
  roniChat();
  State.settings = { ...State.settings, otherProvidersInChat: true };
  view.sync();
  await flush();
  $(".model-btn").fire("click");
  await flush();
  view.el.find(".picker-chip").find((c) => c.textContent === "Google").fire("click");
  await flush();
  const down = { state: "unreachable", url: "http://127.0.0.1:18789", message: "Cannot reach Roni at http://127.0.0.1:18789. Is OpenClaw running?" };
  finish(down);
  await flush();
  answers.roni_status = down; // the next question is answered at once
  view.el.find(".picker-chip").find((c) => c.textContent === "Roni").fire("click");
  await flush();
  assert.ok($(".roni-banner").classList.contains("on"), "OpenClaw is down and the chat says so");
  leave();
});

// ── Dictation into the chat ───────────────────────────────────────────────────

/** A chat that is on screen, with a text field whose value and caret the tests can set. */
function dictChat(enabled = true, phase = "idle") {
  answers.dictation_state = { phase, enabled };
  answers.roni_status = { state: "ok", url: "http://127.0.0.1:18789", message: "" };
  roniChat();
  const input = $(".chat-input");
  // The page's own idea of focus, which the fake DOM does not have.
  document.hasFocus = () => true;
  document.activeElement = input;
  // The browser's rules the fake DOM lacks: a disabled field cannot take the keyboard, and
  // disabling a focused one takes it away.
  input.blur = () => {
    if (document.activeElement === input) document.activeElement = null;
    input.fire("blur");
  };
  input.focus = () => {
    if (input.disabled || document.activeElement === input) return;
    document.activeElement = input;
    input.fire("focus");
  };
  let disabled = false;
  Object.defineProperty(input, "disabled", {
    get: () => disabled,
    set: (on) => {
      disabled = Boolean(on);
      if (disabled && document.activeElement === input) input.blur();
    },
  });
  input.value ??= ""; // a real field starts empty
  input.selectionStart = input.selectionEnd = null;
  input.setRangeText = (text, start, end) => {
    input.value = input.value.slice(0, start) + text + input.value.slice(end);
    input.selectionStart = input.selectionEnd = start + text.length;
  };
  return input;
}

test("the chat's microphone shows only while dictation is on", async () => {
  dictChat(false);
  await flush();
  assert.ok($(".mic-btn").classList.contains("off"));
  leave();
  dictChat(true);
  await flush();
  assert.ok(!$(".mic-btn").classList.contains("off"));
  leave();
});

test("the microphone starts the dictation, and while it listens the same button finishes it", async () => {
  dictChat(true, "idle");
  await flush();
  $(".mic-btn").fire("click");
  assert.deepEqual(sent("pill_action"), [{ action: "dictate", id: null }]);
  emit("dictation-state", { phase: "locked", enabled: true });
  assert.ok($(".mic-btn").classList.contains("live"));
  $(".mic-btn").fire("click");
  assert.deepEqual(sent("pill_action").at(-1), { action: "finish", id: null });
  emit("dictation-state", { phase: "thinking", enabled: true });
  assert.ok($(".mic-btn").disabled, "nothing to press while the words are being written");
  assert.ok(!$(".mic-btn").classList.contains("live"));
  leave();
});

test("pressing the microphone does not take the keyboard from the field", async () => {
  dictChat();
  await flush();
  const down = $(".mic-btn").fire("mousedown");
  assert.ok(down.defaultPrevented);
  leave();
});

test("what is dictated lands in the field at the caret, with a space between words", async () => {
  const input = dictChat();
  await flush();
  input.value = "Hola";
  input.selectionStart = input.selectionEnd = 4;
  emit("flow-text", "qué tal");
  assert.equal(input.value, "Hola qué tal");
  // Nothing doubled when the field already ends in a space, or is empty.
  input.value = "Hola ";
  input.selectionStart = input.selectionEnd = 5;
  emit("flow-text", "otra vez");
  assert.equal(input.value, "Hola otra vez");
  input.value = "";
  input.selectionStart = input.selectionEnd = 0;
  emit("flow-text", "primero");
  assert.equal(input.value, "primero");
  // It is only written: sending is up to the person.
  assert.deepEqual(sent("chat_send"), []);
  leave();
});

test("the field tells Rust when it has the keyboard and when it does not", async () => {
  const input = dictChat();
  await flush();
  assert.deepEqual(sent("chat_input_focus")[0], { focused: false }, "a flag left on by an earlier page is cleared at once");
  calls.length = 0;
  input.fire("focus");
  input.fire("blur");
  assert.deepEqual(sent("chat_input_focus"), [{ focused: true }, { focused: false }]);
  leave();
});

test("leaving the chat for another view lets go of the keyboard the way the island does it", async () => {
  const input = dictChat();
  await flush();
  calls.length = 0;
  input.fire("focus");
  // The island never calls sync() on the view it leaves: it calls blur().
  view.blur();
  assert.deepEqual(sent("chat_input_focus").at(-1), { focused: false });
  leave();
});

test("a folded island says no, and reopening with the field still focused says yes again", async () => {
  const input = dictChat();
  await flush();
  calls.length = 0;
  input.fire("focus");
  State.mode = "compact";
  view.sync();
  assert.deepEqual(sent("chat_input_focus").at(-1), { focused: false });
  // No `focus` event this time: the field never lost it in the page.
  State.mode = "expanded";
  view.sync();
  assert.deepEqual(sent("chat_input_focus").at(-1), { focused: true });
  // The window loses the keyboard to another app while the field stays "active" in the page.
  document.hasFocus = () => false;
  view.sync();
  assert.deepEqual(sent("chat_input_focus").at(-1), { focused: false });
  leave();
});

test("words that arrive while a message is being sent are not lost, and the field keeps the keyboard", async () => {
  const input = dictChat();
  await flush();
  input.focus();
  let finish;
  answers.chat_send = () => new Promise((resolve) => (finish = resolve));
  input.value = "pregunta";
  $(".send-btn").fire("click");
  await flush();
  view.sync(); // the island syncs the view on the next frame
  assert.equal(input.value, "");
  assert.deepEqual(sent("chat_input_focus").at(-1), { focused: true }, "still the keyboard's while the answer comes");
  emit("flow-text", "y otra cosa");
  assert.equal(input.value, "y otra cosa");
  finish({ text: "ok" });
  await flush();
  view.sync();
  assert.deepEqual(sent("chat_input_focus").at(-1), { focused: true }, "and after it, for the next dictation");
  assert.equal(document.activeElement, input);
  leave();
});

// ── Roni switched off after the chat was opened ───────────────────────────────

test("an open chat keeps checking, slowly, that Roni can be reached", async () => {
  answers.roni_status = { state: "ok", url: "http://127.0.0.1:18789", message: "" };
  const timers = [];
  const real = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => { if (ms >= 1000) { timers.push(ms); return 0; } return real(fn, ms, ...a); };
  try {
    roniChat();
    await flush();
    assert.deepEqual(timers, [30000]);
    assert.ok(!$(".roni-banner").classList.contains("on"));
  } finally {
    globalThis.setTimeout = real;
    leave();
  }
});

test("Ubuntu shut down after the chat opened: the next dictation says so before anything is sent", async () => {
  const input = dictChat(true, "idle");
  await flush();
  assert.ok(!$(".roni-banner").classList.contains("on"));
  assert.equal(sent("roni_status").length, 1);
  // OpenClaw goes away; nothing in the chat changes by itself yet.
  answers.roni_status = { state: "unreachable", url: "http://127.0.0.1:18789", message: "Cannot reach Roni at http://127.0.0.1:18789. Is OpenClaw running?" };
  // Dictation starts (the key or the button): the chat looks.
  emit("dictation-state", { phase: "listening", enabled: true });
  await flush();
  assert.equal(sent("roni_status").length, 2);
  assert.ok($(".roni-banner").classList.contains("on"));
  assert.match($(".roni-banner").textContent, /Is OpenClaw running\?/);
  // The words still arrive in the field: the dictation itself never needed Roni.
  emit("flow-text", "hola");
  assert.equal(input.value, "hola");
  // The same phase twice is one look, not two.
  emit("dictation-state", { phase: "listening", enabled: true });
  await flush();
  assert.equal(sent("roni_status").length, 3, "only the arrival of the words asked again");
  leave();
});

test("reopening the chat looks again even when the last look said all was well", async () => {
  answers.roni_status = { state: "ok", url: "http://127.0.0.1:18789", message: "" };
  roniChat();
  await flush();
  assert.equal(sent("roni_status").length, 1);
  State.mode = "compact";
  view.sync();
  // Ubuntu is shut down while the island is folded away.
  answers.roni_status = { state: "unreachable", url: "http://127.0.0.1:18789", message: "Cannot reach Roni at http://127.0.0.1:18789. Is OpenClaw running?" };
  State.mode = "expanded";
  view.sync();
  await flush();
  assert.equal(sent("roni_status").length, 2);
  assert.ok($(".roni-banner").classList.contains("on"));
  leave();
});
