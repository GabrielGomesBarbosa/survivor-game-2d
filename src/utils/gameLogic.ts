/**
 * @file gameLogic.ts
 * @description Pure decoupled game logic functions free of Phaser or DOM dependencies.
 * Designed for 100% deterministic unit testing with Vitest.
 */

import defaultSpawnCandidatesJson from '../data/generatorSpawnCandidates.json';

/**
 * Constantes e funções de conversão para o Sistema Métrico (Padrão Dead by Daylight).
 * Escala: 1 metro = 60 pixels.
 */
export const PIXELS_PER_METER = 60;
export const metersToPixels = (meters: number): number => meters * PIXELS_PER_METER;
export const pixelsToMeters = (pixels: number): number => Number((pixels / PIXELS_PER_METER).toFixed(1));

/**
 * Formata as dimensões do mapa em pixels e metros.
 * @param widthPixels Largura total em pixels (padrão: 5120)
 * @param heightPixels Altura total em pixels (padrão: 3840)
 * @returns '5120x3840 px (85.3m x 64.0m)'
 */
export function formatMapDimensionsMetric(widthPixels: number = 5120, heightPixels: number = 3840): string {
  const wMeters = pixelsToMeters(widthPixels).toFixed(1);
  const hMeters = pixelsToMeters(heightPixels).toFixed(1);
  return `${widthPixels}x${heightPixels} px (${wMeters}m x ${hMeters}m)`;
}

export type SkillCheckRating = 'GREAT' | 'GOOD' | 'FAIL';

/**
 * Pure evaluation of DBD Skill Check timing based on circular dial angles.
 * @param angle Current needle angle in degrees.
 * @param zoneStart Starting angle of success zone in degrees.
 * @param zoneSize Total width of success zone (Good Zone).
 * @param greatSize Width of bonus section at start of zone (Great Zone).
 * @returns 'GREAT' (+5%), 'GOOD' (+1.5%), or 'FAIL'
 */
export function evaluateSkillCheckHit(
  angle: number,
  zoneStart: number,
  zoneSize: number,
  greatSize: number
): SkillCheckRating {
  const greatEnd = zoneStart + greatSize;
  const goodEnd = zoneStart + zoneSize;

  if (angle >= zoneStart && angle <= greatEnd) {
    return 'GREAT';
  } else if (angle > greatEnd && angle <= goodEnd) {
    return 'GOOD';
  }
  return 'FAIL';
}

/**
 * Normalizes an angle into [-PI, PI] range, eliminating 2PI boundary spin locks.
 * @param angle Radian angle
 * @returns Normalized angle in radians between -PI and PI
 */
export function wrapAngle(angle: number): number {
  let wrapped = angle % (Math.PI * 2);
  if (wrapped > Math.PI) {
    wrapped -= Math.PI * 2;
  } else if (wrapped < -Math.PI) {
    wrapped += Math.PI * 2;
  }
  return wrapped;
}

export type PlayerAnimState = 'idle' | 'walk' | 'run';

export interface PlayerMovementEvaluation {
  animState: PlayerAnimState;
  isMoving: boolean;
  actualSpeed: number;
}

/**
 * Calcula a velocidade escalar real de deslocamento no mundo a partir do delta de posição e delta time.
 * @param deltaX Deslocamento horizontal no frame.
 * @param deltaY Deslocamento vertical no frame.
 * @param deltaMs Tempo delta do frame em milissegundos.
 * @returns Velocidade escalar em pixels por segundo.
 */
export function calculateEffectiveSpeed(
  deltaX: number,
  deltaY: number,
  deltaMs: number
): number {
  if (deltaMs <= 0) return 0;
  const dist = Math.hypot(deltaX, deltaY);
  return (dist / deltaMs) * 1000;
}

/**
 * Avalia o estado real de locomoção e animação do jogador com base no deslocamento espacial efetivo:
 * - Se não há intenção de movimento ou o deslocamento real for nulo/estagnado (< threshold),
 *   retorna 'idle', isMoving = false e actualSpeed = 0.
 * - Caso esteja colidindo contra paredes em todos os eixos solicitados, bloqueia para 'idle'.
 * - Se estiver deslizando (strafe livre em um dos eixos) ou caminhando livremente,
 *   retorna 'walk' (ou 'run' se sprint ativo), isMoving = true e actualSpeed = effectiveSpeed.
 *
 * @param isInputMoving Teclas de movimento ativas.
 * @param isSprinting Tecla de corrida ativa.
 * @param effectiveSpeed Velocidade real de deslocamento em px/s.
 * @param threshold Limiar mínimo de velocidade para ativação de passos (padrão: 5 px/s).
 * @param blocked Flags de bloqueio físico da colisão Arcade (left, right, up, down).
 * @param inputDir Vetor direcional desejado pelo input { x, y }.
 */
export function evaluatePlayerMovementState(
  isInputMoving: boolean,
  isSprinting: boolean,
  effectiveSpeed: number,
  threshold: number = 5,
  blocked?: { left?: boolean; right?: boolean; up?: boolean; down?: boolean },
  inputDir?: { x: number; y: number }
): PlayerMovementEvaluation {
  if (!isInputMoving) {
    return {
      animState: 'idle',
      isMoving: false,
      actualSpeed: 0
    };
  }

  // Avalia se o input é estritamente frontal contra superfícies bloqueadas
  let isFullyBlockedFrontally = false;
  if (blocked && inputDir) {
    const pushesIntoWallX = (inputDir.x > 0 && Boolean(blocked.right)) || (inputDir.x < 0 && Boolean(blocked.left));
    const pushesIntoWallY = (inputDir.y > 0 && Boolean(blocked.down)) || (inputDir.y < 0 && Boolean(blocked.up));
    const hasBlockedInput = (inputDir.x !== 0 && pushesIntoWallX) || (inputDir.y !== 0 && pushesIntoWallY);
    const hasUnblockedInput = (inputDir.x !== 0 && !pushesIntoWallX) || (inputDir.y !== 0 && !pushesIntoWallY);

    isFullyBlockedFrontally = hasBlockedInput && !hasUnblockedInput;
  }

  // A animação só deve entrar em 'idle' quando a velocidade efetiva for nula/baixa E a intenção for frontal contra a colisão
  if (effectiveSpeed < threshold && isFullyBlockedFrontally) {
    return {
      animState: 'idle',
      isMoving: false,
      actualSpeed: 0
    };
  }

  return {
    animState: isSprinting ? 'run' : 'walk',
    isMoving: true,
    actualSpeed: effectiveSpeed
  };
}

/**
 * Pure calculation of generator progress addition.
 * @param current Current progress percentage (0 - 100).
 * @param addAmount Amount of percentage to add.
 * @returns Clamped progress and whether the generator just completed.
 */
export function addGeneratorProgress(
  current: number,
  addAmount: number
): { progress: number; isCompleted: boolean } {
  if (current >= 100) {
    return { progress: 100, isCompleted: true };
  }
  const next = Math.min(100, current + addAmount);
  return {
    progress: next,
    isCompleted: next >= 100
  };
}

/**
 * Computes generator explosion progress penalty.
 * @param current Current progress (0 - 100).
 * @param penalty Percentage to deduct (default 10%).
 * @returns Resulting clamped progress percentage (>= 0).
 */
export function applyExplosionPenalty(current: number, penalty: number = 10): number {
  return Math.max(0, current - penalty);
}

export const GENERATOR_HITBOX_WIDTH = 50;
export const GENERATOR_HITBOX_HEIGHT = 112;
export const GENERATOR_HITBOX_OFFSET_Y = -4;
export const GENERATOR_INTERACTION_RADIUS = 130;

/**
 * Retorna os limites (AABB) do colisor estático sólido do gerador.
 * @param genX Coordenada X central do gerador.
 * @param genY Coordenada Y central do gerador.
 * @param width Largura do colisor (padrão 50px).
 * @param height Altura do colisor (padrão 112px).
 * @param offsetY Offset vertical do centro físico (padrão -4px).
 */
export function getGeneratorHitboxBounds(
  genX: number,
  genY: number,
  width: number = GENERATOR_HITBOX_WIDTH,
  height: number = GENERATOR_HITBOX_HEIGHT,
  offsetY: number = GENERATOR_HITBOX_OFFSET_Y
): {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
} {
  const centerX = genX;
  const centerY = genY + offsetY;
  const halfW = width / 2;
  const halfH = height / 2;
  return {
    left: centerX - halfW,
    right: centerX + halfW,
    top: centerY - halfH,
    bottom: centerY + halfH,
    centerX,
    centerY,
    width,
    height
  };
}

/**
 * Verifica se uma posição (ex: centro do jogador) está dentro do raio de interação do gerador.
 * @param playerPos Posição { x, y } do jogador.
 * @param genPos Posição { x, y } do gerador.
 * @param radius Raio de alcance da interação em pixels (padrão: 130px).
 */
export function isWithinGeneratorInteractionRange(
  playerPos: { x: number; y: number },
  genPos: { x: number; y: number },
  radius: number = GENERATOR_INTERACTION_RADIUS
): boolean {
  const dist = Math.hypot(playerPos.x - genPos.x, playerPos.y - genPos.y);
  return dist <= radius;
}

/**
 * Calcula a posição do jogador ao encostar no colisor estático do gerador a partir de um lado cardeal.
 * Útil para testes unitários de colisão e alcance de interação.
 * @param genX Coordenada X central do gerador.
 * @param genY Coordenada Y central do gerador.
 * @param side Lado de aproximação ('north' | 'south' | 'east' | 'west').
 * @param playerRadius Raio do colisor do jogador (padrão 66.25px).
 */
export function getGeneratorContactPosition(
  genX: number,
  genY: number,
  side: 'north' | 'south' | 'east' | 'west',
  playerRadius: number = 66.25
): { x: number; y: number } {
  const bounds = getGeneratorHitboxBounds(genX, genY);
  switch (side) {
    case 'north':
      return { x: bounds.centerX, y: bounds.top - playerRadius };
    case 'south':
      return { x: bounds.centerX, y: bounds.bottom + playerRadius };
    case 'east':
      return { x: bounds.right + playerRadius, y: bounds.centerY };
    case 'west':
      return { x: bounds.left - playerRadius, y: bounds.centerY };
  }
}

/**
 * Calcula a distância de superfície (borda a borda) entre duas entidades circulares (Player e Killer).
 * Retorna 0 quando as entidades estão em contato físico ou sobrepostas.
 * @param centerDist Distância euclidiana centro a centro em pixels.
 * @param playerRadius Raio da hitbox física do Player em pixels.
 * @param killerRadius Raio da hitbox física do Killer em pixels.
 * @returns Distância efetiva de separação borda a borda em pixels (>= 0).
 */
export function calculateEdgeToEdgeDistance(
  centerDist: number,
  playerRadius: number,
  killerRadius: number
): number {
  return Math.max(0, centerDist - (playerRadius + killerRadius));
}

/**
 * Avalia a transição de estado da IA do Assassino considerando o controle de ativação e a quantidade de geradores.
 * - Se a IA estiver desativada (!killerAiEnabled) -> 'DESATIVADO'.
 * - Se não houver geradores ativos no mapa (activeGeneratorsCount === 0) -> 'STANDBY'.
 * - Se a IA for reativada ou geradores forem adicionados e estava em 'DESATIVADO' ou 'STANDBY' -> 'PATROL'.
 * @param currentState Estado atual ('PATROL' | 'INSPECTING' | 'CHASE' | 'DESATIVADO' | 'STANDBY').
 * @param killerAiEnabled Flag do controle de debug/configuração da IA.
 * @param activeGeneratorsCount Quantidade opcional de geradores ativos na cena.
 * @returns Estado resultante da máquina FSM.
 */
export function evaluateKillerAiState(
  currentState: string,
  killerAiEnabled: boolean,
  activeGeneratorsCount?: number
): string {
  if (!killerAiEnabled) {
    return 'DESATIVADO';
  }
  if (activeGeneratorsCount !== undefined && activeGeneratorsCount === 0) {
    return 'STANDBY';
  }
  if (currentState === 'DESATIVADO' || currentState === 'STANDBY') {
    return 'PATROL';
  }
  return currentState;
}

/**
 * Pure anti-push velocity cancellation:
 * Eliminates approach velocity between Killer and Player along collision normal
 * without pushing the Player into solid walls.
 * @param killerVel Velocity vector { x, y } of killer.
 * @param playerVel Velocity vector { x, y } of player.
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
 * Suavização de Caminho (Raycast Smoothing / String Pulling):
 * - Substitui o último nó da rota pela coordenada contínua exata de destino (targetPos).
 * - Realiza varredura gananciosa com raycasting desobstruído (LOS) entre nós não-consecutivos.
 * - Elimina nós intermediários em degrau quando há linha reta livre.
 * - Retorna a rota otimizada em retas diagonais limpas terminando com precisão milimétrica em targetPos.
 *
 * @param rawNodes Nós discretos retornados pelo A* em coordenadas de mundo { x, y }.
 * @param targetPos Ponto final contínuo exato de destino { x, y }.
 * @param hasLineOfSight Função que testa se dois pontos têm linha de visão livre com folga de parede.
 * @returns Lista suavizada de pontos de caminho terminando em targetPos.
 */
export function smoothPathNodes(
  rawNodes: Array<{ x: number; y: number }>,
  targetPos: { x: number; y: number },
  hasLineOfSight: (x1: number, y1: number, x2: number, y2: number) => boolean
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

  // String Pulling
  const smoothed: Array<{ x: number; y: number }> = [candidates[0]];
  let current = 0;

  while (current < candidates.length - 1) {
    let furthest = current + 1;
    for (let check = candidates.length - 1; check > current + 1; check--) {
      if (hasLineOfSight(candidates[current].x, candidates[current].y, candidates[check].x, candidates[check].y)) {
        furthest = check;
        break;
      }
    }
    smoothed.push(candidates[furthest]);
    current = furthest;
  }

  // Assegura que o último ponto seja targetPos se visível
  const finalNode = smoothed[smoothed.length - 1];
  if (finalNode.x !== targetPos.x || finalNode.y !== targetPos.y) {
    if (hasLineOfSight(finalNode.x, finalNode.y, targetPos.x, targetPos.y)) {
      smoothed.push({ x: targetPos.x, y: targetPos.y });
    }
  }

  return smoothed;
}

export interface PatrolTarget {
  name: string;
  x: number;
  y: number;
  type: 'generator' | 'room';
}

/**
 * Centros das salas e cômodos principais da instalação (sem nós vazios de corredores).
 */
export const MAJOR_FACILITY_ROOMS: PatrolTarget[] = [
  { name: 'Recepção Central', x: 2560, y: 1920, type: 'room' },
  { name: 'Ala Norte (Contenção)', x: 2560, y: 736, type: 'room' },
  { name: 'Ala Nordeste (Laboratório)', x: 4096, y: 768, type: 'room' },
  { name: 'Ala Noroeste (Depósito)', x: 1024, y: 768, type: 'room' },
  { name: 'Ala Sudoeste (Enfermaria)', x: 1024, y: 3072, type: 'room' },
  { name: 'Ala Sudeste (Sala de Máquinas)', x: 4096, y: 3072, type: 'room' },
  { name: 'Ala Sul (Manutenção)', x: 2560, y: 3072, type: 'room' }
];

/**
 * Filtra e constrói a lista estrita de destinos de patrulha válidos:
 * - Valida que as coordenadas numéricas X e Y são finitas e não-nulas.
 * - Elimina entradas nulas, indefinidas ou com coordenadas inválidas/NaN.
 * - Inclui prioritariamente as posições dos geradores existentes.
 */
export function buildValidPatrolDestinations(
  incompleteGenerators: Array<{ name: string; x: number; y: number } | null | undefined>,
  majorRooms: PatrolTarget[] = MAJOR_FACILITY_ROOMS
): PatrolTarget[] {
  const validGens: PatrolTarget[] = (incompleteGenerators || [])
    .filter(
      (g): g is { name: string; x: number; y: number } =>
        Boolean(g && typeof g.x === 'number' && typeof g.y === 'number' && !isNaN(g.x) && !isNaN(g.y) && isFinite(g.x) && isFinite(g.y))
    )
    .map((g) => ({ name: g.name, x: g.x, y: g.y, type: 'generator' }));

  const validRooms = (majorRooms || []).filter(
    (r): r is PatrolTarget =>
      Boolean(r && typeof r.x === 'number' && typeof r.y === 'number' && !isNaN(r.x) && !isNaN(r.y) && isFinite(r.x) && isFinite(r.y))
  );

  return [...validGens, ...validRooms];
}

/**
 * Seleciona o próximo alvo de patrulha do Assassino:
 * - Foca prioritariamente nos geradores incompletos (75% de chance se houver geradores ativos).
 * - Caso contrário ou nos 25% restantes, inspeciona um cômodo principal.
 * - Garante que nunca retorna alvo nulo ou inválido enquanto houver destinos cadastrados.
 */
export function choosePatrolTarget(
  incompleteGenerators: Array<{ name: string; x: number; y: number } | null | undefined>,
  majorRooms: PatrolTarget[] = MAJOR_FACILITY_ROOMS,
  rng: () => number = Math.random
): PatrolTarget | null {
  const destinations = buildValidPatrolDestinations(incompleteGenerators, majorRooms);
  if (destinations.length === 0) return null;

  const validGens = destinations.filter((d) => d.type === 'generator');
  const validRooms = destinations.filter((d) => d.type === 'room');

  // Prioridade alta para geradores incompletos/ativos (75% de chance)
  if (validGens.length > 0 && rng() < 0.75) {
    const idx = Math.floor(rng() * validGens.length);
    return validGens[idx];
  }

  // Cômodos principais
  if (validRooms.length > 0) {
    const idx = Math.floor(rng() * validRooms.length);
    return validRooms[idx];
  }

  return validGens[0] || null;
}

/**
 * Gerenciador de ciclo de ronda (patrol cycle) entre geradores e inspeção de ambientes.
 */
export class GeneratorPatrolManager {
  public currentIndex = 0;
  public inspectTimer = 0;
  public isInspecting = false;
  public currentDestination: PatrolTarget | null = null;
  public totalInspectDuration = 2500; // 2.5s (entre 2s e 3s)
  public lastVisitedGenerator: string | null = null;
  public visitHistory: Map<string, number> = new Map();
  public visitCounter = 0;

  /**
   * Filtra estritamente geradores incompletos e com coordenadas válidas.
   * Exclui geradores já completados (100% ou isCompleted == true).
   */
  public filterActiveGenerators(
    generators: Array<{ name: string; x: number; y: number; progress?: number; isCompleted?: boolean } | null | undefined>
  ): PatrolTarget[] {
    return (generators || [])
      .filter((g): g is { name: string; x: number; y: number; progress?: number; isCompleted?: boolean } => {
        if (!g) return false;
        if (g.isCompleted) return false;
        if (typeof g.progress === 'number' && g.progress >= 100) return false;
        return (
          typeof g.x === 'number' &&
          typeof g.y === 'number' &&
          !isNaN(g.x) &&
          !isNaN(g.y) &&
          isFinite(g.x) &&
          isFinite(g.y)
        );
      })
      .map((g) => ({ name: g.name, x: g.x, y: g.y, type: 'generator' }));
  }

  /**
   * Filtra geradores ativos preservando o progresso para ponderação dinâmica.
   */
  public filterActiveGeneratorsWithProgress(
    generators: Array<{ name: string; x: number; y: number; progress?: number; isCompleted?: boolean } | null | undefined>
  ): Array<{ name: string; x: number; y: number; progress: number }> {
    return (generators || [])
      .filter((g): g is { name: string; x: number; y: number; progress?: number; isCompleted?: boolean } => {
        if (!g) return false;
        if (g.isCompleted) return false;
        if (typeof g.progress === 'number' && g.progress >= 100) return false;
        return (
          typeof g.x === 'number' &&
          typeof g.y === 'number' &&
          !isNaN(g.x) &&
          !isNaN(g.y) &&
          isFinite(g.x) &&
          isFinite(g.y)
        );
      })
      .map((g) => ({
        name: g.name,
        x: g.x,
        y: g.y,
        progress: typeof g.progress === 'number' ? g.progress : 0
      }));
  }

  /**
   * Obtém o próximo destino de patrulha na sequência dinâmica/não-determinística:
   * - Regra Mandatória: NUNCA repete o mesmo gerador em que acabou de inspecionar (se houver mais de 1).
   * - Prioriza geradores sob reparo (progresso > 0%) e visitados há mais tempo (staleness).
   * - Se todos os geradores foram concluídos, ronda pelas salas principais sem repetição consecutiva.
   */
  public getNextDestination(
    generators: Array<{ name: string; x: number; y: number; progress?: number; isCompleted?: boolean } | null | undefined>,
    majorRooms: PatrolTarget[] = MAJOR_FACILITY_ROOMS,
    rng: () => number = Math.random
  ): PatrolTarget | null {
    const rawGens = this.filterActiveGeneratorsWithProgress(generators);
    this.isInspecting = false;
    this.inspectTimer = 0;

    if (rawGens.length > 0) {
      // Regra Mandatória: Se houver mais de 1 gerador incompleto, NUNCA sortear o mesmo que acabou de inspecionar
      let candidates = rawGens;
      if (rawGens.length > 1 && this.lastVisitedGenerator) {
        const remaining = rawGens.filter((g) => g.name !== this.lastVisitedGenerator);
        if (remaining.length > 0) {
          candidates = remaining;
        }
      }

      // Priorização ponderada:
      // - Progresso > 0%: geradores com reparo em andamento recebem prioridade alta
      // - Staleness: geradores visitados há mais tempo (ou nunca visitados) recebem prioridade
      const weights = candidates.map((g) => {
        let w = 1.0;
        if (g.progress > 0) {
          w += 2.0 + (g.progress / 100) * 3.0; // bônus de 2.0 a 5.0
        }
        const lastTick = this.visitHistory.get(g.name) ?? 0;
        const staleness = Math.max(1, this.visitCounter - lastTick + 1);
        w += staleness * 1.5;
        return w;
      });

      const totalWeight = weights.reduce((acc, weight) => acc + weight, 0);
      let randVal = rng() * totalWeight;
      let chosen = candidates[0];

      for (let i = 0; i < candidates.length; i++) {
        randVal -= weights[i];
        if (randVal <= 0) {
          chosen = candidates[i];
          break;
        }
      }

      this.visitCounter++;
      this.lastVisitedGenerator = chosen.name;
      this.visitHistory.set(chosen.name, this.visitCounter);

      const target: PatrolTarget = {
        name: chosen.name,
        x: chosen.x,
        y: chosen.y,
        type: 'generator'
      };
      this.currentDestination = target;
      return target;
    }

    // Se todos os geradores foram concluídos, ronda pelas salas principais
    const validRooms = (majorRooms || []).filter((r) => r && typeof r.x === 'number' && typeof r.y === 'number');
    if (validRooms.length > 0) {
      let roomCandidates = validRooms;
      if (validRooms.length > 1 && this.lastVisitedGenerator) {
        const filtered = validRooms.filter((r) => r.name !== this.lastVisitedGenerator);
        if (filtered.length > 0) roomCandidates = filtered;
      }
      const idx = Math.floor(rng() * roomCandidates.length);
      const target = roomCandidates[idx];
      this.lastVisitedGenerator = target.name;
      this.currentDestination = target;
      return target;
    }

    this.currentDestination = null;
    return null;
  }

  /**
   * Verifica se o Killer alcançou a distância segura do alvo (evita empurrar a máquina sólida).
   * @param distance Distância euclidiana atual em pixels.
   * @param safeRadius Raio de segurança em pixels (padrão: 110px).
   */
  public hasReachedSafeDistance(distance: number, safeRadius: number = 110): boolean {
    return distance <= safeRadius;
  }

  /**
   * Inicia o estado de inspeção no gerador.
   * @param durationMs Duração da pausa de inspeção (padrão: 2500ms).
   */
  public startInspection(durationMs: number = 2500): void {
    this.isInspecting = true;
    this.inspectTimer = durationMs;
    this.totalInspectDuration = durationMs;
  }

  /**
   * Atualiza o cronômetro de inspeção e retorna o offset angular para olhar ao redor.
   * @param delta Delta time em milissegundos.
   * @returns isComplete: boolean indicando se a inspeção terminou, lookOffset: desvio angular em radianos.
   */
  public tickInspection(delta: number): { isComplete: boolean; lookOffset: number } {
    if (!this.isInspecting) {
      return { isComplete: false, lookOffset: 0 };
    }

    this.inspectTimer -= delta;

    // Simula olhar em volta varrendo angularmente (+/- 1.1 radianos)
    const elapsed = this.totalInspectDuration - this.inspectTimer;
    const lookOffset = Math.sin(elapsed * 0.0032) * 1.1;

    if (this.inspectTimer <= 0) {
      this.isInspecting = false;
      this.inspectTimer = 0;
      return { isComplete: true, lookOffset: 0 };
    }

    return { isComplete: false, lookOffset };
  }

  /**
   * Interrompe imediatamente a inspeção (ex: perseguição iniciada ou alerta de ruído).
   */
  public interruptInspection(): void {
    this.isInspecting = false;
    this.inspectTimer = 0;
  }

  /**
   * Registra um gerador como destino prioritário imediato decorrente de ruído/explosão,
   * atualizando currentDestination e marcando lastVisitedGenerator para evitar loops na próxima rodada.
   */
  public registerAlertDestination(gen: { name: string; x: number; y: number }): PatrolTarget {
    this.interruptInspection();
    const target: PatrolTarget = {
      name: gen.name,
      x: gen.x,
      y: gen.y,
      type: 'generator'
    };
    this.currentDestination = target;
    this.lastVisitedGenerator = gen.name;
    return target;
  }
}

/**
 * Avalia se o Killer alcançou a tolerância de chegada ao alvo de patrulha:
 * - Para geradores:
 *   - Chegada confirmada se 'distToTarget <= 32' (alcançou o ponto livre de stand-off); OU
 *   - se estiver dentro do raio de interação ('distToGen <= 130') e adjacente ao stand-off ('distToTarget <= 75').
 * - Para salas principais:
 *   - 'distToTarget <= 40' (centro do cômodo).
 */
export function evaluatePatrolArrival(
  distToTarget: number,
  isTargetingGenerator: boolean,
  distToGen?: number
): boolean {
  if (isTargetingGenerator) {
    return distToTarget <= 32 || ((distToGen !== undefined && distToGen <= 130) && distToTarget <= 75);
  }
  return distToTarget <= 40;
}

/**
 * Calcula o índice de ladrilho [col, row] correspondente a uma coordenada contínua (x, y).
 * @param x Coordenada horizontal em pixels.
 * @param y Coordenada vertical em pixels.
 * @param tileSize Tamanho do bloco em pixels (padrão: 64).
 * @returns Tupla [col, row].
 */
export function calculateCurrentTile(x: number, y: number, tileSize: number = 64): [number, number] {
  return [Math.floor(x / tileSize), Math.floor(y / tileSize)];
}

/**
 * Formata a leitura do ladrilho atual para exibição na telemetria: "[col, row]".
 * @param x Coordenada horizontal em pixels.
 * @param y Coordenada vertical em pixels.
 * @param tileSize Tamanho do bloco em pixels (padrão: 64).
 * @returns String formatada "[col, row]".
 */
export function formatCurrentTile(x: number, y: number, tileSize: number = 64): string {
  const [col, row] = calculateCurrentTile(x, y, tileSize);
  return `[${col}, ${row}]`;
}

/**
 * Calcula o fator multiplicador de escala inverso para compensação de zoom da câmera,
 * garantindo legibilidade nítida da UI e prompts flutuantes em qualquer nível de aproximação/afastamento.
 * @param zoom Nível atual de zoom da câmera (ex: 0.4 a 1.5).
 * @param minZoom Limite mínimo de segurança para evitar divisão por zero (padrão: 0.1).
 * @returns Fator de escala compensado (1 / zoom).
 */
export function calculateZoomCompensationScale(zoom: number, minZoom: number = 0.1): number {
  return 1 / Math.max(minZoom, zoom);
}

/**
 * Ponto candidato a spawn de gerador selecionado pelo editor.
 */
export interface GeneratorSpawnCandidate {
  id: number;
  x: number;
  y: number;
  rotation: number;
  maxSurvivors: number;
  name?: string;
  roomName?: string;
}

/**
 * Resultado da validação física e de slots de um gerador candidato.
 */
export interface GeneratorPlacementValidation {
  isValid: boolean;
  isCollidingWithWall: boolean;
  isOutOfBounds: boolean;
  maxSurvivors: number;
  accessibleSides: {
    north: boolean;
    south: boolean;
    east: boolean;
    west: boolean;
  };
  hitboxBounds: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
  };
}

/**
 * Valida o posicionamento de um gerador (50x112px ou 112x50px) na grade de navegação.
 * Verifica colisão direta da hitbox com paredes sólidas ('#') e calcula os lados acessíveis (1 a 4 slots estilo DBD).
 *
 * @param genX Coordenada central X em pixels.
 * @param genY Coordenada central Y em pixels.
 * @param rotation Rotação em graus (0, 90, 180 ou 270).
 * @param navGrid Matriz de navegação onde 1 = parede e 0 = livre.
 * @param tileSize Tamanho do bloco em pixels (padrão: 64).
 * @param worldWidth Largura do mundo (padrão: 5120).
 * @param worldHeight Altura do mundo (padrão: 3840).
 * @param repairOffset Distância de verificação do ponto de reparo do survivor (padrão: 48px).
 */
export function validateGeneratorPlacement(
  genX: number,
  genY: number,
  rotation: number,
  navGrid: number[][],
  tileSize: number = 64,
  worldWidth: number = 5120,
  worldHeight: number = 3840,
  repairOffset: number = 48
): GeneratorPlacementValidation {
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

  const hitboxBounds = { left, right, top, bottom, width, height };

  const cols = navGrid[0]?.length || Math.floor(worldWidth / tileSize);
  const rows = navGrid.length || Math.floor(worldHeight / tileSize);

  // 1. Verificação de limites do mundo
  if (left < 0 || right > worldWidth || top < 0 || bottom > worldHeight) {
    return {
      isValid: false,
      isCollidingWithWall: false,
      isOutOfBounds: true,
      maxSurvivors: 0,
      accessibleSides: { north: false, south: false, east: false, west: false },
      hitboxBounds
    };
  }

  // 2. Verificação de colisão da hitbox sólida com paredes ('#')
  const minC = Math.max(0, Math.floor(left / tileSize));
  const maxC = Math.min(cols - 1, Math.floor((right - 0.01) / tileSize));
  const minR = Math.max(0, Math.floor(top / tileSize));
  const maxR = Math.min(rows - 1, Math.floor((bottom - 0.01) / tileSize));

  let isCollidingWithWall = false;
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      if (navGrid[r]?.[c] === 1) {
        isCollidingWithWall = true;
        break;
      }
    }
    if (isCollidingWithWall) break;
  }

  // 3. Verificação de slots acessíveis (cardeais) estilo DBD
  const checkWalkable = (px: number, py: number): boolean => {
    const c = Math.floor(px / tileSize);
    const r = Math.floor(py / tileSize);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return false;
    return navGrid[r]?.[c] === 0;
  };

  const accessibleSides = {
    north: checkWalkable(genX, top - repairOffset),
    south: checkWalkable(genX, bottom + repairOffset),
    east: checkWalkable(right + repairOffset, genY),
    west: checkWalkable(left - repairOffset, genY)
  };

  const openCount =
    (accessibleSides.north ? 1 : 0) +
    (accessibleSides.south ? 1 : 0) +
    (accessibleSides.east ? 1 : 0) +
    (accessibleSides.west ? 1 : 0);

  const isValid = !isCollidingWithWall && openCount >= 1;

  return {
    isValid,
    isCollidingWithWall,
    isOutOfBounds: false,
    maxSurvivors: isValid ? openCount : 0,
    accessibleSides,
    hitboxBounds
  };
}

/**
 * Adiciona um ponto candidato à lista, gerando id sequencial se necessário.
 */
export function addSpawnCandidate(
  candidates: GeneratorSpawnCandidate[],
  candidate: Omit<GeneratorSpawnCandidate, 'id'> & { id?: number }
): GeneratorSpawnCandidate[] {
  const nextId = candidate.id ?? (candidates.reduce((max, c) => Math.max(max, c.id), 0) + 1);
  const newCandidate: GeneratorSpawnCandidate = {
    id: nextId,
    x: Math.round(candidate.x),
    y: Math.round(candidate.y),
    rotation: ((candidate.rotation % 360) + 360) % 360,
    maxSurvivors: candidate.maxSurvivors
  };
  return [...candidates, newCandidate];
}

/**
 * Remove um candidato por id.
 */
export function removeSpawnCandidate(
  candidates: GeneratorSpawnCandidate[],
  id: number
): GeneratorSpawnCandidate[] {
  return candidates.filter((c) => c.id !== id);
}

/**
 * Localiza candidato sob uma coordenada dada dentro de um raio de detecção (padrão: 50px).
 */
export function findCandidateAtPosition(
  candidates: GeneratorSpawnCandidate[],
  x: number,
  y: number,
  hitRadius: number = 50
): GeneratorSpawnCandidate | null {
  for (let i = candidates.length - 1; i >= 0; i--) {
    const c = candidates[i];
    if (Math.hypot(c.x - x, c.y - y) <= hitRadius) {
      return c;
    }
  }
  return null;
}

/**
 * Exporta a lista de candidatos para JSON formatado.
 */
export function exportCandidatesToJson(candidates: GeneratorSpawnCandidate[]): string {
  return JSON.stringify(candidates, null, 2);
}

export const GENERATOR_CANDIDATES_STORAGE_KEY = 'horror2d_generator_candidates';

/**
 * Faz parse e validação defensiva da lista de candidatos a partir de uma string JSON.
 * Retorna array vazio se a string for nula, vazia ou inválida.
 */
export function parseCandidatesJson(rawJson: string | null | undefined): GeneratorSpawnCandidate[] {
  if (!rawJson) return [];
  try {
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is GeneratorSpawnCandidate =>
        Boolean(
          c &&
          typeof c.id === 'number' &&
          typeof c.x === 'number' &&
          typeof c.y === 'number' &&
          typeof c.rotation === 'number' &&
          typeof c.maxSurvivors === 'number' &&
          isFinite(c.x) &&
          isFinite(c.y)
        )
    );
  } catch {
    return [];
  }
}

/**
 * Carrega a lista de candidatos a partir do localStorage (ou storage injetado).
 */
export function loadCandidatesFromStorage(
  storageKey: string = GENERATOR_CANDIDATES_STORAGE_KEY,
  storage?: { getItem: (key: string) => string | null }
): GeneratorSpawnCandidate[] {
  try {
    const s = storage ?? (typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined);
    if (!s) return [];
    const raw = s.getItem(storageKey);
    return parseCandidatesJson(raw);
  } catch {
    return [];
  }
}

/**
 * Salva a lista de candidatos no localStorage (ou storage injetado).
 */
export function saveCandidatesToStorage(
  candidates: GeneratorSpawnCandidate[],
  storageKey: string = GENERATOR_CANDIDATES_STORAGE_KEY,
  storage?: { setItem: (key: string, value: string) => void }
): void {
  try {
    const s = storage ?? (typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined);
    if (!s) return;
    s.setItem(storageKey, JSON.stringify(candidates));
  } catch (e) {
    console.warn('Erro ao salvar candidatos no localStorage:', e);
  }
}

/**
 * Remove os candidatos salvos no localStorage (ou storage injetado).
 */
export function clearCandidatesFromStorage(
  storageKey: string = GENERATOR_CANDIDATES_STORAGE_KEY,
  storage?: { removeItem: (key: string) => void }
): void {
  try {
    const s = storage ?? (typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined);
    if (!s) return;
    s.removeItem(storageKey);
  } catch (e) {
    console.warn('Erro ao remover candidatos do localStorage:', e);
  }
}

export const ACTIVE_GENERATORS_STORAGE_KEY = 'horror2d_active_generators';

/**
 * Estrutura serializada para persistência de geradores ativos na sessão (resistência ao F5).
 */
export interface ActiveGeneratorData {
  id: string | number;
  name: string;
  roomName: string;
  x: number;
  y: number;
  rotation: number;
  maxSurvivors?: number;
  progress?: number;
  isCompleted?: boolean;
  isRegressing?: boolean;
}

/**
 * Faz parse defensivo do JSON de geradores ativos recuperados do localStorage.
 */
export function parseActiveGeneratorsJson(rawJson: string | null | undefined): ActiveGeneratorData[] {
  if (!rawJson) return [];
  try {
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (g): g is ActiveGeneratorData =>
        Boolean(
          g &&
          (typeof g.id === 'string' || typeof g.id === 'number') &&
          typeof g.x === 'number' &&
          typeof g.y === 'number' &&
          isFinite(g.x) &&
          isFinite(g.y)
        )
    ).map((g) => ({
      id: g.id,
      name: g.name || `Gerador ${g.id}`,
      roomName: g.roomName || 'Complexo Industrial',
      x: g.x,
      y: g.y,
      rotation: typeof g.rotation === 'number' ? g.rotation : 0,
      maxSurvivors: typeof g.maxSurvivors === 'number' ? g.maxSurvivors : 4,
      progress: typeof g.progress === 'number' ? g.progress : 0,
      isCompleted: Boolean(g.isCompleted || (typeof g.progress === 'number' && g.progress >= 100)),
      ...(g.isRegressing ? { isRegressing: true } : {})
    }));
  } catch {
    return [];
  }
}

/**
 * Carrega a lista de geradores ativos atualmente configurados no localStorage.
 */
export function loadActiveGeneratorsFromStorage(
  storageKey: string = ACTIVE_GENERATORS_STORAGE_KEY,
  storage?: { getItem: (key: string) => string | null }
): ActiveGeneratorData[] {
  try {
    const s = storage ?? (typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined);
    if (!s) return [];
    const raw = s.getItem(storageKey);
    return parseActiveGeneratorsJson(raw);
  } catch {
    return [];
  }
}

/**
 * Salva a lista de geradores ativos atualmente na cena no localStorage.
 */
export function saveActiveGeneratorsToStorage(
  generators: ActiveGeneratorData[],
  storageKey: string = ACTIVE_GENERATORS_STORAGE_KEY,
  storage?: { setItem: (key: string, value: string) => void }
): void {
  try {
    const s = storage ?? (typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined);
    if (!s) return;
    s.setItem(storageKey, JSON.stringify(generators));
  } catch (e) {
    console.warn('Erro ao salvar geradores ativos no localStorage:', e);
  }
}

/**
 * Remove a chave de geradores ativos do localStorage.
 */
export function clearActiveGeneratorsFromStorage(
  storageKey: string = ACTIVE_GENERATORS_STORAGE_KEY,
  storage?: { removeItem: (key: string) => void }
): void {
  try {
    const s = storage ?? (typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined);
    if (!s) return;
    s.removeItem(storageKey);
  } catch (e) {
    console.warn('Erro ao limpar geradores ativos do localStorage:', e);
  }
}


/**
 * Resultado da avaliação de prioridade de pan de câmera e posicionamento de geradores.
 */
export interface CameraPanEvaluation {
  shouldPan: boolean;
  canPlaceGenerator: boolean;
  panReason: 'middle_drag' | 'space_drag' | 'freecam_drag' | 'none';
}

/**
 * Avalia de forma determinística a intenção do usuário entre mover a câmera (Pan)
 * ou fixar um candidato a gerador no mapa:
 * 1. Clique do meio (Middle Button / Scroll Click) SEMPRE faz pan de câmera universal.
 * 2. Espaço + Botão Esquerdo (Touchpad shortcut) SEMPRE faz pan de câmera em vez de fixar gerador.
 * 3. Clique esquerdo simples (sem Espaço e sem Botão do Meio) é 100% desvinculado do arrasto
 *    de tela, permanecendo exclusivo para fixar geradores no chão quando o placer estiver ativo.
 */
export function evaluateCameraPanState(
  isMiddleDown: boolean,
  isSpaceDown: boolean,
  isLeftDown: boolean,
  _isFreeCam: boolean,
  isPlacerActive: boolean
): CameraPanEvaluation {
  // 1. Botão do Meio (Scroll Click) tem prioridade absoluta universal
  if (isMiddleDown) {
    return { shouldPan: true, canPlaceGenerator: false, panReason: 'middle_drag' };
  }

  // 2. Atalho para touchpads: Espaço pressionado + clique/arraste esquerdo
  if (isSpaceDown && isLeftDown) {
    return { shouldPan: true, canPlaceGenerator: false, panReason: 'space_drag' };
  }

  // 3. Clique esquerdo simples desvinculado de arrasto de tela: exclusivo para fixar marcador do gerador
  const canPlace = isPlacerActive && isLeftDown && !isSpaceDown && !isMiddleDown;
  return { shouldPan: false, canPlaceGenerator: canPlace, panReason: 'none' };
}

/**
 * Conjunto padrão pré-calibrado de 12 candidatos a geradores espalhados pelo mapa 80x60.
 */
export const DEFAULT_SPAWN_CANDIDATES: GeneratorSpawnCandidate[] = (defaultSpawnCandidatesJson as unknown) as GeneratorSpawnCandidate[];

/**
 * Retorna o conjunto de candidatos disponíveis:
 * Retorna os dados persistidos no localStorage se existirem e não estiverem vazios;
 * caso contrário, retorna os candidatos padrão calibrados (DEFAULT_SPAWN_CANDIDATES).
 */
export function getMappedCandidatePool(
  storageKey: string = GENERATOR_CANDIDATES_STORAGE_KEY,
  storage?: { getItem: (key: string) => string | null }
): GeneratorSpawnCandidate[] {
  const stored = loadCandidatesFromStorage(storageKey, storage);
  if (stored && stored.length > 0) {
    return stored;
  }
  return [...DEFAULT_SPAWN_CANDIDATES];
}

/**
 * Sorteia aleatoriamente até N candidatos do conjunto fornecido (embaralhamento Fisher-Yates).
 * @param candidates Lista de candidatos.
 * @param count Quantidade máxima de candidatos a sortear (padrão: 8).
 * @param rng Função geradora de números aleatórios (padrão: Math.random).
 */
export function selectRandomCandidates(
  candidates: GeneratorSpawnCandidate[],
  count: number = 8,
  rng: () => number = Math.random
): GeneratorSpawnCandidate[] {
  if (!candidates || candidates.length === 0) return [];
  const pool = [...candidates];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = pool[i];
    pool[i] = pool[j];
    pool[j] = temp;
  }
  return pool.slice(0, Math.min(count, pool.length));
}

/**
 * Converte um candidato a spawn em uma definição de gerador funcional (GeneratorDef).
 */
export function candidateToGeneratorDef(
  candidate: GeneratorSpawnCandidate | ActiveGeneratorData,
  index?: number
): { id: string; name: string; roomName: string; x: number; y: number; rotation: number } {
  const numId = typeof candidate.id === 'number'
    ? candidate.id
    : parseInt(String(candidate.id).replace(/\D/g, ''), 10) || 1;
  const genLetter = String.fromCharCode(65 + ((index !== undefined ? index : numId - 1) % 26));
  const fallbackName = `Gerador ${genLetter}`;
  const isNumbered = Boolean(candidate.name && /^Gerador \d+$/i.test(candidate.name));
  const name = candidate.name && !isNumbered ? candidate.name : fallbackName;
  const strId = String(candidate.id).startsWith('gen-') ? String(candidate.id) : `gen-${candidate.id}`;
  return {
    id: strId,
    name,
    roomName: candidate.roomName || 'Complexo Industrial',
    x: candidate.x,
    y: candidate.y,
    rotation: candidate.rotation ?? 0
  };
}

/**
 * Formata o texto da métrica de geradores para exibição no Telemetry HUD:
 * Padrão: "GERADORES: [concluídos]/[meta] ([total] no mapa)" (estilo DBD).
 */
export function formatGeneratorsHudText(
  completedGens: number,
  totalGens: number,
  requiredGens?: number
): string {
  if (totalGens === 0) {
    return requiredGens !== undefined ? `0/${requiredGens} (0 no mapa)` : `0/0 (0 no mapa)`;
  }
  if (requiredGens !== undefined) {
    return `${completedGens}/${requiredGens} (${totalGens} no mapa)`;
  }
  return `${completedGens}/${totalGens}`;
}

/**
 * Avalia se o Survivor está detectável pelo Killer:
 * Em Modo Espectador (survivorActive = false) ou inativo/invisível,
 * o Killer não detecta nem persegue o jogador.
 */
export function isPlayerDetectableByKiller(
  survivorActive: boolean = true,
  isPlayerActive: boolean = true,
  isPlayerVisible: boolean = true
): boolean {
  return survivorActive && isPlayerActive && isPlayerVisible;
}

/**
 * Aplica o impacto inicial do chute do Killer no gerador (-5% de dano imediato e ativa regressão contínua).
 * @param currentProgress Progresso atual de 0 a 100.
 * @param kickPenalty Penalidade percentual imediata (padrão: 5%).
 */
export function applyGeneratorKick(
  currentProgress: number,
  kickPenalty: number = 5
): { progress: number; isRegressing: boolean } {
  if (currentProgress <= 0) {
    return { progress: 0, isRegressing: false };
  }
  const newProgress = Math.max(0, currentProgress - kickPenalty);
  return {
    progress: newProgress,
    isRegressing: newProgress > 0
  };
}

/**
 * Aplica a perda de progresso da regressão contínua com base no tempo decorrido.
 * @param currentProgress Progresso atual de 0 a 100.
 * @param deltaMs Tempo decorrido em milissegundos.
 * @param regressRate Taxa de perda em % por segundo (padrão: 0.25%/s, ou 1% a cada 4s).
 */
export function applyGeneratorRegression(
  currentProgress: number,
  deltaMs: number,
  regressRate: number = 0.25
): { progress: number; isRegressing: boolean } {
  if (currentProgress <= 0) {
    return { progress: 0, isRegressing: false };
  }
  const loss = regressRate * (deltaMs / 1000);
  const newProgress = Math.max(0, currentProgress - loss);
  return {
    progress: newProgress,
    isRegressing: newProgress > 0
  };
}

/**
 * Avalia se o Killer deve chutar o gerador especificado durante a patrulha.
 * O gerador só deve ser chutado se possuir progresso > 0%, não estiver 100% concluído e não estiver regredindo.
 */
export function shouldKillerKickGenerator(generator: {
  progress: number;
  isCompleted?: boolean;
  isRegressing?: boolean;
} | null | undefined): boolean {
  if (!generator) return false;
  if (generator.isCompleted) return false;
  if (generator.progress <= 0) return false;
  if (generator.isRegressing) return false;
  return true;
}








