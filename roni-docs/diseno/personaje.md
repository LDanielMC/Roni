# Personaje de Roni

Diseño base aprobado por Dani: `roni.svg` (versión "bombón"). Este archivo reemplaza a cualquier versión anterior.

## Forma
- Cuerpo de **bombón (marshmallow)**: superelipse con exponente **n = 2.7**
  (|x/a|^n + |y/b|^n = 1), un poco más alto que ancho (a = 150, b = 142 en el SVG de referencia).
- Se ve "cabezón" a propósito: es todo cabeza, como un bombón. No agregar cuerpo, brazos ni piernas.

## Color, volumen y brillo
- Cuerpo cremita: degradado vertical #FFFFFF → #FCF8F1 → #EEE3D3. Borde suave #D8CCBA.
- **Bisel:** sombreado difuso en los costados y en la base (#D6C6AE / #E3D5C0, desenfocado) y una curva suave de base.
- **Brillo:** reflejo blanco difuso arriba a la izquierda del cuerpo.
- **Sombra** difusa en el piso, debajo de Roni.
- Debe verse bien en tamaño pequeño (la isla): si un detalle no se distingue en chico, se simplifica en ese tamaño.

## Gorro
- Gorro de invierno **negro** que cubre toda la parte de arriba y sigue la forma de la cabeza.
- Copa con degradado #454545 → #1C1C1C y un reflejo suave; doblez #2A2A2A → #0E0E0E con costillas verticales #3C3C3C.
- Pompón redondo con degradado radial (#6A6A6A → #1E1E1E).

## Cara
- Dos ojitos **ovalados verticales** (#1E1E1E) con un **brillito blanco** arriba a la izquierda de cada uno.
- Boquita: curva pequeña tipo sonrisa (#1E1E1E).
- Sin mejillas, sin lentes, sin audífonos.

## Expresiones
- **Tranquilo:** ojitos normales, sonrisita.
- **Contento:** ojitos en arquito (∩ ∩), boca abierta en sonrisa.
- **Pensando:** ojitos un poco más arriba, boca recta corrida a un lado, burbujitas de pensamiento.
- **Sorprendido:** ojitos más grandes, boca en "o".
- **Hablando:** boca ovalada que se abre y cierra al ritmo de la respuesta.
- **Dormido:** ojitos cerrados (curvas hacia abajo), "Z z".
- **Avisando:** mira al usuario y hace un pequeño movimiento para llamar la atención.

## Movimiento: gelatina / bombón
Técnica de "aplastar y estirar". El punto de apoyo es la base (transform-origin abajo al centro).
- **Respirar (reposo):** escala 1 → (1.025, 0.975) → 1, ciclo de unos 3 s.
- **Parpadeo:** cada ~4 s, los ojos bajan a escala vertical 0.1 por un instante.
- **Apachurrar (clic):** 0.9 s ease-out: (1,1) → (1.28,0.72) → (0.85,1.15) → (1.1,0.9) → (0.95,1.05) → (1.03,0.97) → (1,1).
- **Salto (Claude Code terminó):** se aplasta (1.2,0.8), sube estirado (0.88,1.14), cae y se aplasta (1.22,0.78), rebota a (1,1).
- **Temblor suave (permiso pendiente):** pequeño vaivén lateral repetido hasta que Dani responde.
- **Dormir (sin uso un rato):** respiración más lenta y profunda.

## Regla
Roni es un personaje **original**. No reutilizar dibujos, formas, sonidos ni nombre de Mochi/Coucou.
