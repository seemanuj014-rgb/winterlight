export interface Silhouette {
  source: string;
  width: number;
  height: number;
  points: [number, number][];
  point_count: number;
  cropped_at_bottom: boolean;
}

export function validateSilhouette(s: Silhouette): string[] {
  const problems: string[] = [];
  if (s.points.length < 20) problems.push('too few points');
  if (s.points.length !== s.point_count) problems.push('point_count does not match points');
  for (const [x, y] of s.points) {
    if (x < 0 || x > 1 || y < 0 || y > 1) {
      problems.push('point outside 0..1');
      break;
    }
  }
  return problems;
}

export function boundsOf(s: Silhouette): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const [x, y] of s.points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}
