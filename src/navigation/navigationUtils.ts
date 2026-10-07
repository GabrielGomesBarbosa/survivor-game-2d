/**
 * @file navigationUtils.ts
 * @description Navigation grid raycasting, line-of-sight clearance, and weighted grid generation.
 */

import { getGeneratorOccupiedTiles } from './standoffUtils';

export * from './standoffUtils';
export * from './patrolUtils';
export * from './pathSmoothing';

/**
 * Atualiza o navGrid combinando as paredes arquitetônicas base com os ladrilhos bloqueados por geradores ativos:
 * 0 = piso transitável
 * 1 = sólido intransponível (parede arquitetônica '#' ou gerador ativo)
 */
export function updateNavGridWithGenerators(
  baseNavGrid: number[][],
  generators: Array<{ x: number; y: number; rotation?: number }>,
  tileSize: number = 64
): number[][] {
  const rows = baseNavGrid.length;
  if (rows === 0) return [];
  const cols = baseNavGrid[0].length;

  // Clone o grid base defensivamente
  const updatedGrid: number[][] = baseNavGrid.map((row) => [...row]);

  generators.forEach((gen) => {
    const tiles = getGeneratorOccupiedTiles(gen.x, gen.y, gen.rotation ?? 0, tileSize, cols, rows);
    tiles.forEach(({ col, row }) => {
      if (row >= 0 && row < rows && col >= 0 && col < cols) {
        updatedGrid[row][col] = 1; // Bloqueado intransponível
      }
    });
  });

  return updatedGrid;
}

/**
 * Constrói a malha de busca ponderada para o EasyStar A*:
 * - 0: Célula livre e afastada de paredes (custo padrão 1)
 * - 1: Parede arquitetônica sólida (intransponível)
 * - 2: Célula livre imediatamente adjacente a paredes ou quinas (custo elevado 4)
 *
 * Isso orienta a heurística do A* a preferir o centro dos corredores e salas,
 * afastando o trajeto do Killer das quinas e mantendo folga física.
 *
 * @param navGrid Matriz binária 0 (livre) e 1 (parede).
 * @returns Matriz com custos para o EasyStar.
 */
export function buildAiWeightedGrid(navGrid: number[][]): number[][] {
  const rows = navGrid.length;
  if (rows === 0) return [];
  const cols = navGrid[0].length;
  const weighted: number[][] = [];

  for (let r = 0; r < rows; r++) {
    weighted[r] = new Array(cols);
    for (let c = 0; c < cols; c++) {
      if (navGrid[r][c] === 1) {
        weighted[r][c] = 1; // Parede
      } else {
        // Verifica se é adjacente a alguma parede (8 direções)
        let nearWall = false;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && navGrid[nr][nc] === 1) {
              nearWall = true;
              break;
            }
          }
          if (nearWall) break;
        }
        weighted[r][c] = nearWall ? 2 : 0;
      }
    }
  }

  return weighted;
}

/**
 * Testa se um segmento retilíneo possui passagem desobstruída na malha navGrid,
 * considerando uma margem transversal de folga em pixels (raio físico da entidade).
 *
 * @param x1 Ponto inicial X.
 * @param y1 Ponto inicial Y.
 * @param x2 Ponto final X.
 * @param y2 Ponto final Y.
 * @param navGrid Matriz de navegação onde 1 = parede.
 * @param margin Margem de folga lateral em pixels (padrão: 34px).
 * @param tileSize Tamanho do bloco em pixels (padrão: 64px).
 */
export function isRayClearOnNavGrid(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  navGrid: number[][],
  margin: number = 34,
  tileSize: number = 64
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) return true;

  const nx = -dy / dist;
  const ny = dx / dist;

  const rows = navGrid.length;
  const cols = navGrid[0].length;

  // Amostragem transversal de segurança (centro, raio positivo e raio negativo)
  const stepSize = tileSize * 0.4;
  const steps = Math.ceil(dist / stepSize);

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = x1 + dx * t;
    const cy = y1 + dy * t;

    // Suaviza a margem nas extremidades (t = 0 e t = 1) para permitir que o raio comece e termine
    // em nós válidos sem falso-positivo por proximidade imediata com paredes
    const endpointFactor = Math.min(1, Math.sin(t * Math.PI) * 2.0);
    const effMargin = margin * endpointFactor;

    const testPoints = [
      { x: cx, y: cy }
    ];
    if (effMargin > 1) {
      testPoints.push(
        { x: cx + nx * effMargin, y: cy + ny * effMargin },
        { x: cx - nx * effMargin, y: cy - ny * effMargin }
      );
    }

    for (const pt of testPoints) {
      const col = Math.floor(pt.x / tileSize);
      const row = Math.floor(pt.y / tileSize);
      if (row < 0 || row >= rows || col < 0 || col >= cols || navGrid[row]?.[col] === 1) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Realiza teste de visibilidade física espessa (Thick Raycast / Capsule Cast / Sphere Cast).
 * Verifica se uma cápsula ou esfera de raio `clearanceRadius` (padrão: 45px) centrada ao longo
 * do segmento (x1, y1) -> (x2, y2) intersecta qualquer ladrilho sólido (navGrid === 1 ou weightedGrid === 1)
 * ou quinas de paredes.
 *
 * @param x1 Ponto inicial X
 * @param y1 Ponto inicial Y
 * @param x2 Ponto final X
 * @param y2 Ponto final Y
 * @param navGrid Matriz de navegação onde 1 = parede/sólido
 * @param clearanceRadius Raio de folga física do corpo em pixels (padrão: 45px)
 * @param tileSize Tamanho do bloco em pixels (padrão: 64px)
 * @param weightedGrid Opcional: matriz de pesos de IA onde 1 = parede
 */
export function hasClearanceLineOfSight(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  navGrid: number[][],
  clearanceRadius: number = 45,
  tileSize: number = 64,
  weightedGrid?: number[][]
): boolean {
  if (!navGrid || navGrid.length === 0) return true;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);

  const rows = navGrid.length;
  const cols = navGrid[0].length;

  if (dist < 2) {
    const col = Math.floor(x1 / tileSize);
    const row = Math.floor(y1 / tileSize);
    return !(
      row < 0 ||
      row >= rows ||
      col < 0 ||
      col >= cols ||
      navGrid[row]?.[col] === 1 ||
      (weightedGrid && weightedGrid[row]?.[col] === 1)
    );
  }

  // Amostragem transversal de segurança (passo de no máximo 16px para não pular quinas)
  const stepSize = Math.min(16, tileSize * 0.25);
  const steps = Math.max(1, Math.ceil(dist / stepSize));

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = x1 + dx * t;
    const cy = y1 + dy * t;

    // Fator de suavização nas extremidades (t = 0 e t = 1) para permitir que o raio comece e termine
    // em nós válidos (mesmo próximos a paredes) sem falso-positivo de colisão local imediata
    const endpointFactor = Math.min(1, Math.sin(t * Math.PI) * 2.0);
    const effClearance = clearanceRadius * endpointFactor;

    if (effClearance <= 0) {
      const col = Math.floor(cx / tileSize);
      const row = Math.floor(cy / tileSize);
      if (
        row < 0 ||
        row >= rows ||
        col < 0 ||
        col >= cols ||
        navGrid[row]?.[col] === 1 ||
        (weightedGrid && weightedGrid[row]?.[col] === 1)
      ) {
        return false;
      }
      continue;
    }

    // Bounding box de ladrilhos a inspecionar para o círculo centrado em (cx, cy) com raio effClearance
    const minCol = Math.floor((cx - effClearance) / tileSize);
    const maxCol = Math.floor((cx + effClearance) / tileSize);
    const minRow = Math.floor((cy - effClearance) / tileSize);
    const maxRow = Math.floor((cy + effClearance) / tileSize);

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const isSolid =
          r < 0 ||
          r >= rows ||
          c < 0 ||
          c >= cols ||
          navGrid[r]?.[c] === 1 ||
          (weightedGrid && weightedGrid[r]?.[c] === 1);

        if (isSolid) {
          const boxX1 = c * tileSize;
          const boxX2 = (c + 1) * tileSize;
          const boxY1 = r * tileSize;
          const boxY2 = (r + 1) * tileSize;

          const closestX = Math.max(boxX1, Math.min(cx, boxX2));
          const closestY = Math.max(boxY1, Math.min(cy, boxY2));

          const dSq = (cx - closestX) * (cx - closestX) + (cy - closestY) * (cy - closestY);
          if (dSq < effClearance * effClearance) {
            return false; // Colisão com parede ou quina detectada
          }
        }
      }
    }
  }

  return true;
}
