/**
 * @file collisionUtils.ts
 * @description Solid body collision resolution, anti-push velocity separation, and navgrid clamping.
 */

export * from './generatorHitbox';

/**
 * Resolves separation velocities between Killer and Player to prevent pushing or clipping.
 * @param killerVel Killer velocity vector.
 * @param playerVel Player velocity vector.
 * @param dx Difference x (killer.x - player.x).
 * @param dy Difference y (killer.y - player.y).
 */
export function resolveAntiPushVelocity(
  killerVel: { x: number; y: number },
  playerVel: { x: number; y: number },
  dx: number,
  dy: number
): { killerVel: { x: number; y: number }; playerVel: { x: number; y: number } } {
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= 0.001) {
    return { killerVel: { ...killerVel }, playerVel: { ...playerVel } };
  }

  // Normal points from player to killer
  const nx = dx / dist;
  const ny = dy / dist;

  const kVel = { ...killerVel };
  const pVel = { ...playerVel };

  // Approach vector from killer towards player is (-nx, -ny)
  const kSpeedTowards = kVel.x * (-nx) + kVel.y * (-ny);
  if (kSpeedTowards > 0) {
    kVel.x -= (-nx) * kSpeedTowards;
    kVel.y -= (-ny) * kSpeedTowards;
  }

  // Approach vector from player towards killer is (nx, ny)
  const pSpeedTowards = pVel.x * nx + pVel.y * ny;
  if (pSpeedTowards > 0) {
    pVel.x -= nx * pSpeedTowards;
    pVel.y -= ny * pSpeedTowards;
  }

  return { killerVel: kVel, playerVel: pVel };
}

export interface SolidCollisionResult {
  hasCollision: boolean;
  overlap: number;
  minDistance: number;
  currentDistance: number;
  killerPos: { x: number; y: number };
  playerPos: { x: number; y: number };
  killerVel: { x: number; y: number };
  playerVel: { x: number; y: number };
}

/**
 * Resolução pura de colisão física sólida não-elástica entre Killer e Player:
 * - Se a distância for menor que a soma dos raios (minDistance), detecta colisão.
 * - Imobilidade Absoluta por Forças Externas (Corpos Inamovíveis Mútuos):
 *   O contato físico com o Player NUNCA altera as coordenadas do Killer (delta = 0).
 *   O Killer age como um obstáculo 100% rígido e inamovível perante o Player.
 * - Se o Killer estiver se movendo contra o Player em repouso, o Player também não é empurrado
 *   (o Killer para na borda de contato).
 * - Nenhuma entidade é empurrada ou projetada através de paredes.
 * - Anula completamente a velocidade vetorial de aproximação ao longo da normal de colisão.
 */
export function resolveSolidBodyCollision(
  killer: { x: number; y: number; radius: number; vx?: number; vy?: number },
  player: { x: number; y: number; radius: number; vx?: number; vy?: number },
  isWalkable?: (x: number, y: number) => boolean
): SolidCollisionResult {
  const kVel = { x: killer.vx ?? 0, y: killer.vy ?? 0 };
  const pVel = { x: player.vx ?? 0, y: player.vy ?? 0 };
  const dx = killer.x - player.x;
  const dy = killer.y - player.y;
  const dist = Math.hypot(dx, dy);
  const minDistance = killer.radius + player.radius;

  if (dist >= minDistance) {
    return {
      hasCollision: false,
      overlap: 0,
      minDistance,
      currentDistance: dist,
      killerPos: { x: killer.x, y: killer.y },
      playerPos: { x: player.x, y: player.y },
      killerVel: kVel,
      playerVel: pVel
    };
  }

  const overlap = minDistance - dist;
  const nx = dist > 0.001 ? dx / dist : 0;
  const ny = dist > 0.001 ? dy / dist : -1;

  // Componentes de velocidade de aproximação ao longo da normal
  const pSpeedTowards = pVel.x * nx + pVel.y * ny;
  const kSpeedTowards = kVel.x * (-nx) + kVel.y * (-ny);

  const isPlayerApproaching = pSpeedTowards > 0.01;
  const isKillerApproaching = kSpeedTowards > 0.01;

  let killerX = killer.x;
  let killerY = killer.y;
  let playerX = player.x;
  let playerY = player.y;

  // Regra Fundamental de Imobilidade Absoluta:
  // 1. O Killer NUNCA pode ser deslocado por contato ou impulsos causados pelo Player (delta = 0).
  // 2. Se apenas o Killer estiver se movendo contra o Player em repouso, o Killer recua
  //    até a borda do Player, garantindo que o Player também não seja empurrado pelo mapa.
  // 3. Se o Player estiver se movendo (ou toques rápidos/taps 'W' com velocidade alternando com zero),
  //    o Killer é inabalável (killerPos = original) e o Player é repelido para trás ao longo de -n.
  if (isKillerApproaching && !isPlayerApproaching) {
    // Killer em aproximação ativa contra Player parado: Killer para na borda do Player
    const candidateKx = killer.x + nx * overlap;
    const candidateKy = killer.y + ny * overlap;
    if (!isWalkable || isWalkable(candidateKx, candidateKy)) {
      killerX = candidateKx;
      killerY = candidateKy;
    }
  } else {
    // Player se movendo (ou repouso mútuo/taps): Killer NUNCA se move (delta = 0).
    // O Player recua até minDistance ao longo de -n
    killerX = killer.x;
    killerY = killer.y;

    const candidatePx = player.x - nx * overlap;
    const candidatePy = player.y - ny * overlap;
    if (!isWalkable || isWalkable(candidatePx, candidatePy)) {
      playerX = candidatePx;
      playerY = candidatePy;
    }
  }

  const { killerVel: resKVel, playerVel: resPVel } = resolveAntiPushVelocity(kVel, pVel, dx, dy);

  return {
    hasCollision: true,
    overlap,
    minDistance,
    currentDistance: dist,
    killerPos: { x: killerX, y: killerY },
    playerPos: { x: playerX, y: playerY },
    killerVel: resKVel,
    playerVel: resPVel
  };
}

export interface CircleClampResult {
  x: number;
  y: number;
  clamped: boolean;
}

/**
 * Barreira impenetrável de borda (Hard Clamp contra Paredes e Obstáculos estáticos):
 * Garante que nenhuma entidade física com hitbox circular de raio `radius` tenha parte
 * do seu colisor sobreposto ou projetado para além das bordas sólidas do mapa.
 *
 * @param x Coordenada X central da entidade.
 * @param y Coordenada Y central da entidade.
 * @param radius Raio da hitbox circular.
 * @param navGrid Matriz de navegação onde 1 = parede/sólido, 0 = livre.
 * @param tileSize Tamanho do bloco em pixels (padrão: 64).
 * @param worldWidth Largura total do mapa (padrão: 5120).
 * @param worldHeight Altura total do mapa (padrão: 3840).
 */
export function clampCircleAgainstNavGrid(
  x: number,
  y: number,
  radius: number,
  navGrid: number[][],
  tileSize: number = 64,
  worldWidth: number = 5120,
  worldHeight: number = 3840
): CircleClampResult {
  let curX = x;
  let curY = y;
  let clamped = false;

  const effectiveWorldWidth = (navGrid && navGrid[0]?.length) ? navGrid[0].length * tileSize : worldWidth;
  const effectiveWorldHeight = (navGrid && navGrid.length) ? navGrid.length * tileSize : worldHeight;

  // 1. Clamping estrito contra o perímetro externo do mundo
  const minWorldX = tileSize + radius;
  const maxWorldX = effectiveWorldWidth - tileSize - radius;
  const minWorldY = tileSize + radius;
  const maxWorldY = effectiveWorldHeight - tileSize - radius;

  if (curX < minWorldX) {
    curX = minWorldX;
    clamped = true;
  } else if (curX > maxWorldX) {
    curX = maxWorldX;
    clamped = true;
  }

  if (curY < minWorldY) {
    curY = minWorldY;
    clamped = true;
  } else if (curY > maxWorldY) {
    curY = maxWorldY;
    clamped = true;
  }

  if (!navGrid || navGrid.length === 0) {
    return { x: curX, y: curY, clamped };
  }

  const rows = navGrid.length;
  const cols = navGrid[0]?.length ?? 0;

  // Margem de histerese (epsilon) para evitar que corpos apenas tangenciando a parede
  // disparem 'clamped = true' infinitamente em repouso.
  const EPSILON = 0.5;
  const effectiveRadius = radius - EPSILON;
  const effectiveRadiusSq = effectiveRadius * effectiveRadius;

  // 2. Resolução iterativa contra caixas AABB de cada ladrilho sólido (1)
  for (let iter = 0; iter < 3; iter++) {
    let maxIterPush = 0;
    const minCol = Math.max(0, Math.floor((curX - radius) / tileSize));
    const maxCol = Math.min(cols - 1, Math.floor((curX + radius) / tileSize));
    const minRow = Math.max(0, Math.floor((curY - radius) / tileSize));
    const maxRow = Math.min(rows - 1, Math.floor((curY + radius) / tileSize));

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        if (navGrid[r]?.[c] === 1) {
          const boxLeft = c * tileSize;
          const boxRight = (c + 1) * tileSize;
          const boxTop = r * tileSize;
          const boxBottom = (r + 1) * tileSize;

          const closestX = Math.max(boxLeft, Math.min(curX, boxRight));
          const closestY = Math.max(boxTop, Math.min(curY, boxBottom));

          const diffX = curX - closestX;
          const diffY = curY - closestY;
          const distSq = diffX * diffX + diffY * diffY;

          if (distSq < effectiveRadiusSq) {
            clamped = true;
            if (distSq > 0.0001) {
              const dist = Math.sqrt(distSq);
              const push = radius - dist;
              const nx = diffX / dist;
              const ny = diffY / dist;
              curX += nx * push;
              curY += ny * push;
              maxIterPush = Math.max(maxIterPush, push);
            } else {
              const dLeft = curX - boxLeft;
              const dRight = boxRight - curX;
              const dTop = curY - boxTop;
              const dBottom = boxBottom - curY;
              const minD = Math.min(dLeft, dRight, dTop, dBottom);
              if (minD === dLeft) curX = boxLeft - radius;
              else if (minD === dRight) curX = boxRight + radius;
              else if (minD === dTop) curY = boxTop - radius;
              else curY = boxBottom + radius;
              maxIterPush = Math.max(maxIterPush, radius);
            }
          }
        }
      }
    }
    if (maxIterPush < 0.05) break;
  }

  return { x: curX, y: curY, clamped };
}
