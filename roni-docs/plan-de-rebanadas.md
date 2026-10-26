# Plan por rebanadas

Cada rebanada: rama propia, revisión, commit y **detenerse** para que Dani pruebe.

## Rebanada 0 — Entender el código (sin cambios)
- Fusionar `CLAUDE.roni.md` con el `CLAUDE.md` del proyecto original: conservar su guía técnica y agregar el flujo de Roni.
- Revisar qué necesita la laptop para compilar la versión de Windows (Rust, herramientas de Visual Studio, etc.).
  **Preguntar antes de instalar.**
- Compilar y correr la app sin cambios.
- Escribir `roni-docs/mapa-coucou.md`: dónde se dibuja Mochi, cómo funcionan sus estados, el chat y sus proveedores,
  "OK Coucou", el dictado, los hooks de Claude Code, el actualizador y dónde están nombre, ícono y sonidos.

## Rebanada 1 — Identidad de Roni
- Nombre "Roni", identificador de app, ícono y textos.
- Quitar sonidos de Mochi (dejar silencio o sonidos originales simples).
- Carpeta de datos, named pipe, ejecutable del hook y atajos propios para no chocar con Coucou instalado.
- Desactivar o redirigir el actualizador.
- Conservar la licencia MIT del código.

## Rebanada 2 — El personaje
- Dibujar a Roni según `roni-docs/diseno/` con el motor de dibujo existente.
- Estados: tranquilo, escuchando, pensando, hablando, contento, sorprendido y avisando.
- Desactivar el guardarropa de Mochi (el gorro es parte de Roni).

## Rebanada 3 — Roni en el chat
- El chat habla con Roni por defecto (endpoint de OpenClaw).
- Primera vez: pedir el token del gateway y guardarlo en el Administrador de credenciales.
- Simplificar los ajustes del chat.

## Rebanada 4 — Dictado dentro del chat
- Que Ctrl derecho (o un botón de micrófono) escriba en el chat de la isla.

## Rebanada 5 — "Oye Roni"
- Frase de activación propia, y que la petición vaya a Roni (OpenClaw), no a Claude directo.
- Respuestas en voz alta con la voz del sistema.

## Rebanada 6 — Instalador
- Instalador de Windows y arranque con Windows.
- Instrucciones cortas en roni-docs para instalar y actualizar.

## Después
- App de Android para Roni.
- Voz propia de Roni.
