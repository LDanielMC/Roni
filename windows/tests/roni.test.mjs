// Roni's drawing and his engine (src/mochi/roni.ts, engine.ts): every face draws
// at every size, the small sizes drop what cannot be seen, and the states of the
// agents show the faces of roni-docs/diseno/personaje.md. A recording canvas
// stands in for the real one; how it looks is checked by eye (dev/roni-preview.html).

import { test } from "node:test";
import assert from "node:assert/strict";
import { BOT_STATES, BotEngine } from "../src/mochi/engine.ts";
import {
  NEUTRAL_POSE, bodyPath, detailFor, drawRoni, drawRoniShadow, FIGURE_BOTTOM, FIGURE_TOP,
} from "../src/mochi/roni.ts";

// Node has no Path2D: the shapes only need to exist.
globalThis.Path2D ??= class {
  constructor() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
};

/** A canvas that writes down what it is asked to do. No `filter`: the stacked-ellipse path runs. */
function recorder() {
  const calls = [];
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({}, {
    has: (_t, key) => key !== "filter",
    get: (_t, key) => {
      if (key === "calls") return calls;
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => gradient;
      return (...args) => { calls.push([String(key), ...args]); };
    },
    set: () => true,
  });
  return { ctx, calls };
}

const count = (calls, name) => calls.filter((c) => c[0] === name).length;

const FACES = ["calm", "happy", "thinking", "surprised", "talking", "sleeping", "alert"];

test("every face draws at every size without trouble", () => {
  for (const face of FACES) {
    for (const body of [340, 100, 60, 30, 22, 13]) {
      const { ctx, calls } = recorder();
      drawRoni(ctx, body / 300, { ...NEUTRAL_POSE, face, mouth: 0.7, time: 1 }, 2);
      assert.ok(calls.length > 5, `${face} at ${body}px drew something`);
      assert.equal(count(calls, "save"), count(calls, "restore"), `${face} at ${body}px leaves the context as it found it`);
    }
  }
});

test("the detail follows the size: ribs, bevel and highlights only where they can be seen", () => {
  assert.equal(detailFor(340), 2);
  assert.equal(detailFor(60), 2);
  assert.equal(detailFor(59), 1);
  assert.equal(detailFor(30), 1);
  assert.equal(detailFor(29), 0);
  const big = recorder();
  const small = recorder();
  drawRoni(big.ctx, 100 / 300, NEUTRAL_POSE);
  drawRoni(small.ctx, 22 / 300, NEUTRAL_POSE);
  assert.ok(big.calls.length > small.calls.length * 1.5, "the big Roni has more to paint");
  // The hat's 11 ribs are one stroked path of lines.
  assert.equal(count(big.calls, "lineTo") >= 11, true);
});

test("the eyes grow when Roni is tiny, so they stay visible", () => {
  const eye = (body) => {
    const { ctx, calls } = recorder();
    drawRoni(ctx, body / 300, NEUTRAL_POSE);
    const pills = calls.filter((c) => c[0] === "roundRect");
    assert.equal(pills.length, 2, "two eyes");
    return pills[0][4] * (body / 300); // the eye's height in pixels
  };
  assert.ok(eye(13) >= 3.2, "13 px of body still has eyes 3 px tall");
  assert.ok(Math.abs(eye(340) - 40 * (340 / 300)) < 1e-6, "the design's size when big");
});

test("below ~18 px there is no mouth to blur into the eyes", () => {
  const smiles = (body) => {
    const { ctx, calls } = recorder();
    drawRoni(ctx, body / 300, NEUTRAL_POSE);
    return count(calls, "quadraticCurveTo");
  };
  assert.equal(smiles(13), 0);
  assert.ok(smiles(40) > 0);
});

test("only the thinking face has thought bubbles, and only when big enough", () => {
  const arcs = (face, body) => {
    const { ctx, calls } = recorder();
    drawRoni(ctx, body / 300, { ...NEUTRAL_POSE, face });
    return count(calls, "arc");
  };
  assert.equal(arcs("thinking", 100) - arcs("calm", 100) >= 3, true, "three bubbles");
  assert.equal(arcs("thinking", 20), arcs("calm", 20), "none on a tiny one");
});

test("a happy Roni's eyes are arcs, not pills", () => {
  const { ctx, calls } = recorder();
  drawRoni(ctx, 100 / 300, { ...NEUTRAL_POSE, face: "happy" });
  assert.equal(count(calls, "roundRect"), 0);
});

test("the box (the file drop) loses the hat and the mouth", () => {
  const box = recorder();
  const roni = recorder();
  drawRoni(box.ctx, 40 / 300, { ...NEUTRAL_POSE, morph: 1 });
  drawRoni(roni.ctx, 40 / 300, NEUTRAL_POSE);
  assert.ok(box.calls.length < roni.calls.length);
  assert.equal(count(box.calls, "quadraticCurveTo"), 0, "no smile on a box");
});

test("the body outline and the shadow exist", () => {
  assert.ok(bodyPath(0));
  assert.ok(bodyPath(0.5));
  const { ctx, calls } = recorder();
  drawRoniShadow(ctx, 0.5, 1, 0.5);
  assert.ok(count(calls, "arc") > 0 && count(calls, "fill") > 0);
  assert.ok(FIGURE_TOP < 0 && FIGURE_BOTTOM > 0);
});

// ── The engine ────────────────────────────────────────────────────────────────

test("what the agents do shows as the faces of the design", () => {
  const face = (state) => BOT_STATES[state].face;
  assert.equal(face("idle"), "calm");
  assert.equal(face("thinking"), "thinking");
  assert.equal(face("working"), "thinking");
  assert.equal(face("searching"), "thinking");
  assert.equal(face("approval"), "alert", "a permission waits: he looks at you");
  assert.equal(face("question"), "alert");
  assert.equal(face("finished"), "happy");
  assert.equal(face("error"), "surprised");
  assert.equal(face("sleeping"), "sleeping");
  assert.equal(BOT_STATES.approval.tremble, true, "and trembles a little until you answer");
  assert.equal(BOT_STATES.question.tremble, false, "a question only tilts his head");
  assert.ok(BOT_STATES.question.tilt > 0);
  assert.equal(BOT_STATES.sleeping.sleepy, true, "sleep breathes slower and deeper");
  assert.equal(Object.keys(BOT_STATES).length, 11);
});

test("his face is the state's, unless an emote or his voice says otherwise", () => {
  const engine = new BotEngine();
  engine.setState("idle", true);
  assert.equal(engine.face(), "calm");
  engine.setState("sleeping", true);
  assert.equal(engine.face(), "sleeping");
  engine.setState("idle", true);
  engine.triggerEmote("surprised", 5);
  assert.equal(engine.face(), "surprised");
  engine.triggerEmote("love", 5);
  assert.equal(engine.face(), "happy", "love is a happy face (and hearts)");
  engine.faceOverride = null;
  engine.speaking = true;
  assert.equal(engine.face(), "talking");
  engine.setState("approval", true);
  assert.equal(engine.face(), "alert", "a waiting permission is not interrupted by talk");
});

test("his mouth moves only while he talks", () => {
  const engine = new BotEngine();
  engine.setState("idle", true);
  for (let i = 0; i < 20; i++) engine.update(0.05);
  assert.ok(engine.pose().mouth < 0.01, "quiet");
  engine.speaking = true;
  let peak = 0;
  // The syllables follow the clock, so let half a second really pass.
  const until = performance.now() + 500;
  while (performance.now() < until) {
    engine.update(0.016);
    peak = Math.max(peak, engine.pose().mouth);
  }
  assert.ok(peak > 0.2, `open at times (${peak.toFixed(2)})`);
});

test("Mochi's wardrobe is gone: the hat is part of Roni", () => {
  const engine = new BotEngine();
  engine.setOutfit("witchHat", false);
  assert.equal(engine.outfit, "none");
  engine.setOutfit("crown", true);
  assert.equal(engine.outfit, "none");
});

test("a body colour tints him; none leaves the cream of the design", () => {
  const engine = new BotEngine();
  assert.equal(engine.pose().tint, null);
  engine.bodyColor = [0.2, 0.6, 1];
  assert.deepEqual(engine.pose().tint, [0.2, 0.6, 1]);
});

test("at rest only his breathing moves (the island may draw it at half the rate)", () => {
  const engine = new BotEngine();
  engine.setState("idle", true);
  for (let i = 0; i < 80; i++) engine.update(0.05);
  // Pending tweens from the first blink may still be running: let them finish.
  const until = performance.now() + 400;
  while (performance.now() < until) engine.update(0.016);
  assert.equal(engine.ambientOnly, true);
  assert.equal(engine.busy, true, "he breathes all the time");
  engine.speaking = true;
  assert.equal(engine.ambientOnly, false);
  engine.speaking = false;
  engine.setState("approval", true);
  assert.equal(engine.ambientOnly, false, "a trembling Roni is more than breathing");
});

test("squash and stretch happen around his base: the drawing is pivoted there", () => {
  const engine = new BotEngine();
  engine.sx = 1.2;
  engine.sy = 0.8;
  const { ctx, calls } = recorder();
  engine.draw(ctx, 200, 200);
  const names = calls.map((c) => c[0]);
  const squash = calls.findIndex((c) => c[0] === "scale" && c[1] === 1.2 && c[2] === 0.8);
  assert.ok(squash > 0, "the squash is applied");
  // Before it the origin goes to the floor; right after it, the body's centre is lifted back up.
  assert.equal(names[squash - 1], "translate");
  assert.equal(names[squash + 1], "translate");
  assert.ok(calls[squash + 1][2] < 0, "lifted back from the base");
});
