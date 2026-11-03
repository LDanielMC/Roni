// Chat view — DOM port of PromptView / ChatBubble / TypingDotsView /
// ModelPickerView from IslandViewContent.swift.
//
// Answers are rendered as Markdown (markdown.ts). A local model streams its
// answer: Rust sends `chat-delta` events with the text visible so far. The
// model name above the text field opens the picker: provider chips, then the
// models of the chosen provider, asked for only once it is picked.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { renderMarkdown } from "./markdown";
import { Bridge, onEvent, type ChatContext, type DictationState, type ModelInfo, type RoniStatus } from "../core/bridge";
import {
  activeModel, onlyRoni, pickModel, providerDef, visibleProviders, withModel, type ProviderDef,
} from "../core/providers";
import { Sound } from "../core/sound";
import { State, type ChatMessage } from "../core/state";
import type { ViewHost } from "./views";
import { N_, t, tl } from "../i18n/i18n";

const STRINGS = {
  placeholderFirst: N_("Ask me anything…"),
  placeholderNext: N_("Continue…"),
  send: N_("Send"),
  switchModel: N_("Switch provider or model"),
  noModel: N_("Choose a model"),
  loading: N_("Loading models…"),
  noKey: N_("No API key — add it in Settings."),
  openSettings: N_("Open Settings"),
  dictate: N_("Dictate"),
  stopDictating: N_("Done — write what you said"),
  askToken: N_("Paste Roni's gateway token to start chatting."),
  tokenPlaceholder: N_("Gateway token"),
  connect: N_("Connect"),
  connecting: N_("Connecting…"),
  tokenHelp: N_("Get it in the Ubuntu (WSL) terminal: openclaw gateway auth-token --show"),
  retrying: N_("Trying again every few seconds."),
};

/** How often the chat asks again while Roni's gateway does not answer. */
const GATEWAY_RETRY_MS = 8000;
/** While all is well, how often an open chat still checks that Roni can be reached (Ubuntu may have been shut down). */
const GATEWAY_RECHECK_MS = 30000;

let nextId = 1;

function bubble(message: ChatMessage): HTMLElement {
  if (message.role === "user") {
    return h(
      "div",
      { class: "chat-row user" },
      h("div", { class: "bubble", text: message.content }),
    );
  }
  const reply = h("div", { class: "reply" });
  renderMarkdown(reply, message.content);
  return h("div", { class: "chat-row" }, reply);
}

function typingDots(): HTMLElement {
  return h(
    "div",
    { class: "chat-row" },
    h("div", { class: "typing" }, h("i"), h("i"), h("i")),
  );
}

/** The coloured chip showing what the question is about (a dropped file). */
function contextChip(label: string): HTMLElement {
  const chip = h("div", { class: "chip" }, h("i", { class: "chip-dot" }), h("span", { text: label }));
  requestAnimationFrame(() => chip.classList.add("settled"));
  return chip;
}

function saveSettings() {
  void Bridge.saveSettings(State.settings);
}

// ── Model picker ──────────────────────────────────────────────────────────────

interface Picker {
  el: HTMLElement;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

/** Provider chips, then the chosen provider's models — ModelPickerView. */
function buildPicker(onChange: () => void): Picker {
  const chips = h("div", { class: "picker-chips" });
  const list = h("div", { class: "picker-list" });
  const el = h("div", { class: "picker" }, chips, h("div", { class: "picker-rule" }), list);

  /** Models already asked for, by provider; a model server is asked again each time. */
  const cache = new Map<string, ModelInfo[]>();
  let isOpen = false;
  let request = 0;

  function drawChips() {
    clear(chips);
    for (const p of visibleProviders(State.settings)) {
      const on = p.id === State.settings.chatProvider;
      const chip = h(
        "button",
        { class: on ? "picker-chip on" : "picker-chip", style: `--accent:${p.accent}` },
        h("i", { class: "picker-dot" }),
        h("span", { text: t(p.name) }),
      );
      chip.addEventListener("click", () => {
        if (p.id === State.settings.chatProvider) return;
        State.settings = { ...State.settings, chatProvider: p.id };
        saveSettings();
        Sound.play("pop");
        drawChips();
        void loadModels();
        onChange();
      });
      chips.append(chip);
    }
  }

  function status(text: string, withSettings = false) {
    clear(list);
    const line = h("div", { class: "picker-status", text });
    if (withSettings) {
      line.append(
        h("button", {
          class: "picker-link",
          text: tl(STRINGS.openSettings),
          onclick: () => void Bridge.openSettingsWindow(),
        }),
      );
    }
    list.append(line);
  }

  function drawModels(p: ProviderDef, models: ModelInfo[]) {
    clear(list);
    const current = activeModel(State.settings);
    for (const m of models) {
      const on = m.id === current;
      const row = h(
        "button",
        { class: on ? "picker-model on" : "picker-model", style: `--accent:${p.accent}`, title: m.id },
        h("span", { class: "picker-model-name", text: m.label }),
        on ? svg(ICONS.check, 11, { stroke: 2.2 }) : null,
      );
      row.addEventListener("click", () => {
        State.settings = withModel(State.settings, p.id, m.id);
        saveSettings();
        Sound.play("blip");
        close();
      });
      list.append(row);
    }
    list.querySelector(".picker-model.on")?.scrollIntoView({ block: "nearest" });
  }

  async function loadModels() {
    const p = providerDef(State.settings.chatProvider);
    const ticket = ++request;
    const cached = p.urlField ? undefined : cache.get(p.id);
    if (cached) {
      drawModels(p, cached);
      return;
    }
    // Nothing is asked of a provider that has no key yet.
    if (p.key && !(await Bridge.secretPresent(p.key))) {
      if (ticket === request) status(t(STRINGS.noKey), true);
      return;
    }
    if (ticket !== request) return;
    status(t(STRINGS.loading));
    try {
      const models = await Bridge.chatModels(p.id);
      if (ticket !== request) return;
      if (!p.urlField) cache.set(p.id, models);
      const keep = pickModel(p, models.map((m) => m.id), activeModel(State.settings));
      if (keep && keep !== activeModel(State.settings)) {
        State.settings = withModel(State.settings, p.id, keep);
        saveSettings();
        onChange();
      }
      drawModels(p, models);
    } catch (err) {
      if (ticket === request) status(String(err).replace(/^Error:\s*/, ""), Boolean(p.key));
    }
  }

  function open() {
    isOpen = true;
    el.classList.add("on");
    drawChips();
    onChange();
    void loadModels();
  }

  function close() {
    isOpen = false;
    request++;
    el.classList.remove("on");
    onChange();
  }

  return {
    el,
    open,
    close,
    get isOpen() {
      return isOpen;
    },
  };
}

// ── View ──────────────────────────────────────────────────────────────────────

export function buildPrompt(onHeightChange: () => void): ViewHost {
  const chipRow = h("div", { class: "chip-row" });
  const log = h("div", { class: "chat-log" });
  const input = h("input", {
    type: "text",
    class: "chat-input",
    placeholder: t(STRINGS.placeholderFirst),
    spellcheck: "false",
  }) as HTMLInputElement;
  const send = h("button", { class: "send-btn", title: tl(STRINGS.send) }, svg(ICONS.arrowUp, 11));
  // The microphone: dictation into this field, without the dictation key. Hidden while dictation is off.
  const mic = h("button", { class: "mic-btn", title: tl(STRINGS.dictate) }, svg(ICONS.mic, 13, { stroke: 2 }));
  const bar = h("div", { class: "chat-bar" }, input, mic, send);

  const modelDot = h("i", { class: "model-dot" });
  const modelName = h("span", { class: "model-name" });
  const modelBtn = h(
    "button",
    { class: "model-btn", title: tl(STRINGS.switchModel) },
    modelDot,
    modelName,
    svg(ICONS.chevronUpDown, 9, { stroke: 2 }),
  );
  const modelRow = h("div", { class: "model-row" }, modelBtn);

  const banner = h("div", { class: "roni-banner" });
  const body = h("div", { class: "chat-body" });
  const picker = buildPicker(() => {
    body.classList.toggle("picking", picker.isOpen);
    drawModelButton();
    syncGateway(); // a chip click picked another provider, or Roni again
  });
  body.append(chipRow, banner, log, picker.el, modelRow, bar);

  const el = h("div", { class: "view" }, h("div", { class: "card wash chat-card" }, body));
  (el.querySelector(".card") as HTMLElement).style.setProperty("--wash", "rgba(99,102,241,0.5)");

  let sending = false;
  let renderedCount = -1;
  // A local model answers token by token: where its text so far is shown.
  let live: HTMLElement | null = null;

  function drawModelButton() {
    const p = providerDef(State.settings.chatProvider);
    modelDot.style.background = p.accent;
    // Roni has one agent: his name says more than "openclaw/default".
    modelName.textContent = p.id === "roni" ? p.name : activeModel(State.settings) || t(STRINGS.noModel);
    modelBtn.classList.toggle("open", picker.isOpen);
    // Nothing to switch to until Settings → Chat → Advanced turns the others on.
    const fixed = onlyRoni(State.settings);
    modelBtn.classList.toggle("static", fixed);
    modelBtn.disabled = sending || fixed;
  }

  // ── Roni's gateway: the token the first time, and a quiet retry when it is down ──

  let gateway: RoniStatus["state"] | "unknown" = "unknown";
  let checking = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let wasShown = false;

  const wantsGateway = () => State.settings.chatProvider === "roni";

  function stopRetry() {
    if (retry !== null) clearTimeout(retry);
    retry = null;
  }

  /** The chat is really on screen: this view, in the open island (a hidden island keeps its view). */
  const chatShown = () => State.view === "prompt" && State.mode === "expanded";

  /**
   * Asks again later, always and only while the chat is shown: every 30 s while all is
   * well (Ubuntu may have been shut down), every 8 s while Roni is not answering.
   * A refused token is not retried (it would only be refused again, and the
   * gateway may rate-limit failures): a new token, or reopening the chat, asks again.
   */
  function scheduleRetry() {
    stopRetry();
    if (!wantsGateway() || !chatShown() || gateway === "bad-token") return;
    retry = setTimeout(() => {
      retry = null;
      // The island does not tell this view when it is left: look again before asking.
      if (!chatShown() || !wantsGateway()) {
        wasShown = false;
        return;
      }
      void checkGateway();
    }, gateway === "ok" ? GATEWAY_RECHECK_MS : GATEWAY_RETRY_MS);
  }

  /** What the banner shows now: a retry that finds the same thing must not rebuild it (and lose the typing). */
  let drawn = "";

  function drawBanner(status: RoniStatus | null) {
    const show = gateway !== "ok" && gateway !== "unknown" && status !== null && wantsGateway();
    // Going from hidden to shown always redraws: an answer that arrived while another provider was picked drew nothing.
    const signature = show ? `${gateway}|${status?.message ?? ""}` : "hidden";
    if (signature === drawn) return;
    drawn = signature;
    clear(banner);
    banner.classList.toggle("on", show);
    if (!show || !status) {
      onHeightChange();
      return;
    }
    const needsToken = gateway === "no-token" || gateway === "bad-token";
    const waiting = gateway === "unreachable" || gateway === "error";
    banner.append(
      h("div", {
        class: "roni-msg",
        text: needsToken && gateway === "no-token" ? t(STRINGS.askToken) : status.message,
      }),
    );
    if (waiting) banner.append(h("div", { class: "roni-hint", text: t(STRINGS.retrying) }));
    if (needsToken) {
      const token = h("input", {
        type: "password",
        placeholder: t(STRINGS.tokenPlaceholder),
        autocomplete: "off",
        spellcheck: "false",
      }) as HTMLInputElement;
      const connect = h("button", { text: t(STRINGS.connect) }) as HTMLButtonElement;
      const submitToken = async () => {
        const value = token.value.trim();
        if (!value) return;
        connect.disabled = true;
        connect.textContent = t(STRINGS.connecting);
        let next: RoniStatus | null = null;
        try {
          next = await Bridge.roniConnect(State.settings.roniUrl, value);
        } catch (err) {
          next = { state: "error", url: State.settings.roniUrl, message: String(err).replace(/^Error:\s*/, "") };
        }
        token.value = ""; // the token lives in the credential store now, not here
        gateway = next?.state ?? "ok";
        drawn = ""; // this form's button is spent: draw a fresh one even if the answer is the same
        drawBanner(next);
        scheduleRetry();
      };
      connect.addEventListener("click", () => void submitToken());
      token.addEventListener("keydown", (e) => {
        if ((e as KeyboardEvent).key === "Enter") {
          e.preventDefault();
          void submitToken();
        }
        e.stopPropagation(); // Escape closes the island, not the field
      });
      banner.append(
        h("div", { class: "roni-form" }, token, connect),
        h("div", { class: "roni-hint", text: t(STRINGS.tokenHelp) }),
      );
    }
    onHeightChange();
  }

  /**
   * Roni's gateway: asked every time the chat is opened (an old "ok" proves nothing: Ubuntu may
   * have been shut down meanwhile), then again on the timer of scheduleRetry while it stays
   * on screen, and when a dictation starts (checkNow). Another provider's chat shows nothing of it.
   */
  function syncGateway() {
    if (!wantsGateway()) {
      stopRetry();
      if (gateway !== "unknown") {
        gateway = "unknown"; // back to Roni asks again
        drawn = "";
        clear(banner);
        banner.classList.remove("on");
        onHeightChange();
      }
      wasShown = false;
      return;
    }
    const shown = chatShown();
    if (shown) {
      if (!wasShown && !checking) void checkGateway();
      else if (gateway === "unknown" && !checking) void checkGateway();
      else if (retry === null && !checking) scheduleRetry();
    } else {
      stopRetry();
    }
    wasShown = shown;
  }

  async function checkGateway() {
    if (checking || !wantsGateway()) return;
    checking = true;
    try {
      const status = await Bridge.roniStatus();
      gateway = status?.state ?? "ok"; // no answer at all is no news
      drawBanner(status ?? null);
    } catch (err) {
      gateway = "error";
      drawBanner({ state: "error", url: State.settings.roniUrl, message: String(err).replace(/^Error:\s*/, "") });
    } finally {
      checking = false;
      scheduleRetry();
    }
  }

  modelBtn.addEventListener("click", () => {
    if (sending) return;
    if (picker.isOpen) picker.close();
    else picker.open();
  });

  void onEvent<string>("chat-delta", (text) => {
    if (!sending || !text) return; // nothing visible yet: the dots stay
    State.talking = true; // the answer is arriving: Roni talks
    if (!live) {
      live = h("div", { class: "reply" });
      log.querySelector(".typing")?.parentElement?.remove();
      log.append(h("div", { class: "chat-row" }, live));
    }
    renderMarkdown(live, text);
    log.scrollTop = log.scrollHeight;
  });

  // ── Dictation into this field ──

  let dictation: DictationState = { phase: "idle", enabled: false };

  function drawMic() {
    const active = dictation.phase === "listening" || dictation.phase === "locked";
    mic.classList.toggle("off", !dictation.enabled);
    mic.classList.toggle("live", active);
    mic.classList.toggle("busy", dictation.phase === "thinking");
    mic.title = tl(active ? STRINGS.stopDictating : STRINGS.dictate).toString();
    mic.disabled = sending || dictation.phase === "thinking";
  }

  /** Asks now whether Roni can be reached, if the chat is on screen and is Roni's: dictating into it says so before anything is sent. */
  function checkNow() {
    if (wantsGateway() && chatShown() && !checking) void checkGateway();
  }

  void onEvent<DictationState>("dictation-state", (state) => {
    const started = (state.phase === "listening" || state.phase === "locked") && state.phase !== dictation.phase;
    dictation = state;
    drawMic();
    if (started) checkNow();
  });
  void Bridge.dictationState().then((state) => {
    if (state) {
      dictation = state;
      drawMic();
    }
  });

  // Clicking the button must not take the keyboard from the field: that is where the words go.
  mic.addEventListener("mousedown", (e) => e.preventDefault());
  mic.addEventListener("click", () => {
    if (mic.disabled || !dictation.enabled) return;
    void Bridge.dictationAction(dictation.phase === "listening" || dictation.phase === "locked" ? "finish" : "dictate");
    input.focus();
  });

  // What was said arrives as text, at the caret, for the person to read before sending.
  void onEvent<string>("flow-text", (text) => {
    if (!text) return; // even mid-send: Rust already told the pill it was written
    checkNow();
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const before = input.value.slice(0, start);
    const lead = before !== "" && !/\s$/.test(before) && !/^\s/.test(text) ? " " : "";
    input.setRangeText(lead + text, start, end, "end");
    input.focus();
  });

  // Dictation goes into the field only while it really has the keyboard.
  let reportedFocus = false;
  // A page that was here before (a reload, a crashed webview) may have left Rust's flag on.
  void Bridge.chatInputFocus(false);
  const reportFocus = (on: boolean) => {
    if (on === reportedFocus) return;
    reportedFocus = on;
    void Bridge.chatInputFocus(on);
  };
  input.addEventListener("focus", () => reportFocus(true));
  input.addEventListener("blur", () => reportFocus(false));

  async function submit() {
    const query = input.value.trim();
    if (!query || sending) return;
    if (picker.isOpen) picker.close();
    input.value = "";
    sending = true;
    drawModelButton();
    Sound.play("send");

    State.chatHistory.push({ id: nextId++, role: "user", content: query });
    State.stateOverride = "thinking";
    State.notify();
    onHeightChange();

    const file = State.droppedFile;
    const context: ChatContext | null =
      State.chatHistory.length === 1 && file ? { kind: "file", name: file.name, path: file.path } : null;

    try {
      const reply = await Bridge.chatSend(query, context);
      State.chatHistory.push({ id: nextId++, role: "assistant", content: reply.text });
      State.stateOverride = null;
      // He talks as long as the answer takes to read, up to a few seconds.
      State.talkFor(Math.min(4000, 600 + reply.text.length * 25));
      Sound.play("finish");
    } catch (err) {
      State.stateOverride = null;
      State.stopTalking();
      State.noteMessage = String(err).replace(/^Error:\s*/, "");
      State.view = "note";
      Sound.play("error");
      void checkGateway(); // so the banner is there, with the token field if that is what is missing
    } finally {
      sending = false;
      live = null;
      renderedCount = -1; // the finished answer replaces the streamed one
      drawModelButton();
      State.notify();
      onHeightChange();
      input.focus();
    }
  }

  send.addEventListener("click", () => void submit());
  input.addEventListener("keydown", (e) => {
    const key = (e as KeyboardEvent).key;
    if (key === "Enter") {
      e.preventDefault();
      void submit();
    } else if (key === "Escape" && picker.isOpen) {
      e.preventDefault();
      picker.close();
    }
    e.stopPropagation(); // Escape closes the island, not the chat
  });

  return {
    el,
    sync() {
      const file = State.droppedFile;
      const wantChip = file?.name ?? "";
      if (chipRow.dataset.label !== wantChip) {
        chipRow.dataset.label = wantChip;
        clear(chipRow);
        if (wantChip) chipRow.append(contextChip(wantChip));
      }

      const thinking = State.stateOverride === "thinking";
      const count = State.chatHistory.length + (thinking ? 0.5 : 0);
      if (count !== renderedCount && !live) {
        renderedCount = count;
        clear(log);
        for (const m of State.chatHistory) log.append(bubble(m));
        if (thinking) log.append(typingDots());
        log.scrollTop = log.scrollHeight;
      }

      // Leaving the chat folds the picker away.
      if (State.view !== "prompt" && picker.isOpen) picker.close();
      drawModelButton();

      syncGateway();

      input.placeholder = t(State.chatHistory.length === 0 ? STRINGS.placeholderFirst : STRINGS.placeholderNext);
      // Read-only, not disabled: a disabled field loses the keyboard in the browser, and with it
      // the dictation (and the focus the next message needs).
      input.readOnly = sending;
      drawMic();
      // What is true now, both ways: a folded island can leave the field focused in the page, and
      // reopening it then raises no `focus` event.
      reportFocus(chatShown() && document.activeElement === input && document.hasFocus());
    },
    focus() {
      input.focus();
      input.select();
    },
    blur() {
      input.blur();
    },
  };
}
