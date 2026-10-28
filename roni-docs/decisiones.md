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
- **Identidad de Roni en Windows (Rebanada 1):** nombre `Roni`; identificador de la app `com.ldanielmc.roni` (no puede terminar en `.app`,
  Tauri lo desaconseja); paquetes de Rust `roni`, `roni_lib` y `roni-hook`; carpeta de datos `%APPDATA%\Roni`; carpeta local (hook, modelos, registro)
  `%LOCALAPPDATA%\Roni`; hook `%LOCALAPPDATA%\Roni\bin\roni-hook.exe`; named pipe `\\.\pipe\roni-<SID>`; servicio del Administrador de credenciales
  `com.ldanielmc.roni`; marca de los hooks en `settings.json` de Claude Code: `roni-hook`. Así Roni y un Coucou instalado conviven: cada uno ve solo sus propios hooks.
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
- **Identificador y versión (decididos por Dani tras probar la Rebanada 1):** el identificador de la app es `com.ldanielmc.roni` (reemplaza al `dev.roni.desktop` que había puesto yo)
  y la versión de Roni es **0.1.0**, porque es una app nueva. Consecuencia: lo que se hubiera guardado en el Administrador de credenciales bajo el servicio anterior queda huérfano
  (Roni no lo lee); los datos en `%APPDATA%\Roni` y `%LOCALAPPDATA%\Roni` no cambian de lugar.
- **El personaje "bombón" (Rebanada 2):** Roni se dibuja en código (`windows/src/mochi/roni.ts`) a partir de `roni-docs/diseno/roni.svg`: superelipse n=2.7, degradados, bisel, brillo,
  gorro con costillas y pompón, ojitos con brillito. Es una sola pieza, en todos los tamaños. Lo que no se distingue se quita al achicarse: por debajo de 60 px de cuerpo, las costillas del gorro y la curva de la base;
  por debajo de 30 px, además, el bisel, el brillo, el contorno, el doblez del gorro, el brillito de los ojos y las burbujas del pensamiento; por debajo de 18 px, la boca.
  Los ojos, en cambio, crecen para que se vean (así se ve bien en la isla). El motor (`engine.ts`) conserva su API; lo que hace es nuevo: caras y movimiento de gelatina alrededor de la base.
- **Estados de los agentes → expresiones** (el documento de diseño no dice cuál va con cuál; esta es la elección): inactivo = tranquilo; trabajando, pensando, buscando y límite de uso = pensando
  (burbujitas); permiso pendiente = avisando (mira al usuario y tiembla un poco hasta que se responde); pregunta pendiente = avisando, con la cabeza inclinada y sin temblor; terminó = contento + salto; error = sorprendido; dormido = dormido;
  mareado (tres clics seguidos) = sorprendido con balanceo. "Hablando" no es un estado de agente: la boca se mueve mientras llega la respuesta del chat y mientras habla la voz.
  "Escuchando" del plan original ya no existe en el diseño: al escuchar, Roni está tranquilo.
- **Una sola Roni por encabezado de sección y como logo de la ventana** (antes eran 2 a 5 Mochis de colores con disfraces). Las píldoras de servicios siguen distinguiéndose: su Roni toma el color
  del servicio en el cuerpo (gorro negro siempre). La Roni principal de la isla toma el color de la píldora enfocada, igual que antes.
- **Guardarropa apagado** (el gorro es parte de Roni): sin clic derecho, sin entrada en la bandeja, sin atajo (`wardrobeToggle` queda reservado como no disponible). El código de
  `outfits.ts`, `wardrobe.ts` y `views/wardrobe.ts` sigue en el repositorio sin usarse; se borra cuando se decida limpiar lo heredado.
- **Sin manos:** "No agregar cuerpo, brazos ni piernas". El saludo del arranque y el saludo de los mini-Ronis ahora son un balanceo alegre alrededor de la base.
- **Consumo:** Roni respira todo el tiempo, y cada redibujo obliga a Windows a recomponer la ventana transparente (medido: ~0.1 % de la máquina por cada cuadro por segundo). Por eso, cuando solo hay
  respiración, el bucle de la isla corre a 6 cuadros por segundo (10 si Roni está grande) y despierta al instante con cualquier evento; los lienzos de la ventana grande van a 30 fps; la sombra del piso es un
  degradado, no un desenfoque; y el cuerpo con el gorro se pinta una vez por tamaño y color y se reutiliza. Medido en esta laptop (12 hilos, versión de desarrollo): con la ventana grande oculta,
  Roni completo (isla, mini-Ronis y Roni de escritorio) gasta ~0.2 % y 0 % de GPU, como el Coucou original (~0.14 %); con la ventana grande abierta gasta ~5.7 % (el original midió ~2.3 %, pero en otra sesión).
- **Íconos:** regenerados con `tauri icon` desde el diseño bombón (sin sombra del piso ni metadatos C2PA del SVG).
- **Herramienta:** `windows/dev/roni-preview.html` (con `npm run dev`) muestra todas las caras a todos los tamaños; no se empaqueta.
- **Temblor del permiso pendiente más visible:** probando en vivo (eventos simulados por el pipe, medido en capturas) el temblor original de 0.035 radios de cuerpo se movía solo ~1 px en la tarjeta del permiso y no se notaba. Subió a 0.09: ≈ ±2.3 px en la tarjeta del permiso (Roni de 56 px, que se abre sola al llegar el permiso), ≈ ±0.8 px en la isla compacta y ≈ ±1 px en los mini-Ronis de las píldoras. Tiembla en ráfagas de 0.6 s cada 1.8 s; cada ráfaga se va apagando y se repite hasta que se responde.
