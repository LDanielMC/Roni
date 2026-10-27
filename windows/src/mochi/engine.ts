// Roni's engine: what Roni does (the faces, the jelly motion, the particles,
// the badge) and when. The painting itself is roni.ts. This file used to be a
// port of the original app's BotEngine; the API the island, the desktop, the
// pill and the pages call is the same, the character behind it is Roni's
// (roni-docs/diseno/personaje.md).
//
// Jelly: squash and stretch around the body's base (the "feet"), so Roni
// settles on the floor instead of shrinking around his middle.

import { Ease, type EaseFn } from "../core/anim";
import { Sound } from "../core/sound";
import type { BotEmoteName, BotStateName } from "../core/layout";
import type { Outfit } from "./wardrobe";
import {
  BODY_A, BODY_B, FIGURE_BOTTOM, FIGURE_TOP, bodyPath, detailFor, deviceRatio, drawRoni, drawRoniShadow,
  type Face, type RGB, type RoniPose,
} from "./roni";

export type { Face, RGB };

/** Kept for the pages that name a mini's face; the faces are Roni's now. */
export type EyeShape = Face;

export type BadgeKind = "dots" | "bang" | "question" | "dot" | "arrow";

export interface Badge {
  kind: BadgeKind;
  color: RGB;
}

export type TweenKey = readonly [target: number, durationMs: number, ease: EaseFn];

interface Tween {
  prop: PropKey;
  keys: TweenKey[];
  index: number;
  from: number;
  startMs: number;
  onComplete?: () => void;
}

type PropKey =
  | "yaw" | "pitch" | "tilt" | "open" | "sx" | "sy"
  | "oy" | "ox" | "morph" | "es" | "badgeS";

interface BotStateCfg {
  face: Face;
  badge: Badge | null;
  /** A small side-to-side shake now and then, until the user answers. */
  tremble: boolean;
  scans: boolean;
  /** Slower, deeper breathing. */
  sleepy: boolean;
  zz: boolean;
  sweat: boolean;
  /** Looks at the user, not where the pointer is. */
  forward: boolean;
  tilt: number;
}

interface Particle {
  type: "heart" | "star" | "spark" | "sweat" | "z";
  x: number; y: number; vx: number; vy: number;
  age: number; life: number; rot: number; size: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Colours of the badges (and of the states' halo on the island). */
const C = {
  working: [0.231, 0.62, 1] as RGB,
  thinking: [0.545, 0.361, 0.965] as RGB,
  searching: [0.388, 0.396, 0.949] as RGB,
  approval: [0.961, 0.647, 0.141] as RGB,
  question: [0.133, 0.827, 0.933] as RGB,
  error: [0.957, 0.314, 0.369] as RGB,
  finished: [0.204, 0.831, 0.6] as RGB,
  ratelimit: [0.984, 0.573, 0.235] as RGB,
};

const base = {
  tremble: false, scans: false, sleepy: false, zz: false, sweat: false, forward: false, tilt: 0,
};

/** Which face goes with what the agents are doing. */
export const BOT_STATES: Record<BotStateName, BotStateCfg> = {
  idle: { ...base, face: "calm", badge: null },
  working: { ...base, face: "thinking", badge: { kind: "dots", color: C.working } },
  thinking: { ...base, face: "thinking", badge: { kind: "dots", color: C.thinking } },
  searching: { ...base, face: "thinking", badge: { kind: "dots", color: C.searching }, scans: true },
  approval: { ...base, face: "alert", badge: { kind: "bang", color: C.approval }, tremble: true, forward: true },
  question: { ...base, face: "alert", badge: { kind: "question", color: C.question }, forward: true, tilt: 0.12 },
  error: { ...base, face: "surprised", badge: { kind: "dot", color: C.error } },
  finished: { ...base, face: "happy", badge: { kind: "dot", color: C.finished } },
  ratelimit: { ...base, face: "thinking", badge: { kind: "dot", color: C.ratelimit }, sweat: true },
  sleeping: { ...base, face: "sleeping", badge: null, sleepy: true, zz: true },
  dizzy: { ...base, face: "surprised", badge: null },
};

/** State → sound. Roni ships none (windows/sounds/): a file of the user's own plays. */
export const STATE_SOUND: Partial<Record<BotStateName, string>> = {
  working: "work", thinking: "think", searching: "search", approval: "approval",
  question: "question", error: "error", finished: "finish", ratelimit: "rate",
  sleeping: "sleep", dizzy: "dizzy",
};

/** The emotes the pages ask for, in Roni's faces (null: no face of its own, just the motion). */
const EMOTE_FACE: Record<BotEmoteName, Face | null> = {
  love: "happy", surprised: "surprised", proud: "happy", wink: "happy",
  yawn: "sleeping", happy: "happy", annoyed: null,
};

/** States where Roni may open his mouth to talk. */
const CAN_TALK = new Set<BotStateName>(["idle", "working", "thinking", "searching", "finished", "error", "ratelimit"]);

/** Where one unit of the design sits on the canvas: the body is `0.684 W` wide, as before. */
const BODY_HALF_W = 0.342;

// ── Small helpers ─────────────────────────────────────────────────────────────

const now = () => performance.now() / 1000;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function hexToRGB(hex: string): RGB {
  const h = hex.replace("#", "");
  const v = parseInt(h, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

const rgba = (c: RGB, a = 1) =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

function roundRectPath(x: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, R: number) {
  const r = Math.max(0, Math.min(R, W / 2, H / 2));
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + W, Y, X + W, Y + H, r);
  x.arcTo(X + W, Y + H, X, Y + H, r);
  x.arcTo(X, Y + H, X, Y, r);
  x.arcTo(X, Y, X + W, Y, r);
  x.closePath();
}

function heartPath(x: CanvasRenderingContext2D, s: number) {
  x.beginPath();
  x.moveTo(0, s * 0.38);
  x.bezierCurveTo(-s * 1.05, -s * 0.15, -s * 0.5, -s * 0.95, 0, -s * 0.38);
  x.bezierCurveTo(s * 0.5, -s * 0.95, s * 1.05, -s * 0.15, 0, s * 0.38);
  x.closePath();
}

function starPath(x: CanvasRenderingContext2D, ro: number, ri: number) {
  x.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? ri : ro;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  x.closePath();
}

const FONT = `system-ui, "Segoe UI Variable Text", "Segoe UI", sans-serif`;

// ── Dance ─────────────────────────────────────────────────────────────────────

/** The dance fades in over 0.3 s and out over 0.5 s. */
export function stepDanceLevel(level: number, dancing: boolean, dt: number): number {
  const target = dancing ? 1 : 0;
  if (level < target) return Math.min(target, level + dt / 0.3);
  if (level > target) return Math.max(target, level - dt / 0.5);
  return level;
}

/**
 * The 112-BPM bounce at `seconds`, for a body of radius R and a dance `level`
 * (0…1): a sideways sway, a hop, a tilt, and a squash on landing.
 */
export function danceTransform(seconds: number, level: number, R: number) {
  const beat = (seconds * 112) / 60;
  const hop = Math.abs(Math.sin(Math.PI * beat));
  const land = Math.pow(1 - hop, 6);
  return {
    dx: 0.08 * R * Math.sin(Math.PI * beat) * level,
    dy: -0.2 * R * hop * level,
    rotate: 0.1 * Math.sin(Math.PI * beat) * level,
    sx: 1 + 0.045 * land * level,
    sy: 1 - 0.06 * land * level,
  };
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class BotEngine {
  isMini = false;
  /** A colour the body takes (mini pills, the focused pill, the update blue); null = Roni's cream. */
  bodyColor: RGB | null = null;
  /**
   * A new version waits (whats-new/whats-new.ts): while Roni is idle or asleep
   * he wears the up-arrow badge. The island turns his body blue alongside.
   */
  private updateHint: RGB | null = null;

  // Animated values
  yaw = 0; pitch = 0; tilt = 0; open = 1;
  sx = 1; sy = 1; oy = 0; ox = 0;
  morph = 0; es = 1; badgeS = 0;

  // Targets
  tgYaw = 0; tgPitch = 0; tgTilt = 0; tgSy = 1; tgSx = 1; tgEs = 1;

  /** Extra canvas height above the body so hearts can fly out without clipping. */
  particleOverhang = 0;

  /** Draws Roni's own shadow on the floor; a page that draws its own turns it off. */
  floorShadow = true;

  /** Dancing to music; `dancingLevel` follows it, 0→1 in 0.3 s, 1→0 in 0.5 s. */
  isDancing = false;
  dancingLevel = 0;

  // The file drop's slot: a spring (fraction of the box's size)
  slotH = 0; slotHTarget = 0; slotHVel = 0; isChewing = false;

  state: BotStateName = "idle";
  cfg: BotStateCfg = BOT_STATES.idle;

  /** Roni talks: his mouth opens and closes (the chat's answer, the voice). */
  speaking = false;
  private mouthLevel = 0;

  faceOverride: Face | null = null;
  faceOverrideUntil = 0;
  permanentFace: Face | null = null;
  permanentEmote: BotEmoteName | null = null;
  miniNextBehavior = 0;

  badge: Badge | null = null;
  private badgeKey = "none";
  private badgeToken = 0;

  private tweens = new Map<PropKey, Tween>();
  private locks = new Set<PropKey>();
  private particles: Particle[] = [];

  lookX = 0;
  lookY = 0;

  lastTime = now();
  private t0 = now() - Math.random() * 5;
  private nextBlink = now() + 1.5 + Math.random() * 2;
  waveUntil = 0;
  waveStart = 0;
  private greetToken = 0;
  private lastAmbient = 0;
  private slapTimes: number[] = [];
  private miniLookTarget = { x: 0, y: 0 };
  private miniLookNextTime = 0;

  /** Fired when three slaps land inside 1.7 s (→ dizzy + confused view). */
  onDizzy: (() => void) | null = null;

  // ── Public API ──────────────────────────────────────────────────────────────

  setState(next: BotStateName, force = false) {
    if (this.state === next && !force) return;
    const prev = this.state;
    this.state = next;
    this.cfg = BOT_STATES[next];
    if (!this.locks.has("tilt")) this.tgTilt = this.cfg.tilt;
    this.setBadge(this.stateBadge());

    switch (next) {
      case "finished":
        this.jump();
        setTimeout(() => this.emit("spark", 5), 500);
        break;
      case "error":
        this.anim("ox", [
          [0.08, 50, Ease.out], [-0.08, 70, Ease.inOut],
          [0.05, 70, Ease.inOut], [0, 90, Ease.out],
        ]);
        break;
      case "approval":
        this.anim("oy", [[-0.2, 150, Ease.out], [0, 300, Ease.back]]);
        break;
      case "dizzy":
        this.anim("tilt", [
          [0.2, 120, Ease.out], [-0.2, 200, Ease.inOut], [0.16, 200, Ease.inOut],
          [-0.12, 200, Ease.inOut], [0.06, 200, Ease.inOut], [0, 260, Ease.out],
        ]);
        break;
      case "question":
        this.blink();
        break;
      case "ratelimit":
        this.emit("sweat", 1);
        break;
      default:
        if (prev !== "idle" || next !== "idle") this.blink();
    }
  }

  /** The update badge (blue arrow) while one waits, else nothing. Asked every frame; cheap. */
  setUpdateHint(color: RGB | null) {
    const was = this.updateHint;
    const same = color === was || (color != null && was != null && color.every((c, i) => c === was[i]));
    if (same) return;
    this.updateHint = color;
    this.setBadge(this.stateBadge());
  }

  /** Whether the update hint shows now: only over an idle or sleeping Roni. */
  get showsUpdateHint(): boolean {
    return this.updateHint != null && (this.state === "idle" || this.state === "sleeping");
  }

  private stateBadge(): Badge | null {
    if (this.showsUpdateHint && this.updateHint) return { kind: "arrow", color: this.updateHint };
    return this.cfg.badge;
  }

  setBadge(b: Badge | null) {
    const key = b ? `${b.kind}-${b.color.join(",")}` : "none";
    if (key === this.badgeKey) return;
    this.badgeKey = key;
    const tok = ++this.badgeToken;
    this.anim("badgeS", [[0, 90, Ease.inOut]]);
    setTimeout(() => {
      if (tok !== this.badgeToken) return;
      this.badge = b;
      if (b) this.anim("badgeS", [[1, 280, Ease.back]]);
    }, 100);
  }

  /** The eyes drop to a sliver for an instant (personaje.md: vertical scale 0.1). */
  blink() {
    if (this.locks.has("open")) return;
    this.anim("open", [[0.1, 70, Ease.inOut], [1, 130, Ease.out]]);
  }

  /** A short squash, for landings and small knocks. */
  squash() {
    this.anim("sy", [[0.78, 70, Ease.out], [1.1, 130, Ease.out], [1, 170, Ease.inOut]]);
    this.anim("sx", [[1.16, 70, Ease.out], [0.95, 130, Ease.out], [1, 170, Ease.inOut]]);
  }

  /** "Apachurrar" (a click): 0.9 s of wobble, always around the base. */
  squish() {
    this.anim("sx", [
      [1.28, 130, Ease.out], [0.85, 160, Ease.out], [1.1, 150, Ease.out],
      [0.95, 150, Ease.out], [1.03, 150, Ease.out], [1, 160, Ease.out],
    ]);
    this.anim("sy", [
      [0.72, 130, Ease.out], [1.15, 160, Ease.out], [0.9, 150, Ease.out],
      [1.05, 150, Ease.out], [0.97, 150, Ease.out], [1, 160, Ease.out],
    ]);
  }

  /** The jump of "Claude Code finished": squash, stretch up, fall, squash, settle. */
  jump() {
    this.anim("sx", [
      [1.2, 110, Ease.out], [0.88, 260, Ease.out], [0.96, 240, Ease.easeIn],
      [1.22, 90, Ease.out], [1, 320, Ease.back],
    ]);
    this.anim("sy", [
      [0.8, 110, Ease.out], [1.14, 260, Ease.out], [1.04, 240, Ease.easeIn],
      [0.78, 90, Ease.out], [1, 320, Ease.back],
    ]);
    this.anim("oy", [
      [0, 110, Ease.lin], [-0.5, 260, Ease.out], [0, 240, Ease.easeIn],
      [0, 90, Ease.lin], [0, 320, Ease.lin],
    ]);
  }

  /** The file drop's swallow — the slot opens, chews, then closes. */
  gulp() {
    this.slotHTarget = 0.42;
    setTimeout(() => {
      this.slotHTarget = 0;
      this.isChewing = true;
      setTimeout(() => { this.isChewing = false; }, 800);
    }, 460);
    this.anim("sy", [[0.78, 80, Ease.out], [1.18, 130, Ease.out], [1, 220, Ease.back]]);
    this.anim("sx", [[1.28, 80, Ease.out], [0.92, 130, Ease.out], [1, 220, Ease.back]]);
    this.blink();
  }

  slap() {
    this.interruptGreet();
    if (this.state === "dizzy") return;
    const t = now();
    this.slapTimes = this.slapTimes.filter((s) => t - s < 1.7);
    this.slapTimes.push(t);
    Sound.play("slap");
    this.squish();
    if (this.slapTimes.length >= 3) {
      this.slapTimes = [];
      this.onDizzy?.();
    } else {
      setTimeout(() => Sound.play("annoyed"), 60);
    }
  }

  /** The greeting at launch: a happy hop and a friendly wobble (Roni has no hands to wave). */
  greet() {
    const t = now();
    const tok = ++this.greetToken;
    this.waveStart = t + 0.45;
    this.waveUntil = t + 1.55;

    this.faceOverride = "happy";
    this.faceOverrideUntil = t + 2.0;
    this.anim("oy", [[-0.06, 220, Ease.out], [0.0, 220, Ease.back]]);

    setTimeout(() => {
      if (this.greetToken !== tok) return;
      this.anim("sy", [[0.95, 100, Ease.out], [1.0, 260, Ease.back]]);
      this.anim("sx", [[1.04, 100, Ease.out], [1.0, 260, Ease.back]]);
      Sound.play("greet");
    }, 250);

    setTimeout(() => { if (this.greetToken === tok) this.blink(); }, 550);
    setTimeout(() => { if (this.greetToken === tok) this.blink(); }, 1500);
    setTimeout(() => {
      if (this.greetToken !== tok) return;
      this.waveUntil = 0;
    }, 1550);
    setTimeout(() => {
      if (this.greetToken !== tok) return;
      this.faceOverride = "happy";
      this.faceOverrideUntil = now() + 0.3;
    }, 1750);
  }

  interruptGreet() {
    if (now() >= this.waveUntil) return;
    this.greetToken++;
    this.waveUntil = 0;
    this.waveStart = 0;
  }

  setPermanentEmote(emote: BotEmoteName | null) {
    this.permanentEmote = emote;
    if (emote === "wink") {
      this.miniNextBehavior = now() + 0.8 + Math.random() * 1.7;
      return;
    }
    this.setPermanentFace(emote ? EMOTE_FACE[emote] : null);
    this.miniNextBehavior = now() + 0.8 + Math.random() * 1.7;
  }

  /** A face that stays until another is asked for (a mini pill's mood). */
  setPermanentFace(face: Face | null) {
    this.permanentFace = face;
    if (face) {
      this.faceOverride = face;
      this.faceOverrideUntil = Number.POSITIVE_INFINITY;
    } else if (this.faceOverrideUntil === Number.POSITIVE_INFINITY) {
      this.faceOverride = null;
      this.faceOverrideUntil = 0;
    }
  }

  triggerEmote(emote: BotEmoteName, duration = 1.8) {
    const t = now();
    const face = EMOTE_FACE[emote];
    if (face) {
      this.faceOverride = face;
      this.faceOverrideUntil = t + duration;
    }

    switch (emote) {
      case "love":
        this.emit("heart", 4);
        this.anim("oy", [[-0.1, 160, Ease.out], [0, 300, Ease.back]]);
        break;
      case "surprised":
        this.anim("oy", [[-0.3, 140, Ease.out], [0, 380, Ease.back]]);
        this.anim("es", [[1.25, 120, Ease.out], [1, 500, Ease.inOut]]);
        break;
      case "proud":
        this.emit("star", 5);
        this.anim("tilt", [
          [-0.14, 220, Ease.out], [-0.14, (duration - 0.5) * 1000, Ease.lin], [0, 280, Ease.inOut],
        ]);
        break;
      case "wink":
        this.anim("tilt", [
          [0.12, 160, Ease.out], [0.12, (duration - 0.4) * 1000, Ease.lin], [0, 240, Ease.inOut],
        ]);
        break;
      case "yawn":
        this.faceOverride = null;
        this.anim("sy", [[1.08, 500, Ease.inOut], [1, 500, Ease.inOut]]);
        this.anim("sx", [[0.95, 500, Ease.inOut], [1, 500, Ease.inOut]]);
        setTimeout(() => {
          this.faceOverride = "sleeping";
          this.faceOverrideUntil = now() + Math.max(0.5, duration - 0.7);
          this.emit("z", 2);
        }, 700);
        break;
      case "happy":
        this.anim("oy", [[-0.08, 140, Ease.out], [0, 260, Ease.back]]);
        break;
      case "annoyed":
        this.squish();
        setTimeout(() => Sound.play("annoyed"), 60);
        break;
    }
  }

  emit(type: Particle["type"], count: number) {
    for (let i = 0; i < count; i++) {
      const isZ = type === "z";
      this.particles.push({
        type,
        x: (Math.random() - 0.5) * 0.9 + (isZ ? 0.55 : 0),
        y: -0.95 - Math.random() * 0.2,
        vx: (Math.random() - 0.5) * 0.35 + (isZ ? 0.18 : 0),
        vy: -(0.45 + Math.random() * 0.35),
        age: -i * 0.14,
        life: 1.3 + Math.random() * 0.5,
        rot: Math.random() * Math.PI * 2,
        size: 0.15 + Math.random() * 0.08,
      });
    }
  }

  animateMorph(target: number, durationMs?: number) {
    const dur = durationMs ?? (target > 0.5 ? 550 : 650);
    this.anim("morph", [[target, dur, Ease.inOut]]);
  }

  resetMorph() {
    this.tweens.delete("morph");
    this.locks.delete("morph");
    this.morph = 0;
  }

  /** Mochi's wardrobe is gone: the hat is part of Roni. Kept so the pages that ask keep working. */
  outfit: Outfit = "none";
  setOutfit(_next: Outfit, _animated = true) {
    this.outfit = "none";
  }

  /** True while anything is still moving — lets the island stop its RAF loop. */
  get busy(): boolean {
    // Roni breathes all the time, so a visible Roni is always moving.
    return true;
  }

  /**
   * True when the only thing going on is the breathing and the blinking: the
   * island may draw those at half the frame rate.
   */
  get ambientOnly(): boolean {
    // A blink is over before the next resting frame: it does not need its own frames.
    for (const k of this.tweens.keys()) if (k !== "open") return false;
    return (
      this.particles.length === 0 &&
      !this.isDancing && this.dancingLevel < 0.001 &&
      !this.cfg.tremble && !this.cfg.scans && !this.cfg.sweat && !this.cfg.zz &&
      !this.speaking && this.state !== "dizzy" &&
      this.slotH < 0.001 && Math.abs(this.slotHVel) < 0.001 &&
      // A mini wanders with his eyes all the time; the main one is following the pointer
      // while he is not settled, and that wants every frame.
      (this.isMini || (
        Math.abs(this.tgYaw - this.yaw) < 0.002 && Math.abs(this.tgPitch - this.pitch) < 0.002 &&
        Math.abs(this.tgTilt - this.tilt) < 0.002))
    );
  }

  // ── Tweens ──────────────────────────────────────────────────────────────────

  anim(prop: PropKey, keys: TweenKey[], onComplete?: () => void) {
    this.tweens.set(prop, {
      prop, keys, index: 0, from: this[prop], startMs: performance.now(), onComplete,
    });
    this.locks.add(prop);
  }

  // ── Update ──────────────────────────────────────────────────────────────────

  update(dt: number) {
    const n = now();
    const nowMs = performance.now();
    for (const tw of [...this.tweens.values()]) {
      const k = tw.keys[tw.index];
      const p = Math.min(1, Math.max(0, (nowMs - tw.startMs) / k[1]));
      this[tw.prop] = tw.from + (k[0] - tw.from) * k[2](p);
      if (p >= 1) {
        tw.from = k[0];
        tw.index += 1;
        tw.startMs = nowMs;
        if (tw.index >= tw.keys.length) {
          this.tweens.delete(tw.prop);
          this.locks.delete(tw.prop);
          tw.onComplete?.();
        }
      }
    }

    const t = n - this.t0;
    let ty = this.lookX * 0.62;
    let tp = this.lookY * 0.5;

    if (this.cfg.forward) { ty = 0; tp = 0; }
    if (this.cfg.scans) {
      ty = Math.sin(t * 2.6) * 0.6;
      tp = -0.06;
    }
    if (this.state === "sleeping") { ty = 0; tp = 0; }
    if (this.state === "dizzy") { ty = Math.sin(t * 9) * 0.25; }

    // Mini bots never follow the mouse — they wander.
    if (this.isMini && !this.cfg.scans && !this.cfg.forward && this.state !== "sleeping" && this.state !== "dizzy") {
      if (n > this.miniLookNextTime) {
        this.miniLookTarget = {
          x: -0.88 + Math.random() * 1.76,
          y: -0.55 + Math.random() * 1.0,
        };
        this.miniLookNextTime = n + 0.5 + Math.random() * 1.5;
      }
      ty = this.miniLookTarget.x * 0.62;
      tp = this.miniLookTarget.y * 0.5;
    }

    this.tgYaw = ty;
    this.tgPitch = tp;
    this.tgTilt = this.cfg.tilt;

    if (n > this.waveStart && n < this.waveUntil) {
      const wt = n - this.waveStart;
      this.tgTilt = -0.04 + Math.sin(2 * Math.PI * 1.2 * wt) * 0.07;
    }

    const kGen = 1 - Math.pow(0.0008, dt);
    if (!this.locks.has("oy")) this.oy += (0 - this.oy) * kGen;

    // A permission waits: a small shake now and then, until the user answers.
    if (!this.locks.has("ox")) {
      if (this.cfg.tremble) {
        const ph = t % 1.8;
        this.ox = ph < 0.6 ? Math.sin(ph * 38) * 0.035 * (1 - ph / 0.6) : 0;
      } else {
        this.ox += (0 - this.ox) * kGen;
      }
    }

    // Breathing: 1 → (1.025, 0.975) → 1 about every 3 s; slower and deeper asleep.
    const period = this.cfg.sleepy ? 4.5 : 3;
    const amp = this.cfg.sleepy ? 0.045 : this.isMini ? 0.05 : 0.025;
    const breath = (1 - Math.cos((t * Math.PI * 2) / period)) / 2;
    this.tgSx = 1 + amp * breath;
    this.tgSy = 1 - amp * breath;

    if (this.isMini && n > this.miniNextBehavior) this.doMiniBehaviorLoop();

    const kLook = 1 - Math.pow(0.0025, dt);
    if (!this.locks.has("yaw")) this.yaw += (this.tgYaw - this.yaw) * kLook;
    if (!this.locks.has("pitch")) this.pitch += (this.tgPitch - this.pitch) * kLook;
    if (!this.locks.has("tilt")) this.tilt += (this.tgTilt - this.tilt) * kGen;
    if (!this.locks.has("sy")) this.sy += (this.tgSy - this.sy) * kGen;
    if (!this.locks.has("sx")) this.sx += (this.tgSx - this.sx) * kGen;
    if (!this.locks.has("es")) this.es += (this.tgEs - this.es) * kGen;

    // A blink every ~4 s.
    if (n > this.nextBlink) {
      if (this.state !== "sleeping") {
        this.blink();
        if (Math.random() < 0.15) setTimeout(() => this.blink(), 230);
      }
      this.nextBlink = n + 3.2 + Math.random() * 1.6;
    }

    if (this.faceOverride && n > this.faceOverrideUntil) {
      this.faceOverride = this.permanentFace;
      if (this.permanentFace) this.faceOverrideUntil = Number.POSITIVE_INFINITY;
    }

    // The mouth, while he talks: open and shut with the syllables.
    const talk = this.speaking && CAN_TALK.has(this.state)
      ? Math.abs(Math.sin(t * 8.5)) * (0.55 + 0.45 * Math.abs(Math.sin(t * 3.1)))
      : 0;
    this.mouthLevel += (talk - this.mouthLevel) * (1 - Math.pow(0.0005, dt));

    if (n - this.lastAmbient > 1.3) {
      this.lastAmbient = n;
      if (this.cfg.zz) this.emit("z", 1);
      if (!this.isMini && this.cfg.sweat && Math.random() < 0.5) this.emit("sweat", 1);
    }

    for (const p of this.particles) p.age += dt;
    this.particles = this.particles.filter((p) => p.age < p.life);

    // Mouth slot spring — ω₀ = 2π/0.25, ζ = 0.6
    const omega = (2 * Math.PI) / 0.25;
    const zeta = 0.6;
    const acc = omega * omega * (this.slotHTarget - this.slotH) - 2 * zeta * omega * this.slotHVel;
    this.slotHVel += acc * dt;
    this.slotH = Math.max(0, this.slotH + this.slotHVel * dt);

    this.dancingLevel = stepDanceLevel(this.dancingLevel, this.isDancing, dt);

    this.lastTime = n;
  }

  private doMiniBehaviorLoop() {
    const n = now();
    switch (this.permanentEmote) {
      case "happy":
        if (this.locks.has("oy")) { this.miniNextBehavior = n + 0.4; return; }
        this.anim("oy", [[-0.3, 120, Ease.out], [0.03, 200, Ease.inOut], [0, 160, Ease.back]]);
        this.anim("sy", [[0.82, 80, Ease.out], [1.18, 130, Ease.out], [0.88, 160, Ease.inOut], [1, 200, Ease.back]]);
        this.anim("sx", [[1.15, 80, Ease.out], [0.88, 130, Ease.out], [1.06, 160, Ease.inOut], [1, 200, Ease.back]]);
        this.miniNextBehavior = n + 2.2 + Math.random() * 1.2;
        break;
      case "annoyed":
        if (this.locks.has("tilt")) { this.miniNextBehavior = n + 0.5; return; }
        this.anim("tilt", [
          [-0.2, 50, Ease.out], [0.2, 90, Ease.inOut], [-0.15, 80, Ease.inOut],
          [0.1, 75, Ease.inOut], [-0.05, 70, Ease.inOut], [0, 140, Ease.out],
        ]);
        this.miniNextBehavior = n + 3.0 + Math.random() * 2.5;
        break;
      case "wink":
        this.faceOverride = "happy";
        this.faceOverrideUntil = n + 0.55;
        this.anim("tilt", [[0.13, 100, Ease.out], [0.13, 320, Ease.lin], [0, 200, Ease.inOut]]);
        this.miniNextBehavior = n + 2.2 + Math.random() * 2.0;
        break;
      case "love":
        this.emit("heart", 2);
        this.anim("tilt", [[-0.1, 180, Ease.out], [0.1, 340, Ease.inOut], [0, 220, Ease.inOut]]);
        this.miniNextBehavior = n + 2.6 + Math.random() * 1.5;
        break;
      default:
        this.miniNextBehavior = n + 3.0 + Math.random() * 2.0;
    }
  }

  // ── Geometry ────────────────────────────────────────────────────────────────

  /**
   * Where Roni stands in a `W`×`H` canvas. `u` is the pixels of one unit of the
   * design; `baseY` is the floor under the body — the point he squashes around.
   */
  private geometry(W: number, H: number) {
    const R = W * 0.3;
    const u = (W * BODY_HALF_W) / BODY_A;
    const cx = W / 2 + this.ox * R;
    // The figure (pompom to base) is centred in the canvas, whatever its size.
    const centre = -((FIGURE_TOP + FIGURE_BOTTOM) / 2);
    const cy = H / 2 + this.particleOverhang / 2 + this.oy * R + centre * u;
    return { R, u, cx, cy, baseY: cy + BODY_B * u };
  }

  // ── Dancing ─────────────────────────────────────────────────────────────────

  setDancing(dancing: boolean) {
    if (this.isDancing !== dancing) this.isDancing = dancing;
  }

  /**
   * Applies the dance bounce and sway around the bottom of the body. Call it on
   * a saved context, before draw(), with the same size.
   */
  applyDance(x: CanvasRenderingContext2D, W: number, H: number) {
    if (this.dancingLevel <= 0.001) return;
    const g = this.geometry(W, H);
    const px = g.cx;
    const py = g.baseY;
    const d = danceTransform(now(), this.dancingLevel, g.R);
    x.translate(px + d.dx, py + d.dy);
    x.rotate(d.rotate);
    x.scale(d.sx, d.sy);
    x.translate(-px, -py);
  }

  // ── Draw ────────────────────────────────────────────────────────────────────

  private face(): Face {
    const n = now();
    if (this.faceOverride && n < this.faceOverrideUntil) return this.faceOverride;
    if (this.isDancing && this.dancingLevel > 0.15 && !this.isMini && (this.state === "idle" || this.state === "finished")) {
      return "happy";
    }
    if (this.speaking && CAN_TALK.has(this.state)) return "talking";
    return this.cfg.face;
  }

  private pose(): RoniPose {
    return {
      face: this.face(),
      open: this.open,
      lookX: clamp(this.yaw / 0.62, -1, 1),
      lookY: clamp(this.pitch / 0.5, -1, 1),
      mouth: this.mouthLevel,
      eyeScale: this.es,
      tint: this.bodyColor,
      morph: this.morph,
      time: now() - this.t0,
    };
  }

  /**
   * Draws Roni, the badge and the particles into a canvas of `W`×`H` CSS pixels
   * (the caller has already applied the DPR transform).
   */
  draw(x: CanvasRenderingContext2D, W: number, H: number) {
    const { R, u, cx, cy, baseY } = this.geometry(W, H);
    const detail = detailFor(300 * u);

    // The floor shadow stays on the floor: it does not tilt or squash with him.
    if (this.floorShadow && !this.isMini && detail >= 1 && this.morph < 0.3) {
      x.save();
      x.translate(cx, baseY);
      drawRoniShadow(x, u, this.sx, clamp(-this.oy * 1.2, 0, 1));
      x.restore();
    }

    x.save();
    x.translate(cx, baseY);
    if (this.tilt !== 0) x.rotate(this.tilt);
    x.scale(this.sx, this.sy);
    x.translate(0, -BODY_B * u);
    drawRoni(x, u, this.pose(), deviceRatio());
    if (this.morph > 0.05) this.drawSlot(x, u);
    x.restore();

    if (this.badge && this.badgeS > 0.01 && this.morph < 0.25) {
      // On the hat's upper-left rim, where it does not hide the face: a point of the
      // body (the design's units) taken through the same tilt and squash as Roni.
      const px = -128 * u * this.sx;
      const py = (-124 * u - BODY_B * u) * this.sy;
      const c = Math.cos(this.tilt);
      const s = Math.sin(this.tilt);
      this.drawBadge(x, this.badge, R, cx + c * px - s * py, baseY + s * px + c * py);
    }
    this.drawParticles(x, R, cx, cy);
  }

  /** The file drop's slot: a dark pill cut into the box's face, with its rim and lip highlights. */
  private drawSlot(x: CanvasRenderingContext2D, u: number) {
    const m = this.morph;
    const R = BODY_A / 1.14;
    const hW = R * 1.8 * m;
    const hH = this.slotH * R * m;
    const hX = -hW / 2;
    const boxTop = -R * (0.88 + 0.06 * m) - 6;
    const hY = boxTop + R * 0.08 * m;
    const px = 1 / u;

    x.save();
    x.scale(u, u);
    x.clip(bodyPath(m));

    x.strokeStyle = `rgba(255,255,255,${0.55 * m})`;
    x.lineWidth = px;
    x.lineCap = "round";
    x.beginPath();
    x.moveTo(-R * 0.9 * m, boxTop + px);
    x.lineTo(R * 0.9 * m, boxTop + px);
    x.stroke();

    if (hH > 0.8 * px) {
      const hR = Math.min(hW / 2, hH / 2);
      const g = x.createLinearGradient(0, hY, 0, hY + hH);
      g.addColorStop(0, "rgb(7,8,10)");
      g.addColorStop(1, "rgb(16,19,26)");
      roundRectPath(x, hX, hY, hW, hH, hR);
      x.fillStyle = g;
      x.fill();
      if (hH > 4 * px) {
        const lipR = Math.min(hR, (hW - 2 * px) / 2);
        x.strokeStyle = `rgba(255,255,255,${0.28 * m})`;
        x.beginPath();
        x.moveTo(hX + lipR, hY + hH - 0.5 * px);
        x.lineTo(hX + hW - lipR, hY + hH - 0.5 * px);
        x.stroke();
      }
    }
    x.restore();
  }

  private drawBadge(x: CanvasRenderingContext2D, badge: Badge, R: number, bx: number, by: number) {
    const bs = this.badgeS * (this.isMini ? 1.25 : 1);
    const t = now();

    x.save();
    x.translate(bx, by);
    x.scale(bs, bs);
    const col = rgba(badge.color);

    if (badge.kind === "dots") {
      if (this.isMini) {
        const phase = (t * 2.4) % 1;
        const dotR = R * 0.22 * (1 + 0.25 * Math.sin(phase * Math.PI * 2));
        x.fillStyle = "#000";
        x.beginPath();
        x.arc(0, 0, R * 0.2, 0, Math.PI * 2);
        x.fill();
        x.fillStyle = col;
        x.beginPath();
        x.arc(0, 0, dotR, 0, Math.PI * 2);
        x.fill();
      } else {
        const pw = R * 0.72;
        const ph = R * 0.36;
        roundRectPath(x, -pw / 2, -ph / 2, pw, ph, ph / 2);
        x.fillStyle = col;
        x.fill();
        for (let i = 0; i < 3; i++) {
          const phase = (((t * 2.4 - i * 0.22) % 1) + 1) % 1;
          const dotR = R * 0.055 * (1 + 0.4 * Math.max(0, Math.sin(phase * Math.PI * 2)));
          x.fillStyle = "#fff";
          x.beginPath();
          x.arc((i - 1) * R * 0.18, 0, dotR, 0, Math.PI * 2);
          x.fill();
        }
      }
    } else if (badge.kind === "arrow") {
      // The "!" badge's ring and disc, with a white up-arrow: a new version is out.
      x.fillStyle = "#000";
      x.beginPath();
      x.arc(0, 0, R * 0.3, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = col;
      x.beginPath();
      x.arc(0, 0, R * 0.23, 0, Math.PI * 2);
      x.fill();
      if (!this.isMini) {
        const a = R * 0.12;
        x.strokeStyle = "#fff";
        x.lineWidth = R * 0.055;
        x.lineCap = "round";
        x.lineJoin = "round";
        x.beginPath();
        x.moveTo(0, a);
        x.lineTo(0, -a);
        x.moveTo(-a * 0.8, -a * 0.2);
        x.lineTo(0, -a);
        x.lineTo(a * 0.8, -a * 0.2);
        x.stroke();
      }
    } else if (badge.kind === "bang" || badge.kind === "question") {
      x.fillStyle = "#000";
      x.beginPath();
      x.arc(0, 0, R * 0.3, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = col;
      x.beginPath();
      x.arc(0, 0, R * 0.23, 0, Math.PI * 2);
      x.fill();
      if (!this.isMini) {
        x.fillStyle = "#fff";
        x.font = `900 ${R * 0.32}px ${FONT}`;
        x.textAlign = "center";
        x.textBaseline = "middle";
        x.fillText(badge.kind === "bang" ? "!" : "?", 0, R * 0.02);
      }
    } else {
      x.fillStyle = "#000";
      x.beginPath();
      x.arc(0, 0, R * 0.2, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = col;
      x.beginPath();
      x.arc(0, 0, R * 0.135, 0, Math.PI * 2);
      x.fill();
    }
    x.restore();
  }

  private drawParticles(x: CanvasRenderingContext2D, R: number, cx: number, cy: number) {
    for (const p of this.particles) {
      if (p.age <= 0) continue;
      const k = p.age / p.life;
      const a = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
      const px = cx + (p.x + p.vx * p.age) * R * 1.3;
      const py = cy + (p.y + p.vy * p.age) * R * 1.3;
      const sz = R * p.size * (1 + k * 0.4);

      x.save();
      x.translate(px, py);
      x.globalAlpha = Math.min(1, Math.max(0, a));
      switch (p.type) {
        case "heart":
          x.rotate(Math.sin(p.age * 6) * 0.3);
          x.fillStyle = "#FF4D6D";
          heartPath(x, sz);
          x.fill();
          break;
        case "star":
          x.rotate(p.rot + p.age * 2);
          x.fillStyle = "#F7B32B";
          starPath(x, sz, sz * 0.45);
          x.fill();
          break;
        case "spark":
          x.rotate(p.rot);
          x.fillStyle = "#fff";
          starPath(x, sz * 0.8, sz * 0.18);
          x.fill();
          break;
        case "sweat":
          x.fillStyle = "#7CC7FF";
          x.beginPath();
          x.moveTo(0, -sz);
          x.quadraticCurveTo(sz * 0.8, sz * 0.2, 0, sz * 0.6);
          x.quadraticCurveTo(-sz * 0.8, sz * 0.2, 0, -sz);
          x.fill();
          break;
        case "z":
          x.fillStyle = "rgb(209,219,235)";
          x.font = `700 ${sz * 1.9}px ${FONT}`;
          x.textAlign = "center";
          x.textBaseline = "middle";
          x.fillText("z", 0, 0);
          break;
      }
      x.restore();
    }
  }
}
