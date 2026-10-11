// Diagnóstico del ciclo costero y los puertos (corre con: node tools/coast-debug.mjs)
import { generateBoard } from '../src/board.js';

for (const seed of [5, 7, 21]) {
  const b = generateBoard(seed);
  const hexOf = (vid) => b.vertices[vid].hexes.length;
  console.log(`--- semilla ${seed} ---`);
  console.log('perim edges:', b.ports.length ? 'n/a' : 'n/a', '| coast entries:', b.coast.length);
  console.log('ciclo (hexes por vértice):', b.coast.map(hexOf).join(' '));
  const uniq = new Set(b.coast);
  console.log('vértices únicos en el ciclo:', uniq.size);
  for (const p of b.ports) {
    const [a, c] = p.vids.map(hexOf);
    console.log(`puerto ${p.id} (${p.type}): accesos ${a}+${c} hex`);
  }
}
