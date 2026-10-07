/**
 * @file pathSmoothing.ts
 * @description Path smoothing algorithms (string pulling, corner preservation) and steering lookahead.
 */

/**
 * Suavização de Caminho (Raycast Smoothing / String Pulling):
 * - Substitui o último nó da rota pela coordenada contínua exata de destino (targetPos).
 * - Realiza varredura gananciosa com raycasting desobstruído (LOS) entre nós não-consecutivos.
 * - Elimina nós intermediários em degrau quando há linha reta livre.
 * - Preserva nós de contorno de quinas em corredores abertos (custo 1) quando atalhos cortam quinas infladas (peso 2).
 * - Retorna a rota otimizada em retas diagonais limpas terminando com precisão milimétrica em targetPos.
 *
 * @param rawNodes Nós discretos retornados pelo A* em coordenadas de mundo { x, y }.
 * @param targetPos Ponto final contínuo exato de destino { x, y }.
 * @param hasLineOfSight Função que testa se dois pontos têm linha de visão livre com folga de parede.
 * @param weightedGrid Opcional: matriz de pesos do A* (0 = aberto, 1 = parede, 2 = adjacente a parede).
 * @param tileSize Tamanho do bloco em pixels (padrão: 64px).
 * @returns Lista suavizada de pontos de caminho terminando em targetPos.
 */
export function smoothPathNodes(
  rawNodes: Array<{ x: number; y: number }>,
  targetPos: { x: number; y: number },
  hasLineOfSight: (x1: number, y1: number, x2: number, y2: number) => boolean,
  weightedGrid?: number[][],
  tileSize: number = 64
): Array<{ x: number; y: number }> {
  if (!rawNodes || rawNodes.length === 0) {
    return [{ x: targetPos.x, y: targetPos.y }];
  }

  const candidates = rawNodes.map((n) => ({ x: n.x, y: n.y }));
  const lastIdx = candidates.length - 1;

  if (candidates.length === 1) {
    candidates[0] = { x: targetPos.x, y: targetPos.y };
  } else {
    // Se o penúltimo nó tiver linha de visão livre para o targetPos, substitui o último nó diretamente
    if (hasLineOfSight(candidates[lastIdx - 1].x, candidates[lastIdx - 1].y, targetPos.x, targetPos.y)) {
      candidates[lastIdx] = { x: targetPos.x, y: targetPos.y };
    } else if (hasLineOfSight(candidates[lastIdx].x, candidates[lastIdx].y, targetPos.x, targetPos.y)) {
      if (Math.hypot(candidates[lastIdx].x - targetPos.x, candidates[lastIdx].y - targetPos.y) < 64) {
        candidates[lastIdx] = { x: targetPos.x, y: targetPos.y };
      } else {
        candidates.push({ x: targetPos.x, y: targetPos.y });
      }
    } else {
      candidates.push({ x: targetPos.x, y: targetPos.y });
    }
  }

  if (candidates.length <= 2) {
    return candidates;
  }

  // Preservação de nós intermediários que contornam quinas em áreas abertas (peso 0)
  const cutsThroughInflatedCorner = (
    from: { x: number; y: number },
    to: { x: number; y: number },
    startIndex: number,
    endIndex: number
  ): boolean => {
    if (!weightedGrid || weightedGrid.length === 0) return false;

    let hasOpenCorridorNode = false;
    for (let k = startIndex + 1; k < endIndex; k++) {
      const c = Math.floor(candidates[k].x / tileSize);
      const r = Math.floor(candidates[k].y / tileSize);
      if (weightedGrid[r]?.[c] === 0) {
        hasOpenCorridorNode = true;
        break;
      }
    }
    if (!hasOpenCorridorNode) return false;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) return false;

    const steps = Math.ceil(dist / 16);
    const startStep = Math.floor(steps * 0.15);
    const endStep = Math.ceil(steps * 0.85);

    for (let s = startStep; s <= endStep; s++) {
      const t = s / steps;
      const px = from.x + dx * t;
      const py = from.y + dy * t;
      const c = Math.floor(px / tileSize);
      const r = Math.floor(py / tileSize);
      if (weightedGrid[r]?.[c] === 2) {
        return true;
      }
    }

    return false;
  };

  // String Pulling
  const smoothed: Array<{ x: number; y: number }> = [candidates[0]];
  let current = 0;

  while (current < candidates.length - 1) {
    let furthest = current + 1;
    for (let check = candidates.length - 1; check > current + 1; check--) {
      if (hasLineOfSight(candidates[current].x, candidates[current].y, candidates[check].x, candidates[check].y)) {
        if (!cutsThroughInflatedCorner(candidates[current], candidates[check], current, check)) {
          furthest = check;
          break;
        }
      }
    }
    smoothed.push(candidates[furthest]);
    current = furthest;
  }

  // Assegura que o último ponto seja targetPos se visível
  const finalNode = smoothed[smoothed.length - 1];
  if (finalNode.x !== targetPos.x || finalNode.y !== targetPos.y) {
    if (hasLineOfSight(finalNode.x, finalNode.y, targetPos.x, targetPos.y)) {
      if (!cutsThroughInflatedCorner(finalNode, targetPos, current, candidates.length - 1)) {
        smoothed.push({ x: targetPos.x, y: targetPos.y });
      }
    }
  }

  return smoothed;
}

/**
 * Calcula o ponto de look-ahead e direção angular para condução contínua (steering) ao longo da rota.
 * @param currentPos Posição atual da entidade { x, y }.
 * @param path Nós de waypoints da rota suavizada.
 * @param lookAheadDist Distância de antecipação visual em pixels (padrão: 60px).
 */
export function calculateLookAheadSteering(
  currentPos: { x: number; y: number },
  path: Array<{ x: number; y: number }>,
  lookAheadDist: number = 60
): { target: { x: number; y: number }; heading: number; distance: number } {
  if (!path || path.length === 0) {
    return { target: { ...currentPos }, heading: 0, distance: 0 };
  }

  let target = path[path.length - 1];
  for (let i = 0; i < path.length; i++) {
    const dist = Math.hypot(path[i].x - currentPos.x, path[i].y - currentPos.y);
    if (dist >= lookAheadDist) {
      target = path[i];
      break;
    }
  }

  const dx = target.x - currentPos.x;
  const dy = target.y - currentPos.y;
  const distance = Math.hypot(dx, dy);
  const heading = distance > 0.001 ? Math.atan2(dy, dx) : 0;

  return { target, heading, distance };
}
