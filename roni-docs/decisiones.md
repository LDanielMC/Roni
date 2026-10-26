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
