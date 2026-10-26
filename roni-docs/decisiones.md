# Decisiones

- **Fork de Coucou en lugar de app desde cero (Electron):** Coucou ya resuelve isla, dictado, voz, agentes y Android.
  El trabajo es darle identidad de Roni y conectarlo a OpenClaw.
- **Roni es el protagonista:** el chat, la voz y el personaje son de Roni. Nada de Mochi.
- **Personaje 2D plano**, diseño base en `diseno/roni.svg` (gorro negro, ojitos verticales, boca de línea).
- **Cerebro en OpenClaw** vía endpoint compatible con OpenAI en 127.0.0.1:18789. La app no llama a Anthropic directo
  para hablar como Roni.
- **No convivir en conflicto con Coucou:** nombre de app, carpeta de datos, named pipe, ejecutable del hook y
  atajos propios, para que ambos no choquen mientras Dani prueba.
- **Actualizaciones:** el actualizador no debe descargar versiones del Coucou original.
- **Android y "OK Roni" con voz propia** van después de tener la versión de escritorio estable.
- **Compilar en Windows requiere Visual Studio Build Tools 2022 (MSVC 14.4x), no solo las 2019 (decidido en la Rebanada 0):**
  con MSVC 14.29 (2019) el enlace falla porque las librerías precompiladas de voz (sherpa-onnx) usan símbolos de la
  biblioteca estándar de C++ (`__std_find_trivial_*`, `__std_min_element_*`…) que solo trae la 2022. Dani autorizó instalar
  las Build Tools 2022 (componente C++ + SDK de Windows 11) y Rust estable (rustup, perfil mínimo). La CI original usa `windows-latest` (VS 2022).
- **Las reglas de release de Coucou (CHANGELOG, tabla de versiones, what's new) no aplican a Roni hasta la Rebanada 6**
  (ver `CLAUDE.md`, "Cómo conviven las dos guías"). Confirmado por Dani.
- **El subagente `revisor` se versiona en git** (`.claude/agents/`); el resto de `.claude/` sigue ignorado (`.gitignore`). `CLAUDE.roni.md` se borró: su contenido está en `CLAUDE.md`.
- **Identidad de Roni en Windows (Rebanada 1):** nombre `Roni`; identificador de la app `dev.roni.desktop` (no puede terminar en `.app`,
  Tauri lo desaconseja); paquetes de Rust `roni`, `roni_lib` y `roni-hook`; carpeta de datos `%APPDATA%\Roni`; carpeta local (hook, modelos, registro)
  `%LOCALAPPDATA%\Roni`; hook `%LOCALAPPDATA%\Roni\bin\roni-hook.exe`; named pipe `\\.\pipe\roni-<SID>`; servicio del Administrador de credenciales
  `dev.roni.desktop`; marca de los hooks en `settings.json` de Claude Code: `roni-hook`. Así Roni y un Coucou instalado conviven: cada uno ve solo sus propios hooks.
- **Se dejan como están a propósito** (contratos con terceros, no se ven): URLs de GitHub dentro de pruebas, y el protocolo del enlace con el teléfono
  (`coucou://pair`, `coucou.v1`, `_coucou._tcp`, relevo `coucou-link…`) hasta que exista una app de Android de Roni.
  Nombres internos de código en minúscula (`mochi`, `mochiOutfit`, `desktop_mochi_*`, carpeta `src/mochi/`) se renombran en la Rebanada 2 junto con el personaje.
- **Actualizador apagado** (`UPDATES_ENABLED = false` en `update.rs`, direcciones vacías, filas de Settings ocultas): Roni no se actualiza solo hasta que la Rebanada 6
  decida dónde publica. La tarjeta de "novedades" también queda sin entradas, y se quitó su botón de pago "Buy … a coffee" (era un enlace de Stripe del autor de Coucou).
- **Sonidos:** Roni queda en silencio. `windows/sounds/` está vacía y `vite.config.ts` ya no apunta a los WAV de Mochi del Mac. Los sonidos propios del usuario siguen funcionando.
- **Atajos globales propios:** los valores por defecto llevan Shift añadido (`Ctrl+Alt+Shift+Espacio`, `…+A`, etc.) para no chocar con los `Ctrl+Alt+…` de Coucou instalado.
  Ojo: la tecla de dictado (Ctrl derecho) la escucha cada app con su propio gancho; si el dictado está activo en las dos a la vez, ambas pegarían el texto.
- **"OK Roni" provisional:** la interfaz dice "OK Roni" y el detector (`voice/wake.rs`) entiende solo "roni" (y variantes como "ronnie"), **nunca** "coucou": con Coucou instalado,
  una frase debe despertar a una sola app. La frase definitiva ("Oye Roni") y el destino (OpenClaw) son de la Rebanada 5.
- **CI heredada (`.github/workflows/`):** se actualizaron los nombres que cambiaron (`-p roni-hook`, `Roni-Windows-…`, `Roni-Linux-…`, `roni.exe`) para que no se rompa, y el paso
  "What's new" de `windows-ci.yml` queda desactivado (`if: false`) hasta la Rebanada 6. Los flujos de publicación (`windows.yml`, `linux.yml`) siguen siendo los del original en lo demás
  y no se han ejecutado: se revisan en la Rebanada 6.
- **Textos traducidos:** la regla "Coucou/Mochi → Roni" vive en `windows/scripts/rebrand.mjs` y la usa `scripts/gen-strings.mjs`, así `strings.json` sigue siendo reproducible desde el catálogo del Mac.
- **Ícono:** generado con `tauri icon` desde `roni-docs/diseno/roni.svg` (se quitó `scripts/gen-icons.mjs`, que dibujaba a Mochi).
