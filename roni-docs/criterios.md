# Criterios de revisión

## Alcance y proceso
1. No salirse de la rebanada actual del plan. Lo nuevo se propone y espera aprobación.
2. Una rama por tarea; commit al terminar cada rebanada con mensaje claro (qué y por qué).
3. No instalar herramientas ni librerías sin aprobación de Dani.
4. Actualizar los documentos de roni-docs/ cuando cambie el plan o una decisión.

## Licencia e identidad
5. Conservar el aviso de copyright y la licencia MIT del código original.
6. Cero rastros de Mochi/Coucou en lo que ve el usuario: nombre, personaje, ícono, sonidos, textos y enlaces.
7. El personaje sigue `roni-docs/diseno/personaje.md` y es original.

## Seguridad
8. El token del gateway solo en el Administrador de credenciales de Windows. Nunca en código, repo, logs ni URLs.
9. Solo conexiones a 127.0.0.1 para Roni. No abrir puertos hacia afuera.
10. La app nunca aprueba permisos de agentes por su cuenta.
11. No modificar ~/.claude/settings.json sin mostrar el cambio y pedir aprobación (como hace Coucou).
12. El actualizador no debe instalar builds del repositorio original.

## Honestidad sobre lo verificado
13. Separar lo verificado (compila, pruebas) de lo que no se vio funcionando en la laptop de Dani.
14. Verificar APIs (OpenClaw, Tauri) en documentación oficial, no de memoria, y citar la página.
15. Si algo sale mal, decirlo y repararlo.

## Calidad
16. Leer los archivos antes de modificarlos; cambios pequeños y enfocados.
17. No romper lo que ya funciona de Coucou (dictado, hooks de Claude Code, notetaker) salvo que la rebanada lo pida.
18. Si OpenClaw no está disponible, la app lo dice claro y reintenta sola.

## Comunicación
19. Al terminar, decir exactamente qué probar y cómo, con comandos de PowerShell completos.
20. Español sencillo. Preguntas concretas cuando algo dependa de Dani.
