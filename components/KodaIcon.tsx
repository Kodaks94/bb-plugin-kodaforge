// Koda's head as a one-colour pixel icon (eyes, nose and smile cut out), so it
// tints like BB's own icons in the sidebar and tab strip. Generated from the
// same grid as the mascot in lib/koda-sprite.ts.
const RUNS: [x: number, y: number, w: number][] = [[2, 1, 2], [12, 1, 2], [1, 2, 4], [11, 2, 4], [1, 3, 15], [1, 4, 14], [0, 5, 16], [0, 6, 4], [6, 6, 4], [12, 6, 4], [0, 7, 4], [6, 7, 4], [12, 7, 4], [0, 8, 16], [0, 9, 7], [9, 9, 7], [0, 10, 6], [7, 10, 2], [10, 10, 6], [1, 11, 6], [9, 11, 6], [3, 12, 10], [3, 13, 10]];

export function KodaIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" shapeRendering="crispEdges" fill="currentColor" aria-hidden="true">
      {RUNS.map(([x, y, w], i) => (
        <rect key={i} x={x} y={y} width={w} height={1} />
      ))}
    </svg>
  );
}
