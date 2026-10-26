# Contexto

## Qué es
**Roni** es el asistente personal de IA de Dani (Luis Daniel, desarrollador full stack en Cuernavaca).
Su cerebro y su memoria viven en **OpenClaw** (en WSL2/Ubuntu, en la misma laptop), con Claude Sonnet como modelo.
Esta app es **la cara, los oídos y la voz de Roni** en Windows: una isla arriba de la pantalla con su personaje,
chat, dictado y aviso de lo que hacen los agentes de programación.

## Base: fork de Coucou
- Repositorio original: https://github.com/Louis-CFM/coucou (licencia MIT). Versión de partida para Windows: 0.5.3.
- La versión de Windows está en `windows/` (Tauri: Rust + TypeScript).
- Coucou ya trae: isla, dictado sin internet (Parakeet), notetaker, integración con Claude Code (hooks + named pipe),
  chat con proveedores (incluido "Compatible con OpenAI"), "OK Coucou" por voz, integraciones y enlace con Android.
- **Licencia:** el código es MIT (conservar el aviso de copyright). El nombre "Coucou", el personaje Mochi, su ícono y
  sus sonidos tienen todos los derechos reservados (ver LICENSE-ASSETS.md): hay que reemplazarlos todos.

## Cómo habla con Roni (ya probado)
- OpenClaw expone un endpoint compatible con OpenAI: `http://127.0.0.1:18789/v1` (solo local).
- Autenticación: token del gateway (Dani lo obtiene con `openclaw gateway auth-token --show`).
  Debe guardarse en el Administrador de credenciales de Windows, como ya hace Coucou. Nunca en archivos, logs ni el repo.
- El campo `model` es el agente de OpenClaw: `openclaw` / `openclaw/default`.
- Probado en Coucou 0.5.3 con el proveedor "Compatible con OpenAI": Roni respondió con su personalidad.
- Ese token da acceso de dueño a Roni: tratarlo como contraseña.

## Problemas conocidos de Coucou que Roni debe resolver
- El dictado (Ctrl derecho) no pega texto dentro del propio chat de la isla.
- "OK Coucou" usa Claude directo con su propia key: en Roni debe hablar con Roni (OpenClaw).

## Entorno de Dani
- Windows (PowerShell), laptop. Editor: Devin Desktop con Claude Code (suscripción).
- Ya tiene Coucou 0.5.3 instalado con sus hooks de Claude Code activos.
- Explicaciones en español sencillo, sin jerga.
