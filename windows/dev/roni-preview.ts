// Every face of Roni at every size, drawn once: `npm run dev`, then /dev/roni-preview.html.
// Not shipped. It is how the drawing is checked by eye (personaje.md: "que se vea
// bien en tamaño chico en la isla").
import { BotEngine } from "../src/mochi/engine";
import { NEUTRAL_POSE, deviceRatio, drawRoni, drawRoniShadow, type Face } from "../src/mochi/roni";

const FACES: Face[] = ["calm", "happy", "thinking", "surprised", "talking", "sleeping", "alert"];
const out = document.getElementById("out")!;
const dpr = Math.min(2, window.devicePixelRatio || 1);

function canvas(w: number, h: number, caption: string, host: HTMLElement) {
  const fig = document.createElement("figure");
  const c = document.createElement("canvas");
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const cap = document.createElement("div");
  cap.textContent = caption;
  fig.append(c, cap);
  host.append(fig);
  const ctx = c.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function section(title: string, light = false) {
  const h = document.createElement("h2");
  h.textContent = title;
  const row = document.createElement("div");
  row.className = light ? "row light" : "row";
  out.append(h, row);
  return row;
}

// 0. At the design's own scale (u = 1), to lay over roni-docs/diseno/roni.svg.
if (location.search.includes("reference")) {
  const row = section("Reference scale (600 × 500, the SVG's own box)");
  const ctx = canvas(600, 500, "calm, u = 1", row);
  ctx.save();
  ctx.translate(300, 432);
  drawRoniShadow(ctx, 1);
  ctx.restore();
  ctx.translate(300, 290);
  drawRoni(ctx, 1, { ...NEUTRAL_POSE, time: 1 }, deviceRatio());
}

// 1. The faces, big.
{
  const row = section("Faces — body 220 px");
  for (const face of FACES) {
    const ctx = canvas(300, 300, face, row);
    const u = 220 / 300;
    ctx.translate(150, 150 + 15.5 * u);
    drawRoniShadow(ctx, u);
    ctx.translate(0, 0);
    drawRoni(ctx, u, { ...NEUTRAL_POSE, face, mouth: 0.8, time: 1.3 }, deviceRatio());
  }
}

// 2. Sizes, calm and happy, on dark and light.
for (const light of [false, true]) {
  const row = section(light ? "Sizes on light" : "Sizes on dark (the island)", light);
  for (const w of [340, 180, 100, 60, 44, 30, 22, 14]) {
    for (const face of ["calm", "thinking"] as Face[]) {
      const side = Math.max(24, Math.round(w * 1.3));
      const ctx = canvas(side, side, `${w}px ${face}`, row);
      const u = w / 300;
      ctx.translate(side / 2, side / 2 + 15.5 * u);
      drawRoni(ctx, u, { ...NEUTRAL_POSE, face, time: 1 }, deviceRatio());
    }
  }
}

// 3. Pills: tinted minis.
{
  const row = section("Mini pills (tinted)");
  for (const color of [[0.231, 0.62, 1], [0.204, 0.831, 0.6], [0.957, 0.314, 0.369], [0.545, 0.361, 0.965], [0.961, 0.647, 0.141], [0.88, 0.47, 0.31]] as const) {
    for (const w of [60, 30, 18]) {
      const side = Math.round(w * 1.4);
      const ctx = canvas(side, side, `${w}px`, row);
      const u = w / 300;
      ctx.translate(side / 2, side / 2 + 15.5 * u);
      drawRoni(ctx, u, { ...NEUTRAL_POSE, tint: color, time: 1 }, deviceRatio());
    }
  }
}

// 4. Through the engine: states and the squish, at the island's size.
{
  const row = section("Engine states (live pose, frozen)");
  for (const state of ["idle", "working", "approval", "question", "error", "finished", "sleeping", "ratelimit"] as const) {
    const e = new BotEngine();
    e.setState(state, true);
    for (let i = 0; i < 30; i++) e.update(1 / 30);
    const ctx = canvas(160, 180, state, row);
    e.draw(ctx, 160, 180);
  }
}
