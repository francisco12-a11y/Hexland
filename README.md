# ⬡ Hexland

Clon jugable del clásico juego de colonos sobre una isla de hexágonos. 100% client-side, sin backend, sin build — pensado para jugarse desde GitHub Pages.

## Estado

**v0.2 — pass & play + salas online (PeerJS)**

- **Pass & play**: 2 a 4 jugadores comparten pantalla.
- **Online**: el host crea una sala, comparte el código de 4 caracteres (o el link `?sala=CODIGO`), los demás se suman desde su navegador y juegan cada uno en el suyo. Arquitectura **host-authoritative**: el host corre las reglas, valida cada acción y broadcastea el estado completo; el cliente solo dibuja.

Lo que incluye:

- Tablero aleatorio de 19 hexágonos con semilla reproducible (no hay 6/8 pegados)
- Marco de puertos fijo: 9 puertos en las mismas posiciones siempre (4× 3:1, 5× 2:1), cada uno conectado a un vértice de 1 hex + uno de 2 hexes
- Colocación inicial en serpiente (con recursos en el segundo asentamiento)
- Dados, producción con resaltado de hexágonos y carteles "+N", ladrón, descarte de más de 7 cartas y robo
- Construcción de caminos, asentamientos y ciudades (regla de distancia, conectividad por caminos propios y piezas limitadas)
- Comercio con el banco (4:1, y 3:1 / 2:1 si tocás puerto)
- Victoria a los 8 puntos (asentamientos y ciudades — con cartas de desarrollo y camino comercial el umbral clásico vuelve a ser 10)

## Cómo jugar online

1. El host entra, pestaña **Online**, pone su nombre y toca **Crear sala**.
2. Comparte el código (o el link copiado).
3. Los jugadores entran al link, ponen su nombre y tocan **Unirme**.
4. El host toca **Comenzar partida** cuando estén todos.

Limitaciones v0.2: si el host se va, se corta la partida (migración de host en el roadmap); el estado completo viaja a todos (con amigos, confía 😄); algunas redes móviles con CGNAT pueden necesitar TURN (roadmap).

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
