# ⬡ Hexland

Clon jugable del clásico juego de colonos sobre una isla de hexágonos. 100% client-side, sin backend, sin build — pensado para jugarse desde GitHub Pages.

## Estado

**v0 — prototipo local (pass & play)**: 2 a 4 jugadores comparten una pantalla.

Incluye:

- Tablero aleatorio de 19 hexágonos con semilla reproducible (no hay 6/8 pegados)
- 9 puertos (4× 3:1, 5× 2:1) con acceso desde los vértices costeros
- Colocación inicial en serpiente (con recursos en el segundo asentamiento)
- Dados, producción, ladrón, descarte de más de 7 cartas y robo
- Construcción de caminos, asentamientos y ciudades (con regla de distancia y piezas limitadas)
- Comercio con el banco (4:1, y 3:1 / 2:1 si tocás puerto)
- Victoria a los 10 puntos (asentamientos y ciudades)

## Cómo jugar

Abrí la página, elegí cantidad de jugadores y nombres, y pasá el teclado/mouse en cada turno.

- **Colocación inicial**: en orden serpiente, cada jugador pone 1 asentamiento + 1 camino (dos vueltas).
- **Tu turno**: tirá los dados. Con 7 se mueve el ladrón y los que tienen más de 7 cartas descartan la mitad.
- **Construí** con los botones del panel derecho y hacé clic en el lugar resaltado. `Esc` cancela la selección.
- **Comerciar** con el banco usando la tasa que te corresponda.
- **10 puntos de victoria** gana la partida.

## Roadmap

1. **Salas online con PeerJS (WebRTC)**: el host crea la sala con un código, los demás se suman; estado autoritativo en el host y broadcast del estado completo tras cada acción.
2. Comercio entre jugadores con ofertas y respuestas.
3. Cartas de desarrollo, caballero, camino comercial y ejército más grande.
4. Migración de host y reconexión.

## Desarrollo

No hay build ni dependencias: JS con ES modules.

```bash
python3 -m http.server 8000
# abrí http://localhost:8000
```

- `src/board.js` — geometría del tablero (coords axiales), shuffle de terrenos/números, puertos
- `src/game.js` — reglas puras (sin DOM), lista para correr en el host P2P
- `src/render.js` — render SVG del tablero
- `src/main.js` — lobby, flujo de turnos y modales

> Proyecto de fans, sin relación con Catan GmbH. Nombre y arte originales; solo se implementan las mecánicas.
