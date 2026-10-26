// Roni is a fork of Coucou: the Mac catalog (and the hand-written strings of the
// original app) still say "Coucou" and "Mochi". This is the one rule that turns
// them into Roni, used by gen-strings.mjs so that strings.json stays exactly what
// the generator makes (tests/i18n.test.mjs checks it).
//
// What must NOT change stays as it is: web addresses, and the names the phone
// link speaks to the Android app (coucou://pair, coucou.v1, _coucou._tcp…).

const PROTECT = [
  /(?:https?|wss?):\/\/[^\s"'`<>)\]]+/g,
  /coucou:\/\//g,
  /coucou\.v1/g,
  /coucou\.join\./g,
  /_coucou\._tcp/g,
  /coucou-relay\/v1/g,
  /coucou-link/g,
];

export function rebrand(text) {
  const saved = [];
  let s = text;
  for (const re of PROTECT) {
    s = s.replace(re, (m) => {
      saved.push(m);
      return `\u0000${saved.length - 1}\u0000`;
    });
  }
  s = s
    .replace(/fr\.louisraille\.Coucou\.Focus/g, "com.ldanielmc.roni.Focus")
    .replace(/fr\.louisraille\.coucou/g, "com.ldanielmc.roni")
    .replace(/Coucou/g, "Roni")
    .replace(/coucou/g, "roni")
    .replace(/\bMochi\b/g, "Roni")
    .replace(/\bMochis\b/g, "Ronis"); // the German genitive
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => saved[Number(i)]);
}

/** A translation: a string, or plural categories ({ one, other }). */
export function rebrandValue(value) {
  if (typeof value === "string") return rebrand(value);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rebrandValue(v)]));
  }
  return value;
}
