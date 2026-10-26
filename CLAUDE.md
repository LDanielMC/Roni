# Roni (fork de Coucou) — guía para agentes de código

App de escritorio para Windows donde vive **Roni**, el asistente personal de Dani. Es un fork de Coucou (licencia MIT).
Antes de cualquier tarea, lee `roni-docs/contexto.md`, `roni-docs/decisiones.md`, `roni-docs/plan-de-rebanadas.md`,
`roni-docs/criterios.md` y, si toca el personaje, `roni-docs/diseno/personaje.md`. Si existe, `roni-docs/mapa-coucou.md`
explica dónde está cada pieza del código heredado.

## Flujo de trabajo obligatorio (Roni)
1. Antes de empezar una tarea, lee los documentos de roni-docs/.
2. Crea una rama nueva por tarea. Nunca hagas commit directo en main/master ni push sin que Dani lo pida.
3. Al terminar cada tarea, pásale el trabajo al subagente "revisor" (`.claude/agents/revisor.md`).
4. Si responde CORRECCIONES, aplícalas y vuelve a pedir revisión. Máximo 3 rondas; si no aprueba, detente y explica el desacuerdo.
5. Detente y pregunta ANTES de: instalar herramientas o librerías, cambiar la configuración de OpenClaw,
   tocar el token del gateway, modificar ~/.claude/settings.json o salirte del plan de rebanadas.
6. Antes de dar una tarea por terminada, compila la app y corre las pruebas que existan.
7. Al final da un resumen corto en español sencillo: qué hiciste, qué corrigió el revisor y qué debe probar Dani,
   con los comandos de PowerShell completos.
8. Si se toma una decisión importante, agrégala a roni-docs/decisiones.md.

## Cómo conviven las dos guías
- Roni trabaja sobre `windows/` (Tauri). `NotchBuddy/` (Mac), `android/`, `relay/` y `linux/` se dejan como están.
- Las reglas técnicas de abajo vienen de Coucou y siguen vigentes (Keychain/credenciales, sin telemetría, el hook nunca
  bloquea a Claude Code, no sobrescribir `~/.claude/settings.json`, no aprobar permisos sin un clic).
- Donde la guía de Coucou y `roni-docs/` se contradigan, manda `roni-docs/`. Casos conocidos: la regla "Never restyle what
  already ships" y "Keep the bundle identifier `fr.louisraille.NotchBuddy`" son del Coucou original; Roni sí cambia
  nombre, identificador, ícono, sonidos y personaje (Rebanadas 1 y 2), y solo en `windows/`.
- Las reglas de release (CHANGELOG, tabla de versiones del README, what's new) son del Coucou original; en Roni se
  decidirán cuando haya primera versión propia (Rebanada 6). Hasta entonces no aplican.

---

# Coucou — guide for AI coding agents (guía técnica heredada)

Coucou is a native macOS app (`NotchBuddy/`); `windows/` is the Tauri version for Windows and Linux. Mochi, a small animated character living in the MacBook notch, shows AI coding agent sessions (Claude Code, Gemini CLI, Antigravity and more) and a few integrations, and lets the user approve, answer, chat and drop files from the notch.

## Where things are
- `NotchBuddy/Sources/App/` — Mac-only Swift code. `NotchBuddy/Sources/CoucouKit/` — code shared with the iPhone app (Mochi's BotEngine and outfits, pills, diff, models). `NotchBuddy/Sources/Phone/` — iPhone app (`CoucouPhone` target), with its widgets in `Sources/Widgets/` and the expanded approval notification in `Sources/NotificationContent/`. `NotchBuddy/Resources/sounds/` — the 28 WAV sounds. `NotchBuddy/project.yml` — XcodeGen project (never edit the `.xcodeproj` by hand).
- `NotchBuddy/Sources/CoucouKit/PillCatalog.swift` — single source of truth for all declared pills (workspace tools, agents, AI providers, services). Every pill ID, color, category and subtitle lives here.
- `docs/SPEC.md`, `docs/INTEGRATIONS.md` — behaviour, views, states, integrations (in French).
- `design/prototype/notch-buddy.html` — original prototype, the visual source of truth. `design/captures/` — target screenshots.
- `windows/` — the Tauri app for Windows and Linux: Rust in `src-tauri/`, TypeScript in `src/`, the `coucou-hook` relay in `hook/`. `windows/README.md` lists what differs from the Mac.
- `docs/*.html` — the GitHub Pages site (privacy, terms, support, legal notice).
- `relay/` — the Coucou relay, a stateless Cloudflare Worker that forwards the iPhone Live Activity pushes (it holds the APNs key, which must never ship in an app). See `relay/README.md`.

## Build
```
cd NotchBuddy && xcodegen && xcodebuild -scheme NotchBuddy -configuration Debug build
```
To run it day to day on the Mac (signed, iPhone link, permissions kept across builds): `./scripts/dev-install.sh` — it installs the only Coucou in /Applications and removes the copies earlier builds left.
Windows and Linux: `cd windows && npm install && npm run tauri dev`

## Rules
- Swift 6, SwiftUI + AppKit. No third-party dependencies unless truly unavoidable. The character is drawn in code (`Canvas` + `TimelineView`), no Rive/Lottie/images.
- Secrets live in the Keychain, never on disk or in git.
- No telemetry. Network calls only to services the user configured.
- Never block Claude Code: if the app doesn't answer, the hook exits immediately.
- Never overwrite `~/.claude/settings.json`: dated backup, merge, show the diff, write only after the user confirms.
- Never send an email or approve a Claude Code or Codex permission without an explicit click.
- Performance: 0 % CPU when the island is hidden.
- Keep the bundle identifier `fr.louisraille.NotchBuddy` (Keychain items, preferences and permissions depend on it).
- Never restyle what already ships (pills, cards, Settings, chat…): existing views stay exactly as they are in `main`, which is the App Store build. Change the look of an existing view only when explicitly asked.
- Pill IDs are stable contract values (Keychain, UserDefaults, hook routing): never rename an existing pill ID.
- New views follow the existing app style. `design/prototype/notch-buddy.html` and `design/captures/` are references for new work, not a reason to change existing views.
- Every release adds its CHANGELOG.md section, a row in the README Versions table, and commits the regenerated Info.plist with the new version.
- Every release also adds its What's new, shown once in the notch or the island after Coucou updates itself: an entry for the new version in `NotchBuddy/Resources/whats-new.json` (Mac, the 14 languages) or `windows/src/whats-new/whats-new.json` (Windows and Linux, the 12 languages). 1 to 4 items picked from the CHANGELOG section, each with an icon from `scripts/test-whats-new.py`, a short title and one line, translated in every language. `python3 scripts/test-whats-new.py` checks it; CI and `release.sh` fail without it.
