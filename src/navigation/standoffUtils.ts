/**
 * @file standoffUtils.ts
 * @description Safe standoff approach points and tile occupancy calculation for generators.
 */

import { GENERATOR_HITBOX_WIDTH, GENERATOR_HITBOX_HEIGHT } from '../physics/generatorHitbox';

/**
 * Calcula a lista de coordenadas discretas de ladrilhos [col, row] cobertos pela hitbox
 * de um gerador (50x112px ou 112x50px dependendo da rotação).
 */
export function getGeneratorOccupiedTiles(
  genX: number,
  genY: number,
  rotation: number = 0,
  tileSize: number = 64,
  cols: number = 80,
  rows: number = 60
): Array<{ col: number; row: number }> {
  const normRot = ((rotation % 360) + 360) % 360;
  const isHorizontal = normRot === 90 || normRot === 270;
  const width = isHorizontal ? GENERATOR_HITBOX_HEIGHT : GENERATOR_HITBOX_WIDTH;
  const height = isHorizontal ? GENERATOR_HITBOX_WIDTH : GENERATOR_HITBOX_HEIGHT;

  const halfW = width / 2;
  const halfH = height / 2;
  const left = genX - halfW;
  const right = genX + halfW;
  const top = genY - halfH;
  const bottom = genY + halfH;

  const minCol = Math.max(0, Math.floor((left + 1) / tileSize));
  const maxCol = Math.min(cols - 1, Math.floor((right - 1) / tileSize));
  const minRow = Math.max(0, Math.floor((top + 1) / tileSize));
  const maxRow = Math.min(rows - 1, Math.floor((bottom - 1) / tileSize));

  const tiles: Array<{ col: number; row: number }> = [];
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      tiles.push({ col: c, row: r });
    }
  }
  return tiles;
}

/**
 * Ponto de parada / aproximação segura (stand-off) para o Killer no entorno do gerador:
 * - Considera a rotação da máquina (vertical 50x112px ou horizontal 112x50px).
 * - Posicionado estritamente fora do colisor sólido da máquina (extents 25x56px ou 56x25px).
 * - Posicionado estritamente dentro da zona amarela de interação (130px), calibrado para 112px (~100-115px).
 * - Validação Estrita de Célula Livre: O ponto candidato deve estar nos limites do mapa e não pode ser parede sólida ('#' / 1).
 * - Validação de Linha de Visão Direta (Line-of-Sight / Raycast entre Centro do Gerador e Stand-off Point):
 *   Amostrado a cada 8px do centro da máquina até a coordenada candidata. Não pode atravessar nenhuma célula de parede sólida ('#' / 1).
 *   Ladrilhos pertencentes à própria máquina (ownTiles) são desconsiderados no teste de parede para não bloquear a saída do raio.
 * - Seleção: Escolhe a melhor face válida (com LoS livre e transitável) mais próxima de `fromPos`.
 * - Fallback resiliente: Caso nenhuma face tenha visão perfeita, prioriza faces transitáveis ou a mais próxima.
 */
export function getGeneratorStandOffPoint(
  gen: { x: number; y: number; rotation?: number },
  fromPos?: { x: number; y: number },
  isWalkable?: ((x: number, y: number) => boolean) | number[][],
  standOffDist: number = 112,
  navGrid?: number[][],
  tileSize: number = 64,
  cols: number = 80,
  rows: number = 60,
  minWallClearance: number = 90
): { x: number; y: number } {
  let effectiveNavGrid = navGrid;
  let effectiveIsWalkable: ((x: number, y: number) => boolean) | undefined = undefined;

  if (Array.isArray(isWalkable)) {
    effectiveNavGrid = isWalkable;
  } else if (typeof isWalkable === 'function') {
    effectiveIsWalkable = isWalkable;
  }

  const gridRows = effectiveNavGrid ? effectiveNavGrid.length : rows;
  const gridCols = effectiveNavGrid && effectiveNavGrid[0] ? effectiveNavGrid[0].length : cols;
  const worldWidth = gridCols * tileSize;
  const worldHeight = gridRows * tileSize;

  // Ladrilhos cobertos pela hitbox da própria máquina no navGrid
  const ownTilesList = getGeneratorOccupiedTiles(gen.x, gen.y, gen.rotation ?? 0, tileSize, gridCols, gridRows);
  const ownTiles = new Set(ownTilesList.map((t) => `${t.col},${t.row}`));

  const candidates = [
    { x: gen.x, y: gen.y - standOffDist }, // Norte
    { x: gen.x, y: gen.y + standOffDist }, // Sul
    { x: gen.x - standOffDist, y: gen.y }, // Oeste
    { x: gen.x + standOffDist, y: gen.y }  // Leste
  ];

  const validCandidates: Array<{ x: number; y: number }> = [];

  for (const c of candidates) {
    // 1. Validação de limites do mundo
    if (c.x < 0 || c.x >= worldWidth || c.y < 0 || c.y >= worldHeight) {
      continue;
    }

    const candCol = Math.floor(c.x / tileSize);
    const candRow = Math.floor(c.y / tileSize);

    if (candCol < 0 || candCol >= gridCols || candRow < 0 || candRow >= gridRows) {
      continue;
    }

    // 2. Validação por predicado de transitabilidade
    if (effectiveIsWalkable && !effectiveIsWalkable(c.x, c.y)) {
      continue;
    }

    // 3. Validação por malha navGrid
    if (effectiveNavGrid) {
      // Célula candidata deve ser piso transitável (0) e não pode ser parte da própria carcaça
      if (effectiveNavGrid[candRow][candCol] === 1) {
        continue;
      }
      if (ownTiles.has(`${candCol},${candRow}`)) {
        continue;
      }

      // Validação de Linha de Visão Direta (Line-of-Sight Raycast)
      // Amostragem em passos curtos (a cada 8px) do centro do gerador até a coordenada candidata
      let losBlocked = false;
      const numSteps = Math.max(1, Math.ceil(standOffDist / 8));
      for (let i = 0; i <= numSteps; i++) {
        const t = i / numSteps;
        const sx = gen.x + (c.x - gen.x) * t;
        const sy = gen.y + (c.y - gen.y) * t;
        const sc = Math.floor(sx / tileSize);
        const sr = Math.floor(sy / tileSize);

        if (sr < 0 || sr >= gridRows || sc < 0 || sc >= gridCols) {
          losBlocked = true;
          break;
        }

        if (effectiveNavGrid[sr][sc] === 1) {
          // Ignora os ladrilhos pertencentes à própria máquina
          if (!ownTiles.has(`${sc},${sr}`)) {
            losBlocked = true;
            break;
          }
        }
      }

      if (losBlocked) {
        continue;
      }

      // 4. Validação de Folga Mínima de Parede (Descarte de Faces Estranguladas):
      // Se a distância entre o ponto de stand-off e a parede sólida mais próxima for menor que minWallClearance (90px),
      // descarta a face da lista prioritária para evitar que o Killer navegue em vãos estrangulados contra rodapés.
      if (minWallClearance > 0) {
        const checkRadius = Math.ceil(minWallClearance / tileSize);
        let wallTooClose = false;

        for (let dr = -checkRadius; dr <= checkRadius; dr++) {
          for (let dc = -checkRadius; dc <= checkRadius; dc++) {
            const sr = candRow + dr;
            const sc = candCol + dc;
            if (sr < 0 || sr >= gridRows || sc < 0 || sc >= gridCols) {
              continue;
            }
            if (effectiveNavGrid[sr][sc] === 1 && !ownTiles.has(`${sc},${sr}`)) {
              const nearestX = Math.max(sc * tileSize, Math.min(c.x, (sc + 1) * tileSize));
              const nearestY = Math.max(sr * tileSize, Math.min(c.y, (sr + 1) * tileSize));
              const dist = Math.hypot(c.x - nearestX, c.y - nearestY);
              if (dist < minWallClearance) {
                wallTooClose = true;
                break;
              }
            }
          }
          if (wallTooClose) break;
        }

        if (wallTooClose) {
          continue;
        }
      }
    }

    validCandidates.push(c);
  }

  const selectClosest = (points: Array<{ x: number; y: number }>, target: { x: number; y: number }) => {
    let best = points[0];
    let bestDist = Infinity;
    for (const pt of points) {
      const d = Math.hypot(pt.x - target.x, pt.y - target.y);
      if (d < bestDist) {
        bestDist = d;
        best = pt;
      }
    }
    return { x: best.x, y: best.y };
  };

  // Se há candidatos com linha de visão totalmente desobstruída, célula livre e folga de parede
  if (validCandidates.length > 0) {
    if (fromPos) {
      return selectClosest(validCandidates, fromPos);
    }
    return { x: validCandidates[0].x, y: validCandidates[0].y };
  }

  // Fallback 1: Candidatos com linha de visão desobstruída e célula livre (sem restrição estrita de folga de 90px)
  const losCandidates = candidates.filter((c) => {
    const cCol = Math.floor(c.x / tileSize);
    const cRow = Math.floor(c.y / tileSize);
    if (cCol < 0 || cCol >= gridCols || cRow < 0 || cRow >= gridRows) return false;
    if (effectiveIsWalkable && !effectiveIsWalkable(c.x, c.y)) return false;
    if (effectiveNavGrid) {
      if (effectiveNavGrid[cRow][cCol] === 1 || ownTiles.has(`${cCol},${cRow}`)) return false;
      const numSteps = Math.max(1, Math.ceil(standOffDist / 8));
      for (let i = 0; i <= numSteps; i++) {
        const t = i / numSteps;
        const sx = gen.x + (c.x - gen.x) * t;
        const sy = gen.y + (c.y - gen.y) * t;
        const sc = Math.floor(sx / tileSize);
        const sr = Math.floor(sy / tileSize);
        if (sr < 0 || sr >= gridRows || sc < 0 || sc >= gridCols) return false;
        if (effectiveNavGrid[sr][sc] === 1 && !ownTiles.has(`${sc},${sr}`)) return false;
      }
    }
    return true;
  });

  if (losCandidates.length > 0) {
    if (fromPos) {
      return selectClosest(losCandidates, fromPos);
    }
    return { x: losCandidates[0].x, y: losCandidates[0].y };
  }

  // Fallback 2: Candidatos com célula livre/transitável
  const walkableCandidates = candidates.filter((c) => {
    const cCol = Math.floor(c.x / tileSize);
    const cRow = Math.floor(c.y / tileSize);
    if (cCol < 0 || cCol >= gridCols || cRow < 0 || cRow >= gridRows) return false;
    if (effectiveIsWalkable && !effectiveIsWalkable(c.x, c.y)) return false;
    if (effectiveNavGrid && (effectiveNavGrid[cRow][cCol] === 1 || ownTiles.has(`${cCol},${cRow}`))) return false;
    return true;
  });

  if (walkableCandidates.length > 0) {
    if (fromPos) {
      return selectClosest(walkableCandidates, fromPos);
    }
    return { x: walkableCandidates[0].x, y: walkableCandidates[0].y };
  }

  // Fallback 3: Candidatos dentro do mapa
  const inBoundsCandidates = candidates.filter((c) => {
    const cCol = Math.floor(c.x / tileSize);
    const cRow = Math.floor(c.y / tileSize);
    return cCol >= 0 && cCol < gridCols && cRow >= 0 && cRow < gridRows;
  });

  if (inBoundsCandidates.length > 0) {
    if (fromPos) {
      return selectClosest(inBoundsCandidates, fromPos);
    }
    return { x: inBoundsCandidates[0].x, y: inBoundsCandidates[0].y };
  }

  // Fallback final de segurança
  if (fromPos) {
    return selectClosest(candidates, fromPos);
  }
  return { x: candidates[0].x, y: candidates[0].y };
}
