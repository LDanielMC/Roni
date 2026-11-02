// The island's provider table (src/core/providers.ts): which model the chat
// uses, which chips the picker shows, and what a server address exposes.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDERS, activeModel, isLoopbackHost, onlyRoni, pickModel, providerDef, urlExposure, visibleProviders, withModel,
} from "../src/core/providers.ts";
import { DEFAULT_SETTINGS } from "../src/core/state.ts";

const settings = (over = {}) => ({ ...DEFAULT_SETTINGS, ...over });

test("the ids and key names match the Rust side and the Mac", () => {
  assert.deepEqual(PROVIDERS.map((p) => p.id), ["roni", "anthropic", "google", "openai", "openrouter", "ollama", "lmstudio", "custom"]);
  assert.equal(providerDef("google").key, "google-api-key");
  assert.equal(providerDef("openai").key, "openai-api-key");
  assert.equal(providerDef("openrouter").key, "openrouter-api-key");
  assert.equal(providerDef("ollama").key, null);
  // An unknown id (an older or newer settings.json) falls back to Roni.
  assert.equal(providerDef("nope").id, "roni");
});

test("Claude's model is the existing setting; the others are kept per provider", () => {
  assert.equal(activeModel(settings({ chatProvider: "anthropic" })), "claude-opus-5");
  assert.equal(activeModel(settings({ chatProvider: "google" })), "gemini-2.0-flash");
  assert.equal(activeModel(settings({ chatProvider: "ollama" })), "");
  let s = withModel(settings({ chatProvider: "openai" }), "openai", "gpt-5-mini");
  assert.equal(activeModel(s), "gpt-5-mini");
  assert.equal(s.model, "claude-opus-5");
  s = withModel(s, "anthropic", "claude-haiku-4-5");
  assert.equal(s.model, "claude-haiku-4-5");
  assert.equal(s.chatModels.openai, "gpt-5-mini");
  // withModel never changes the object it was given.
  assert.deepEqual(DEFAULT_SETTINGS.chatModels, {});
});

test("the chat is Roni's: his agent, no switcher, and the others only once Advanced turns them on", () => {
  assert.equal(DEFAULT_SETTINGS.chatProvider, "roni");
  assert.equal(DEFAULT_SETTINGS.roniUrl, "http://127.0.0.1:18789");
  assert.equal(activeModel(settings()), "openclaw/default");
  assert.equal(providerDef("roni").key, null);
  const ids = (s) => visibleProviders(s).map((p) => p.id);
  assert.deepEqual(ids(settings()), ["roni"]);
  assert.ok(onlyRoni(settings()));
  assert.ok(!onlyRoni(settings({ otherProvidersInChat: true })));
  assert.ok(!onlyRoni(settings({ chatProvider: "google" })));
  // Switched on: Roni first, then the same picker as before.
  const all = (over) => ids(settings({ otherProvidersInChat: true, ...over }));
  assert.deepEqual(all({}), ["roni", "anthropic", "google", "openai", "openrouter"]);
  // Picked another provider earlier, then the switch went off: the picker never hides where the chat goes.
  assert.deepEqual(ids(settings({ chatProvider: "openai" })), ["roni", "anthropic", "google", "openai", "openrouter"]);
});

test("model servers show in the picker once connected, or while in use", () => {
  const ids = (s) => visibleProviders(s).map((p) => p.id);
  const on = { otherProvidersInChat: true };
  assert.deepEqual(ids(settings({ ...on })), ["roni", "anthropic", "google", "openai", "openrouter"]);
  assert.deepEqual(ids(settings({ ...on, ollamaUrl: "http://127.0.0.1:11434" })), ["roni", "anthropic", "google", "openai", "openrouter", "ollama"]);
  assert.deepEqual(ids(settings({ ...on, chatProvider: "custom" })), ["roni", "anthropic", "google", "openai", "openrouter", "custom"]);
});

test("the saved model is kept when offered, else a sensible one is picked", () => {
  const google = providerDef("google");
  assert.equal(pickModel(google, ["gemini-2.5-pro", "gemini-2.0-flash"], "gemini-2.5-pro"), "gemini-2.5-pro");
  assert.equal(pickModel(google, ["gemini-2.5-pro", "gemini-2.5-flash"], "gone"), "gemini-2.5-flash");
  assert.equal(pickModel(providerDef("openai"), ["gpt-4o", "gpt-5-mini"], "gone"), "gpt-5-mini");
  assert.equal(pickModel(providerDef("ollama"), ["llama3.2", "qwen"], ""), "llama3.2");
  assert.equal(pickModel(providerDef("openrouter"), ["a/b", "openrouter/auto"], "gone"), "openrouter/auto");
  assert.equal(pickModel(google, [], "x"), null);
});

test("loopback hosts match net.rs", () => {
  for (const host of ["localhost", "app.localhost", "127.0.0.1", "127.9.9.9", "[::1]", "::1", "0.0.0.0", "[::]"]) {
    assert.ok(isLoopbackHost(host), host);
  }
  for (const host of ["example.com", "192.168.1.2", "localhost.example.com", "128.0.0.1", "[2001:db8::1]"]) {
    assert.ok(!isLoopbackHost(host), host);
  }
});

test("an address says whether what you type leaves this computer", () => {
  assert.equal(urlExposure(""), "local");
  assert.equal(urlExposure("http://localhost:11434"), "local");
  assert.equal(urlExposure("127.0.0.1:1234/v1"), "local");
  assert.equal(urlExposure("http://[::1]:8000"), "local");
  assert.equal(urlExposure("https://llm.example.com"), "remote");
  assert.equal(urlExposure("http://gpu-box.lan:8000"), "remote-http");
  assert.equal(urlExposure("192.168.1.20:8000"), "remote-http");
  assert.equal(urlExposure("ftp://example.com"), "invalid");
  assert.equal(urlExposure("http://user:pw@example.com"), "invalid");
  assert.equal(urlExposure("http://"), "invalid");
});
