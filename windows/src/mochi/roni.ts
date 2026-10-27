// Roni, drawn in code — the "bombón" of roni-docs/diseno/roni.svg, in Canvas 2D.
//
// Everything is in the SVG's own units (the body is 300 wide, 284 tall, centred
// on the origin, y down) and scaled by `u`, the pixels of one unit: the same
// drawing serves the island's 20 px Roni and the 340 px one of the Roni window.
// What cannot be seen is left out as Roni gets small ("si un detalle no se distingue
// en chico, se simplifica en ese tamaño", roni-docs/diseno/personaje.md): under 60 px
// of body the ribs of the hat and the curve of the base; under 30 px also the bevel,
// the shine, the outline, the hat's band, the eyes' highlights and the thought
// bubbles; under 18 px the mouth. The eyes grow instead, so they stay visible.
//
// The motion lives in engine.ts (squash and stretch, blinking, the faces); this
// file only knows how to paint one pose.

export type RGB = readonly [number, number, number]; // components 0…1

/** The expressions of personaje.md. */
export type Face = "calm" | "happy" | "thinking" | "surprised" | "talking" | "sleeping" | "alert";

export interface RoniPose {
  face: Face;
  /** The eyes' opening: 1 open … 0.1 (a blink). */
  open: number;
  /** Where the eyes look, −1…1 (right, up). */
  lookX: number;
  lookY: number;
  /** The mouth's opening while talking, 0…1. */
  mouth: number;
  /** 1 = the design's eyes. */
  eyeScale: number;
  /** A colour the body takes (a pill's, the update blue); null = the cream of the design. */
  tint: RGB | null;
  /** 0 = Roni, 1 = a box (the file drop): the hat fades out as it rises. */
  morph: number;
  /** Seconds, for the thought bubbles. */
  time: number;
}

export const NEUTRAL_POSE: RoniPose = {
  face: "calm", open: 1, lookX: 0, lookY: 0, mouth: 0, eyeScale: 1, tint: null, morph: 0, time: 0,
};

// ── The design (roni.svg, relative to the body's centre) ──────────────────────

/** The body: a superellipse, exponent 2.7, half-axes 150 × 142. */
export const BODY_A = 150;
export const BODY_B = 142;
const EXPONENT = 2.7;
/** The hat's dome is a slightly bigger superellipse. */
const CAP_A = 156;
const CAP_B = 148;

/** From the pompom's top to the body's bottom, and where the floor shadow sits. */
export const FIGURE_TOP = -173;
export const FIGURE_BOTTOM = BODY_B;
export const SHADOW_Y = 158;

const INK = "#1E1E1E";

const CREAM: readonly RGB[] = [[1, 1, 1], [0.988, 0.973, 0.945], [0.933, 0.89, 0.827]]; // #FFF #FCF8F1 #EEE3D3
const OUTLINE: RGB = [0.847, 0.8, 0.729]; // #D8CCBA
const BEVEL_BASE: RGB = [0.839, 0.776, 0.682]; // #D6C6AE
const BEVEL_SIDE: RGB = [0.89, 0.835, 0.753]; // #E3D5C0
const BASE_CURVE: RGB = [0.886, 0.839, 0.769]; // #E2D6C4

// ── Small helpers ─────────────────────────────────────────────────────────────

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

const rgba = (c: RGB, a = 1) =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** How much of a pill's colour the cream takes: enough to tell the pills apart, not enough to lose Roni. */
const TINT_AMOUNT = 0.62;

function tinted(c: RGB, tint: RGB | null, dark = 0): RGB {
  if (!tint) return c;
  return mix(c, mix(tint, [0, 0, 0], dark), TINT_AMOUNT);
}

/** A (blurred) ellipse as a few stacked ones: cheap, and right at any aspect. */
const GROW: Record<2 | 3 | 4, readonly number[]> = {
  4: [1.6, 0.8, 0, -0.8],
  3: [1.2, 0.4, -0.4],
  2: [1.0, -0.3],
};

function soft(
  x: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number,
  color: string, alpha: number, sigma: number, layers: 2 | 3 | 4 = 4, fscale = 0,
) {
  x.save();
  // A real Gaussian blur where the canvas has one (its radius is in device pixels,
  // not in the design's units); stacked ellipses where it has not.
  if (fscale > 0 && "filter" in x) {
    x.filter = `blur(${(sigma * fscale).toFixed(2)}px)`;
    x.fillStyle = color;
    x.globalAlpha *= alpha;
    x.beginPath();
    x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    x.fill();
    x.restore();
    return;
  }
  const grow = GROW[layers];
  x.fillStyle = color;
  x.globalAlpha *= (alpha * 1.15) / grow.length;
  for (const k of grow) {
    const w = rx + k * sigma;
    const h = ry + k * sigma;
    if (w <= 0.5 || h <= 0.5) continue;
    x.beginPath();
    x.ellipse(cx, cy, w, h, 0, 0, Math.PI * 2);
    x.fill();
  }
  x.restore();
}

// ── Shapes (cached; built on first use so tests without a canvas can import this) ─

interface Shapes {
  body: Path2D;
  cap: Path2D;
  capClip: Path2D;
  cuffClip: Path2D;
}

let shapes: Shapes | null = null;

function superellipse(a: number, b: number, n: number, steps = 72): Path2D {
  const p = new Path2D();
  const e = 2 / n;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const px = a * Math.sign(c) * Math.pow(Math.abs(c), e);
    const py = b * Math.sign(s) * Math.pow(Math.abs(s), e);
    if (i === 0) p.moveTo(px, py);
    else p.lineTo(px, py);
  }
  p.closePath();
  return p;
}

function getShapes(): Shapes {
  if (!shapes) {
    shapes = {
      body: superellipse(BODY_A, BODY_B, EXPONENT),
      cap: superellipse(CAP_A, CAP_B, EXPONENT),
      // What of the dome stays above the hat's lower edge, and the band between the two curves.
      capClip: new Path2D("M-200 -230 L200 -230 L200 -45 L170 -45 Q0 -78 -170 -45 L-200 -45 Z"),
      cuffClip: new Path2D("M-170 -85 Q0 -118 170 -85 L170 -45 Q0 -78 -170 -45 Z"),
    };
  }
  return shapes;
}

/** The body outline for a given morph (0 = Roni, 1 = box), in the design's units. */
export function bodyPath(morph = 0): Path2D {
  if (morph < 0.005) return getShapes().body;
  const k = 1 - 0.04 * morph;
  return superellipse(BODY_A * k, BODY_B * k, EXPONENT + (5.5 - EXPONENT) * morph, 96);
}

// ── The pieces ────────────────────────────────────────────────────────────────

/** The device's pixel ratio as the app uses it (never above 2). */
export function deviceRatio(): number {
  const r = (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
  return Math.min(2, r && r > 0 ? r : 1);
}

/** Detail level of a body `w` pixels wide: 0 tiny, 1 small, 2 full. */
export function detailFor(w: number): 0 | 1 | 2 {
  return w >= 60 ? 2 : w >= 30 ? 1 : 0;
}

/**
 * The shadow on the floor under Roni, centred where the body's base is. `spread`
 * widens it with the squash, `lift` (0…1) shrinks and fades it while Roni jumps.
 */
export function drawRoniShadow(x: CanvasRenderingContext2D, u: number, spread = 1, lift = 0) {
  // A radial gradient squashed into an ellipse, not a blur filter: this is drawn every
  // frame of every Roni on screen, and a filter makes the GPU work for each one.
  const rx = (135 + 16) * spread * (1 - 0.35 * lift);
  const ry = (16 + 16) * (1 - 0.4 * lift);
  x.save();
  x.scale(u, u);
  x.translate(0, 16);
  x.scale(1, ry / rx);
  const g = x.createRadialGradient(0, 0, 0, 0, 0, rx);
  const a = 0.18 * clamp(1 - lift * 1.2, 0, 1);
  g.addColorStop(0, `rgba(0,0,0,${a})`);
  g.addColorStop(0.5, `rgba(0,0,0,${a * 0.8})`);
  g.addColorStop(0.8, `rgba(0,0,0,${a * 0.28})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = g;
  x.beginPath();
  x.arc(0, 0, rx, 0, Math.PI * 2);
  x.fill();
  x.restore();
}

function drawBody(x: CanvasRenderingContext2D, t: RGB | null, detail: number, body: Path2D, fscale: number) {
  const g = x.createLinearGradient(0, -BODY_B, 0, BODY_B);
  g.addColorStop(0, rgba(tinted(CREAM[0], t)));
  g.addColorStop(0.55, rgba(tinted(CREAM[1], t)));
  g.addColorStop(1, rgba(tinted(CREAM[2], t, 0.15)));
  x.fillStyle = g;
  x.fill(body);

  if (detail >= 1) {
    x.save();
    x.clip(body);
    const layers = detail >= 2 ? 4 : 2;
    const shineLayers = detail >= 2 ? 3 : 2;
    // The bevel: soft shade at the sides and the base.
    soft(x, 0, 165, 190, 60, rgba(tinted(BEVEL_BASE, t, 0.2)), 0.55, 14, layers, fscale);
    soft(x, -160, 30, 22, 110, rgba(tinted(BEVEL_SIDE, t, 0.1)), 0.5, 14, layers, fscale);
    soft(x, 160, 30, 22, 110, rgba(tinted(BEVEL_SIDE, t, 0.1)), 0.5, 14, layers, fscale);
    // The shine, up on the left.
    soft(x, -85, -5, 34, 20, "#FFFFFF", 0.95, 4, shineLayers, fscale);
    if (detail >= 2) {
      x.beginPath();
      x.moveTo(-160, 110);
      x.quadraticCurveTo(0, 158, 160, 110);
      x.strokeStyle = rgba(tinted(BASE_CURVE, t, 0.1), 0.8);
      x.lineWidth = 2.5;
      x.stroke();
    }
    x.restore();
  }

  if (detail >= 1) {
    x.strokeStyle = rgba(tinted(OUTLINE, t, 0.1));
    x.lineWidth = 2;
    x.stroke(body);
  }
}

function drawHat(x: CanvasRenderingContext2D, detail: number, alpha: number, fscale: number) {
  const s = getShapes();
  x.save();
  x.globalAlpha *= alpha;

  // The dome.
  x.save();
  x.clip(s.capClip);
  const cap = x.createLinearGradient(0, -CAP_B, 0, CAP_B);
  cap.addColorStop(0, "#454545");
  cap.addColorStop(1, "#1C1C1C");
  x.fillStyle = cap;
  x.fill(s.cap);
  if (detail >= 1) soft(x, -70, -125, 45, 10, "#FFFFFF", 0.18, 4, 2, fscale);
  x.restore();

  // The folded band.
  if (detail >= 1) {
    x.save();
    x.clip(s.cuffClip);
    const cuff = x.createLinearGradient(0, -CAP_B, 0, CAP_B);
    cuff.addColorStop(0, "#2A2A2A");
    cuff.addColorStop(1, "#0E0E0E");
    x.fillStyle = cuff;
    x.fill(s.cap);
    x.restore();
  }
  if (detail >= 2) {
    // Its ribs: lines that follow the curve of the band.
    x.strokeStyle = "#3C3C3C";
    x.lineWidth = 3.5;
    x.lineCap = "round";
    x.beginPath();
    for (let px = -130; px <= 130; px += 26) {
      const y1 = -96.5 + px * px * 0.000568;
      x.moveTo(px, y1);
      x.lineTo(px, y1 + 30);
    }
    x.stroke();
  }

  // The pompom.
  const pom = x.createRadialGradient(-5.04, -159.56, 0, -5.04, -159.56, 31.5);
  pom.addColorStop(0, "#6A6A6A");
  pom.addColorStop(1, "#1E1E1E");
  x.fillStyle = pom;
  x.beginPath();
  x.arc(0, -152, 21, 0, Math.PI * 2);
  x.fill();
  x.restore();
}

// ── The face ──────────────────────────────────────────────────────────────────

const EYE_X = 32;
const EYE_Y = 20;
const EYE_W = 20;
const EYE_H = 40;

function pill(x: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number) {
  const r = Math.min(w, h) / 2;
  x.beginPath();
  x.roundRect(cx - w / 2, cy - h / 2, w, h, r);
  x.fill();
}

function drawBubbles(x: CanvasRenderingContext2D, time: number) {
  // Thought bubbles up and to the right, growing one after the other.
  const spec = [[142, -108, 5], [166, -136, 7.5], [196, -172, 11]] as const;
  x.save();
  x.strokeStyle = rgba(OUTLINE);
  x.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const [bx, by, r] = spec[i];
    const pulse = 1 + 0.12 * Math.sin(time * 2.2 - i * 0.9);
    x.fillStyle = "#FFFFFF";
    x.beginPath();
    x.arc(bx, by - 2 * Math.sin(time * 1.6 - i), r * pulse, 0, Math.PI * 2);
    x.fill();
    x.stroke();
  }
  x.restore();
}

function drawFace(x: CanvasRenderingContext2D, p: RoniPose, detail: number, u: number) {
  const m = clamp(p.morph, 0, 1);
  const face = p.face;
  // Eyes and mouth slide a little with the look, the mouth less than the eyes.
  const lx = p.lookX * 9;
  const ly = -p.lookY * 6;
  // Small Ronis get bigger eyes: ~3.4 px of height at least.
  const boost = Math.max(1, 3.4 / (EYE_H * u));
  let es = p.eyeScale * (face === "surprised" ? 1.3 : face === "alert" ? 1.14 : 1);
  es *= boost;
  const shiftY = face === "thinking" ? -12 : 0;
  const ex = lx + (face === "thinking" ? 6 : 0);
  const ey = EYE_Y + ly + shiftY + 16 * m;
  const open = clamp(p.open, 0.1, 1);

  x.fillStyle = INK;
  x.strokeStyle = INK;
  x.lineCap = "round";
  const lw = Math.max(1, 1.15 / u);

  for (const sd of [-1, 1]) {
    const cx = sd * EYE_X * (1 + 0.04 * (es - 1)) + ex;
    switch (face) {
      case "happy": {
        x.lineWidth = Math.max(6.5, lw * 1.6) * Math.min(1.4, es);
        x.beginPath();
        x.arc(cx, ey + 6, 11 * Math.min(1.5, es), Math.PI, Math.PI * 2);
        x.stroke();
        break;
      }
      case "sleeping": {
        x.lineWidth = Math.max(6, lw * 1.5) * Math.min(1.4, es);
        x.beginPath();
        x.arc(cx, ey - 4, 11 * Math.min(1.5, es), 0, Math.PI);
        x.stroke();
        break;
      }
      default: {
        const w = EYE_W * es;
        const h = EYE_H * es * open;
        pill(x, cx, ey, w, Math.max(h, w * 0.5));
        if (detail >= 1 && open > 0.55) {
          x.fillStyle = "#FFFFFF";
          x.beginPath();
          x.arc(cx - 4 * es, ey - 12 * es * open, 3.5 * Math.min(1.6, es), 0, Math.PI * 2);
          x.fill();
          x.fillStyle = INK;
        }
      }
    }
  }

  if (m > 0.3) return; // the box has a slot, not a mouth
  // Under ~18 px of body the mouth would only blur into the eyes: two eyes read better.
  if (300 * u < 18) return;
  x.save();
  x.globalAlpha *= clamp(1 - m * 3, 0, 1);
  // Small Ronis get a wider mouth, as they get bigger eyes.
  const grow = clamp(2.8 / (24 * u), 1, 1.8);
  const mx = lx * 0.5;
  const my = ly * 0.5 + 66;
  x.translate(mx, my);
  x.scale(grow, grow);
  x.translate(-mx, -my);
  drawMouth(x, p, mx, ly * 0.5, lw / grow);
  x.restore();
}

function calmSmile(x: CanvasRenderingContext2D, mx: number, my: number) {
  x.beginPath();
  x.moveTo(mx - 12, my + 64);
  x.quadraticCurveTo(mx, my + 74, mx + 12, my + 64);
  x.stroke();
}

function drawMouth(x: CanvasRenderingContext2D, p: RoniPose, mx: number, my: number, lw: number) {
  x.lineWidth = Math.max(4.5, lw * 1.2);
  switch (p.face) {
    case "happy": {
      // An open smile.
      x.beginPath();
      x.moveTo(mx - 17, my + 59);
      x.quadraticCurveTo(mx, my + 92, mx + 17, my + 59);
      x.closePath();
      x.fill();
      x.stroke();
      return;
    }
    case "surprised": {
      x.beginPath();
      x.ellipse(mx, my + 68, 9, 11, 0, 0, Math.PI * 2);
      x.fill();
      return;
    }
    case "alert": {
      x.beginPath();
      x.ellipse(mx, my + 67, 6, 7, 0, 0, Math.PI * 2);
      x.fill();
      return;
    }
    case "thinking": {
      x.beginPath();
      x.moveTo(mx + 2, my + 66);
      x.lineTo(mx + 22, my + 66);
      x.stroke();
      return;
    }
    case "sleeping": {
      x.lineWidth = Math.max(3.5, lw);
      x.beginPath();
      x.moveTo(mx - 7, my + 64);
      x.quadraticCurveTo(mx, my + 69, mx + 7, my + 64);
      x.stroke();
      return;
    }
    case "talking": {
      if (p.mouth > 0.06) {
        const ry = 3 + 13 * clamp(p.mouth, 0, 1);
        x.beginPath();
        x.ellipse(mx, my + 62 + ry * 0.45, 12, ry, 0, 0, Math.PI * 2);
        x.fill();
        return;
      }
      calmSmile(x, mx, my);
      return;
    }
    default:
      calmSmile(x, mx, my);
  }
}

// ── The whole Roni ────────────────────────────────────────────────────────────

/** The part of the design that never moves on its own (body and hat) as one picture. */
const BOX_X = -178;
const BOX_Y = -178;
const BOX_W = 356;
const BOX_H = 330;

function paintStatic(x: CanvasRenderingContext2D, tint: RGB | null, morph: number, detail: number, fscale: number) {
  drawBody(x, tint, detail, bodyPath(morph), fscale);
  const hat = clamp(1 - morph * 1.8, 0, 1);
  if (hat > 0.01) drawHat(x, detail, hat, fscale);
}

const sprites = new Map<string, HTMLCanvasElement>();

/**
 * Body and hat painted once per (size, colour) and drawn as an image every
 * frame: the blurred bevel is then paid once, not sixty times a second.
 */
function sprite(scale: number, tint: RGB | null, detail: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const q = Math.round(Math.log2(scale) * 8);
  const s = Math.pow(2, q / 8);
  const w = Math.ceil(BOX_W * s);
  const h = Math.ceil(BOX_H * s);
  if (w > 2400 || h > 2400) return null;
  const key = `${q}|${detail}|${tint ? tint.map((v) => Math.round(v * 255)).join(",") : "-"}`;
  let c = sprites.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    if (!g) return null;
    g.scale(s, s);
    g.translate(-BOX_X, -BOX_Y);
    paintStatic(g, tint, 0, detail, s);
    if (sprites.size >= 48) sprites.delete(sprites.keys().next().value as string);
    sprites.set(key, c);
  }
  return c;
}

/**
 * Paints Roni with the body's centre at the origin and `u` pixels per unit of the
 * design (the body is 300 u wide). The caller places, tilts and squashes the
 * context first; the floor shadow is `drawRoniShadow`'s.
 */
export function drawRoni(x: CanvasRenderingContext2D, u: number, pose: RoniPose, dpr = 1) {
  const detail = detailFor(300 * u);
  const m = clamp(pose.morph, 0, 1);

  x.save();
  x.scale(u, u);
  const picture = m < 0.005 ? sprite(u * dpr, pose.tint, detail) : null;
  if (picture) {
    // The picture is within ~9 % of the size it is drawn at: plain bilinear is enough
    // ("high" makes Chromium resample on the CPU, every frame).
    x.drawImage(picture, BOX_X, BOX_Y, BOX_W, BOX_H);
  } else {
    paintStatic(x, pose.tint, m, detail, u * dpr);
  }
  drawFace(x, pose, detail, u);
  if (pose.face === "thinking" && detail >= 1 && m < 0.1) drawBubbles(x, pose.time);
  x.restore();
}
