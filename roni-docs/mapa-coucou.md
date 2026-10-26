# Mapa del código de Coucou (versión Windows)

Hecho en la Rebanada 0, **solo leyendo el código, sin cambiar nada**. Todo está en `windows/`.
Las rutas son desde `windows/`. Lo que no pude comprobar corriendo la app está marcado como **(hipótesis)**.

## Vista general

La app son **tres piezas**:

| Pieza | Dónde | Qué es |
|---|---|---|
| Interfaz (lo que se ve) | `src/` (TypeScript, se empaqueta con Vite) | La isla, Mochi, el chat, los ajustes. Corre dentro de un WebView2. |
| Núcleo (lo que hace) | `src-tauri/src/` (Rust, Tauri 2) | Ventanas, atajos, dictado, voz, claves, hooks, red, actualizador. |
| Relevo de hooks | `hook/` (Rust, programa aparte `coucou-hook.exe`) | Lo que Claude Code ejecuta en cada evento y le pasa el aviso a la app. |

`Cargo.toml` (raíz de `windows/`) junta `src-tauri` y `hook` en un solo "workspace" de Rust.
La interfaz le pide cosas al núcleo con `Bridge` (`src/core/bridge.ts`) y el núcleo le avisa con eventos (`onEvent`).

**Ventanas** (cuatro páginas HTML, definidas en `vite.config.ts:63-67`):

| Etiqueta | Página | Para qué |
|---|---|---|
| `island` | `index.html` → `src/main.ts` | La isla de arriba de la pantalla. Es la principal. |
| `settings` (se llama `HUB_LABEL`, `lib.rs:688`) | `settings.html` → `src/settings/main.ts` y `src/hub/` | La ventana grande "Coucou" (1100×720): ajustes, dictado, notas. |
| `mochi` | `mochi.html` → `src/desktop/main.ts` | Mochi suelto en el escritorio (se arrastra fuera de la isla). |
| `pill` | `pill.html` → `src/pill/main.ts` | La pastillita de abajo de la pantalla (dictado y "OK Coucou"). |

## 1. Dónde se dibuja Mochi y cómo funcionan sus estados

- **El dibujo:** `src/mochi/engine.ts`, clase `BotEngine` (línea 197). Se dibuja en un `<canvas>` 2D con código, sin imágenes.
  El método `draw()` (línea 797) pinta cuerpo, ojos, manos, mejillas y partículas. Es un puerto directo de `BotEngine.swift` del Mac.
- **Quién lo usa** (cada uno crea su propio `BotEngine`):
  - la isla: `src/island/island.ts:79`;
  - Mochi del escritorio: `src/desktop/main.ts:34`;
  - la pastilla de voz: `src/pill/main.ts:50`;
  - los "mini Mochis" de las pastillas de integraciones: `src/mochi/minibots.ts` (cada canvas tiene su motor).
- **Estados** (11): `idle, working, thinking, searching, approval, question, error, finished, ratelimit, sleeping, dizzy`.
  Los nombres están en `src/core/layout.ts:30`. La tabla `BOT_STATES` (`engine.ts:94`) dice, por cada uno, color, forma de ojos
  (`pill, wide, flat, happy, closed, spiral, tired…`), insignia (puntitos, "!", "?"), si rebota, respira, suda, etc.
  Los colores están en la constante `C` (`engine.ts:75`).
- **Emociones puntuales** (`love, surprised, proud, wink, yawn, happy, annoyed`): `triggerEmote()` (`engine.ts:458`).
  Formas de ojos extra para emociones: `EMOTE_EYE`.
- **Quién decide el estado:** `State.effectiveState` (`src/core/state.ts:286`) = un estado forzado, o el de la tarea en foco, o `idle`.
  La isla se lo pasa al motor con `engine.setState(...)` (`island.ts:1253`). Las tareas cambian de estado cuando llegan eventos
  de los agentes (`src/island/hooks.ts`, ver sección 5).
- **Animación:** el motor mueve valores con "tweens" (`anim()`, `engine.ts:588`) y se actualiza cada cuadro con `update(dt)` (línea 597).
  La isla solo dibuja mientras hace falta (regla de 0 % CPU cuando está oculta).
- **Guardarropa (ropa de Mochi):** `src/mochi/wardrobe.ts` (lógica: 13 opciones, incluida "auto" por temporadas) y `src/mochi/outfits.ts`
  (los dibujos de gorros, lentes, etc.). La vista es `src/views/wardrobe.ts`. Se guarda en preferencias como `mochiOutfit`.
- **Saludo al arrancar:** `src/mochi/greeting.ts` (animación de unos 4.6 s). **Escritorio:** `src/mochi/desktop-logic.ts` + `src/island/desktop.ts`
  + `src-tauri/src/desktop.rs`.
- **Isla (cuándo se abre y se cierra):** `src/island/fsm.ts`, estados `hidden / petit / home / coucou`. No dibuja nada, solo avisa transiciones.
  Tamaños y posiciones de Mochi en cada vista: `src/core/layout.ts`.

## 2. El chat y sus proveedores

- **Pantalla del chat:** `src/views/chat.ts` (el cuadro de texto está en la línea 207). Llama a `Bridge.chatSend` (`bridge.ts:365`),
  que invoca el comando `chat_send` (`src-tauri/src/lib.rs:531`).
- **Lista de proveedores en la interfaz:** `src/core/providers.ts:26` (`PROVIDERS`): `anthropic, google, openai, openrouter, ollama, lmstudio, custom`.
  El proveedor activo es `settings.chatProvider`; por defecto es `anthropic` (`src-tauri/src/settings.rs:149`).
- **Dirección del backend** (`src-tauri/src/chat.rs`): lleva la conversación y decide a qué proveedor va cada turno.
  - Anthropic → `claude.rs`.
  - OpenAI, Google, OpenRouter → `openai_compat.rs` (una tabla `PROVIDERS` con URL y nombre de la clave).
  - Ollama, LM Studio y **"Servidor personalizado" (`custom`)** → `local_chat.rs`. Este último habla el formato OpenAI con la URL que el usuario
    escriba en `settings.customUrl`, y sirve para apuntar a OpenClaw (`http://127.0.0.1:18789/v1`). Hace streaming (eventos `chat-delta`).
- **Clave del servidor personalizado:** entrada `openai-compatible-key` en el Administrador de credenciales (`local_chat.rs:27`).
  La clave queda **atada a la URL** para la que se escribió y solo viaja por `https` o hacia la propia máquina (`may_carry_key`, `local_chat.rs:55`).
  Esto ya cumple el criterio de seguridad 8 y 9 de Roni.
- **Quién es el asistente:** el texto del sistema sale de `system_prompt` (`chat.rs:117`) → `system_prompt_for` (línea 121) y dice literalmente (líneas 123-124) **"You are Mochi…"**.
  Hay que cambiarlo en la Rebanada 1/3; con OpenClaw, la personalidad de Roni viene del lado de OpenClaw (**hipótesis:** puede bastar con no mandar este texto).
- **Red segura:** `net.rs` revisa direcciones (loopback) y pone límites de tamaño a las respuestas.
- **Claves:** `secrets.rs`. Usa la crate `keyring` → Administrador de credenciales de Windows. Lista cerrada de claves permitidas (`KNOWN_KEYS`, línea 9).
  El "servicio" bajo el que se guardan es `fr.louisraille.coucou` (`SERVICE`, `secrets.rs:6`): si Roni cambia ese nombre, las claves de Coucou no se mezclan (bien) pero hay que decidirlo.

## 3. "OK Coucou" (voz)

Todo en `src-tauri/src/voice/` y se dibuja en la pastilla (`src/pill/main.ts`).

- `voice/mod.rs`: mantiene el micrófono abierto cuando la preferencia está activa. Un detector de energía corta el audio en trozos y **solo los
  trozos con voz** pasan a Parakeet (transcripción local). Solo cuando el texto empieza con "OK Coucou" se manda lo siguiente al "cerebro".
  `requirements_met()` pide: modelo de voz descargado **y clave de Claude** (`voice/mod.rs:57`). Se apaga mientras dictas, grabas una llamada o habla.
- `voice/wake.rs`: reconoce la frase de activación. `is_ok`, `is_coucou` y `is_coucou_pair` tienen la lista de formas en que Parakeet puede escribir
  "ok" y "coucou"; `after_wake()` devuelve lo que se dijo después. Aquí hay que poner "Oye Roni" (Rebanada 5).
- `voice/brain.rs`: el "cerebro" es **Claude directo con la clave del usuario** (modelo `claude-haiku-4-5`, `brain.rs:12`) con herramientas propias de Coucou
  (pastillas, música, datos de servicios, abrir apps, preparar correos, búsqueda web). La conversación se olvida a los 90 s.
  Esto es lo que, en la Rebanada 5, debe cambiar para hablar con OpenClaw.
- La respuesta se dice en voz alta con `speechSynthesis` del sistema (en la pastilla) o ElevenLabs si hay clave.
- Interfaz: `src/island/voice.ts` (responde a lo que Rust pregunta con el evento `voice-ask`). Documentación original: `../docs/VOICE.md`.

## 4. El dictado (mantener Ctrl derecho)

Todo en `src-tauri/src/flow/`.

- `flow/os_windows.rs`: un gancho de teclado de bajo nivel (`WH_KEYBOARD_LL`) que **solo mira, nunca se traga teclas**. La tecla por defecto es
  Ctrl derecho (`VK_RCONTROL = 0xA3`, línea 37; el nombre "Right Ctrl" sale de `flow/logic.rs:156`).
- `flow/logic.rs`: lógica de teclas (mantener, bloquear, cancelar). `flow/mod.rs`: un hilo que graba (`speech/audio.rs`), transcribe con Parakeet
  (`speech/mod.rs`, sherpa-onnx, sin internet), aplica diccionario y atajos de texto (`flow/text.rs`, `flow/store.rs`), limpieza opcional con Claude
  (`flow/cleanup.rs`) y **pega** (`flow/paste.rs`): pone el texto en el portapapeles, manda Ctrl+V a la app que esté al frente y devuelve el portapapeles
  700 ms después.
- **Por qué no pega en el chat de la isla (hipótesis, no probado en la laptop):** al empezar a grabar se guarda la app que está al frente
  (`flow/mod.rs:325`) descartando las "de escritorio" con `is_shell()` (`flow/mod.rs:95`), que incluye `coucou` (el propio programa).
  Además la isla se crea con `focus: false` (`tauri.conf.json`). Dos candidatos: (a) la isla no tiene el foco de Windows cuando se dicta, así que
  Ctrl+V cae en otra app; (b) el chat no recibe el texto aunque llegue al portapapeles. Hay que mirar el registro (`log`) y probarlo en la Rebanada 4.
- La pastilla de estado del dictado: `flow/pill.rs` + `src/pill/main.ts`. Ajustes del dictado: `src/hub/pages/dictation.ts`, `flowsettings.ts`.
- Notas / grabación de llamadas: `src-tauri/src/notes/`, `src/hub/pages/notes.ts` (no se toca).

## 5. Los hooks de Claude Code

- **Instalación:** `src-tauri/src/hooks.rs`. Sigue la regla de no sobrescribir: lee `%USERPROFILE%\.claude\settings.json`, hace copia con fecha,
  combina sin tocar hooks ajenos, **muestra la diferencia** y escribe solo tras un clic. La mecánica de leer/diff/copia/escribir está en `config_file.rs`.
  Eventos que escucha: `HOOK_EVENTS` (`hooks.rs:26`): SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure,
  PermissionRequest, Notification, Stop, StopFailure, SubagentStart, SubagentStop. Se reconoce un hook propio por el texto `coucou-hook` (`MARKER`,
  `hooks.rs:42`); `agent_hooks.rs:36` detecta "NotchBuddy" o "coucou" en el comando.
- **Otros agentes** (Codex, Gemini, Cursor, Copilot, OpenCode, Amp, Hermes, Antigravity…): `src-tauri/src/agents.rs` (1310 líneas, instaladores de cada uno).
- **El ejecutable del relevo:** `hook/` → `coucou-hook.exe`. `hook/src/main.rs` lee el JSON por stdin, lo normaliza a los nombres de Claude Code
  (`normalize.rs`) y lo manda por la tubería. Reglas: **nunca bloquea al agente** (300 ms para conectar, si la app está cerrada sale al instante).
  Solo `PermissionRequest` espera respuesta (`reply.rs`). `statusline.rs` pasa el uso del plan.
  Se copia a `%LOCALAPPDATA%\Coucou\bin\` al arrancar (`ensure_hook_exe`, `hooks.rs:350`, llamado desde `lib.rs:1006`; el nombre del archivo sale de `platform/windows.rs:45`).
- **La tubería (named pipe):** `\\.\pipe\coucou-<SID del usuario>` (`src-tauri/src/pipe.rs:66`). **Debe ser idéntica en `hook/src/win.rs`.**
  Cada evento llega a la interfaz como evento `hook`. Para `PermissionRequest`, la tubería queda abierta hasta que alguien hace clic en la isla
  (límite 108 s; si la tarjeta no se confirma en 800 ms, suelta y la terminal sigue sola).
- **Interfaz:** `src/island/hooks.ts` convierte cada evento en el estado de una tarea (SessionStart → idle, UserPromptSubmit → thinking,
  PreToolUse → working/searching, Notification, Stop → finished, StopFailure → error, PermissionRequest → approval/question…), que luego
  decide el estado de Mochi. Nunca aprueba solo: la respuesta sale de un clic.

## 6. El actualizador

- `src-tauri/src/update.rs` (1024 líneas). **Hoy apunta al Coucou original:**
  `RELEASES_URL = https://api.github.com/repos/Louis-CFM/coucou/releases?per_page=30` (línea 32) y `RELEASES_PAGE` (línea 34).
  Busca etiquetas `windows-vX.Y.Z` (`TAG_PREFIX`, línea 39), descarga el instalador solo de github.com y valida su SHA-256.
- No hace nada hasta que el usuario acepta; luego revisa al arrancar y cada 6 h (`CHECK_INTERVAL`).
- Interfaz: `src/island/update.ts`, `src/core/update.ts`, `src/views/update.ts`, `src/settings/updates.ts`; entrada de bandeja "Update Coucou to X…" (`tray.rs:37`).
- Hay un segundo mensaje: "Qué hay de nuevo" tras actualizar (`src/whats-new/`, `whats-new.json`).
- **Riesgo para Roni:** si se deja así, la app ofrecería instalar el Coucou original encima. Es la Rebanada 1 (criterio 12).

## 7. Dónde están el nombre, el ícono y los sonidos

**Nombre "Coucou" / "Mochi"** (hay que reemplazarlos todos; criterio 6). Lugares principales:
- `src-tauri/tauri.conf.json`: `productName`, `identifier` (`fr.louisraille.coucou`), título de ventana, `copyright`, `shortDescription`, `longDescription`, instalador NSIS/MSI.
- `Cargo.toml` (raíz) y `src-tauri/Cargo.toml` / `hook/Cargo.toml`: nombre del paquete (`coucou`, `coucou-hook`), autor, descripción. `package.json`: `coucou-windows`.
- Rust: `lib.rs` (títulos y registros), `tray.rs` (menú y tooltip, id `coucou`), `platform/windows.rs` (carpetas), `pipe.rs`, `secrets.rs`, `shortcuts.rs`,
  `integrations.rs` (cabecera `User-Agent: Coucou`), `agents.rs` (textos y complementos que escribe en otros agentes), `i18n.rs`.
- Interfaz: títulos en `index.html`, `settings.html`, `pill.html`, `mochi.html`; textos traducidos en `src/i18n/strings.json` y `extra.json`
  (la clave es el texto en inglés; 12 idiomas); `src/views/*`, `src/settings/*`, `src/hub/*`.
- Carpetas de datos: `%APPDATA%\Coucou` (preferencias, `platform/windows.rs:60`) y `%LOCALAPPDATA%\Coucou` (hook, buzón, registro; `windows.rs:68`).
  Tubería `\\.\pipe\coucou-…`; arranque con Windows (plugin `autostart`, `lib.rs`); instancia única (`lib.rs:785`).
- Atajos globales (`shortcuts.rs`): Ctrl+Alt+Espacio abre el chat, etc. Valores por defecto en `shortcuts.rs:61-71`. Se registran por nombre de acción, no por "Coucou".
  El argumento `--shortcut` es del propio programa.
- Docs que explican las condiciones de uso de la marca: `../LICENSE-ASSETS.md`.

**Ícono:** `src-tauri/icons/` (`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.ico`, `icon.png`), referenciados en `tauri.conf.json` (`bundle.icon`).
Se generan con `npm run icons` (`scripts/gen-icons.mjs`). La bandeja del sistema usa el ícono por defecto de la ventana (`tray.rs:68`), o sea el mismo.

**Sonidos:** son 29 archivos `.wav` y **viven fuera de `windows/`**: en `../NotchBuddy/Resources/sounds/` (compartidos con el Mac).
`vite.config.ts:9` (`SOUNDS_DIR`) los sirve en desarrollo y los copia a `dist/sounds/` al compilar. La lista de nombres está en `src/core/sound.ts:10`
(`SOUND_NAMES`) y qué sonido va con cada estado en `STATE_SOUND` (`engine.ts:109`). Sonidos propios del usuario: carpeta `config_dir()/sounds`
(`sounds.rs`), reemplazan por nombre. **Para quitar los de Mochi** habrá que cambiar `SOUNDS_DIR` (o vaciar la carpeta) y decidir si el botón "silencio" basta.

## 8. Otras cosas que conviene saber

- **Pruebas que existen:** `npm test` (466 pruebas de TypeScript, `tests/`) y `cargo test` (pruebas dentro de los archivos de Rust, p. ej. `agents.rs`, `shortcuts.rs`).
  CI de Windows: `../.github/workflows/windows-ci.yml`.
- **Enlace con el teléfono / Android** (`phone_link/`, `src/island/phone-link.ts`): servidor TLS local y relevo opcional. Está apagado salvo que el usuario lo active.
  No es parte del plan de Roni; **no lo toques** salvo que una rebanada lo pida (criterio 17).
- **Integraciones** (Stripe, GitHub, Vercel, Spotify, WhatsApp, etc.): `integrations.rs`, `github.rs`, `spotify.rs`, `whatsapp/`, `src/core/pills.ts`. Son muchas; en el plan no se tocan.
- **Configuración y preferencias:** `settings.rs` (guarda JSON en `config_dir()`), lado interfaz `src/core/state.ts` (`Settings`, `State`).
- **Idiomas:** `src/i18n/` (12 idiomas) y `src-tauri/src/i18n.rs` (bandeja y errores de Rust). El español (`es`) ya está entre los 12 (en, zh-Hans, hi, es, ar, fr, bn, pt-BR, ru, id, de, tr), pero los textos nuevos de Roni hay que traducirlos al editar `strings.json`.
- **Reglas heredadas que chocan con Roni:** ver "Cómo conviven las dos guías" en `../CLAUDE.md`.

## 9. Resumen por rebanada: dónde se toca

| Rebanada | Archivos principales |
|---|---|
| 1 Identidad | `tauri.conf.json`, los tres `Cargo.toml`, `package.json`, `platform/windows.rs`, `pipe.rs` + `hook/src/win.rs`, `secrets.rs`, `tray.rs`, `lib.rs`, `update.rs`, `src-tauri/icons/`, `vite.config.ts` (sonidos), `i18n/*` |
| 2 Personaje | `src/mochi/engine.ts` (`draw`, `BOT_STATES`), `outfits.ts`/`wardrobe.ts` (desactivar), `greeting.ts`, `minibots.ts`, `src/views/wardrobe.ts` |
| 3 Chat | `src/core/providers.ts`, `src/views/chat.ts`, `chat.rs` (texto del sistema), `local_chat.rs`, `settings.rs`, `secrets.rs` |
| 4 Dictado en chat | `flow/mod.rs` (`is_shell`, foco), `flow/paste.rs`, `flow/os_windows.rs`, `src/views/chat.ts` |
| 5 "Oye Roni" | `voice/wake.rs`, `voice/brain.rs`, `voice/mod.rs` (`requirements_met`), `src/island/voice.ts` |
| 6 Instalador | `tauri.conf.json` (`bundle`, `nsis/hooks.nsh`), `scripts/pack.mjs`, plugin `autostart` |

## 10. Cómo compilar en esta laptop (verificado en la Rebanada 0)

Requisitos que quedaron instalados: Rust estable 1.99.1 (rustup, perfil mínimo), Node 24, y Visual Studio Build Tools **2022**
con C++ y SDK de Windows 11 (las Build Tools 2019 no bastan, ver `decisiones.md`). WebView2 ya venía con Windows.

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"   # solo si la terminal es anterior a instalar Rust
cd D:\Roni\windows
npm install                  # una vez
npm run build                # tsc + vite (además compila coucou-hook en release)
npm test                     # 466 pruebas de TypeScript
cargo build --workspace      # Rust, en debug (coucou.exe y coucou-hook.exe en windows\target\debug)
cargo test --workspace       # 517 pruebas de la app + 30 del relevo
```

Resultado de la Rebanada 0 (sin cambios al código): todo lo anterior compila y pasa. **No se ejecutó la app.** Dani ya tiene Coucou 0.5.3 instalado y la versión de prueba es la misma app para Windows
(`fr.louisraille.coucou`, instancia única en `lib.rs:785`), así que se dejó para que Dani la pruebe con estos pasos.

### Cómo probar la app sin cambios (de forma segura)
1. Cierra Coucou 0.5.3 desde el ícono de la bandeja → **Quit/Salir**. Si sigue abierto, la versión de prueba se cierra sola y solo abre el Coucou instalado.
2. Corre la versión de prueba:
   ```powershell
   $env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
   cd D:\Roni\windows
   npm run tauri dev
   ```
3. Ten en cuenta que, mientras no exista la identidad propia de la Rebanada 1, la versión de prueba **comparte con el Coucou instalado**: las preferencias
   (`%APPDATA%\Coucou`), las claves del Administrador de credenciales y la tubería de los hooks. Además, al arrancar reemplaza
   `%LOCALAPPDATA%\Coucou\bin\coucou-hook.exe` por la versión de prueba (`ensure_hook_exe`, `hooks.rs:350`); Coucou 0.5.3 lo restaura al volver a abrirse.
4. Para volver atrás: cierra la versión de prueba (bandeja → Salir) y abre de nuevo Coucou 0.5.3.

## 11. Estado después de la Rebanada 1 (nombres nuevos)

Este mapa se escribió antes de renombrar: donde diga `coucou`, `Coucou` o `coucou-hook` en las secciones 1 a 9, ahora es `roni`, `Roni` y `roni-hook`
(las rutas y números de línea siguen siendo los mismos salvo donde se anotó). Lo que cambió de verdad:

| Qué | Antes | Ahora |
|---|---|---|
| Datos (preferencias) | `%APPDATA%\Coucou` | `%APPDATA%\Roni` |
| Datos locales (hook, modelos, registro) | `%LOCALAPPDATA%\Coucou` | `%LOCALAPPDATA%\Roni` |
| Hook | `coucou-hook.exe` | `roni-hook.exe` |
| Named pipe | `\\.\pipe\coucou-<SID>` | `\\.\pipe\roni-<SID>` |
| Identificador / servicio de credenciales | `fr.louisraille.coucou` | `com.ldanielmc.roni` |
| Marca en `settings.json` de Claude Code | `coucou-hook` | `roni-hook` |
| Ejecutable | `coucou.exe` | `roni.exe` |
| Atajos globales | `Ctrl+Alt+…` | `Ctrl+Alt+Shift+…` |
| Actualizador | activo (con permiso) | apagado (`UPDATES_ENABLED`, `update.rs`) |
| Sonidos | 29 WAV de Mochi (`../NotchBuddy/Resources/sounds`) | ninguno (`windows/sounds/`) |

Siguen existiendo, a propósito: el personaje Mochi dibujado en `src/mochi/` (Rebanada 2), los nombres internos en minúscula (`mochiOutfit`, `desktop_mochi_*`),
el protocolo del teléfono (`coucou://`, `_coucou._tcp`) y la frase de voz, que ahora es solo "OK Roni" en `voice/wake.rs` (la definitiva, "Oye Roni", es de la Rebanada 5). Ver `decisiones.md`.

**Si quieres reusar lo de tu Coucou instalado** (no se hace solo, y copiar no borra nada): los modelos de voz pesan cientos de MB; en PowerShell,
con las dos apps cerradas: `Copy-Item "$env:LOCALAPPDATA\Coucou\Models" "$env:LOCALAPPDATA\Roni\Models" -Recurse`.
Las claves (Administrador de credenciales) no se copian: Roni empieza sin ninguna, y el token de OpenClaw se pide en la Rebanada 3.
