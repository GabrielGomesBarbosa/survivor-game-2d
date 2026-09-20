/**
 * @file gameLogic.ts
 * @description Pure decoupled game logic functions free of Phaser or DOM dependencies.
 * Designed for 100% deterministic unit testing with Vitest.
 */

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

  // Se o movimento for frontal total contra uma parede/obstáculo bloqueado
  if (blocked && inputDir) {
    const blockedX = (inputDir.x > 0 && Boolean(blocked.right)) || (inputDir.x < 0 && Boolean(blocked.left));
    const blockedY = (inputDir.y > 0 && Boolean(blocked.down)) || (inputDir.y < 0 && Boolean(blocked.up));
    const hasFreeX = inputDir.x !== 0 && !blockedX;
    const hasFreeY = inputDir.y !== 0 && !blockedY;

    if (!hasFreeX && !hasFreeY) {
      return {
        animState: 'idle',
        isMoving: false,
        actualSpeed: 0
      };
    }
  }

  if (effectiveSpeed < threshold) {
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
 * @param worldWidth Largura total do mapa (padrão: 2560).
 * @param worldHeight Altura total do mapa (padrão: 1920).
 */
export function clampCircleAgainstNavGrid(
  x: number,
  y: number,
  radius: number,
  navGrid: number[][],
  tileSize: number = 64,
  worldWidth: number = 2560,
  worldHeight: number = 1920
): CircleClampResult {
  let curX = x;
  let curY = y;
  let clamped = false;

  // 1. Clamping estrito contra o perímetro externo do mundo
  const minWorldX = tileSize + radius;
  const maxWorldX = worldWidth - tileSize - radius;
  const minWorldY = tileSize + radius;
  const maxWorldY = worldHeight - tileSize - radius;

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

  // 2. Iterações de resolução contra caixas AABB de cada ladrilho sólido (1)
  for (let iter = 0; iter < 2; iter++) {
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

          if (distSq < radius * radius) {
            clamped = true;
            if (distSq > 0.0001) {
              const dist = Math.sqrt(distSq);
              const push = radius - dist;
              curX += (diffX / dist) * push;
              curY += (diffY / dist) * push;
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
            }
          }
        }
      }
    }
  }

  return { x: curX, y: curY, clamped };
}

/**
 * Ponto de parada / aproximação segura (stand-off) para o Killer no entorno do gerador:
 * - Posicionado estritamente fora do colisor sólido da máquina (76x88px, extents 38x44px).
 * - Posicionado estritamente dentro da zona amarela de interação (~95px, padrão ~72px).
 * - Seleciona a melhor coordenada transitável de acordo com o lado de aproximação do Killer.
 */
export function getGeneratorStandOffPoint(
  gen: { x: number; y: number },
  fromPos?: { x: number; y: number },
  isWalkable?: (x: number, y: number) => boolean,
  standOffDist: number = 72
): { x: number; y: number } {
  const candidates = [
    { x: gen.x, y: gen.y - standOffDist }, // Norte
    { x: gen.x, y: gen.y + standOffDist }, // Sul
    { x: gen.x - standOffDist, y: gen.y }, // Oeste
    { x: gen.x + standOffDist, y: gen.y }  // Leste
  ];

  const validCandidates = isWalkable
    ? candidates.filter((c) => isWalkable(c.x, c.y))
    : candidates;

  const list = validCandidates.length > 0 ? validCandidates : candidates;

  if (fromPos) {
    let best = list[0];
    let bestDist = Infinity;
    for (const c of list) {
      const d = Math.hypot(c.x - fromPos.x, c.y - fromPos.y);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }

  return list[0];
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
  { name: 'Recepção Central', x: 1280, y: 960, type: 'room' },
  { name: 'Ala de Contenção (Norte)', x: 1280, y: 224, type: 'room' },
  { name: 'Ala Leste (Usina)', x: 2240, y: 960, type: 'room' },
  { name: 'Ala Oeste (Enfermaria)', x: 320, y: 960, type: 'room' },
  { name: 'Ala Sul (Manutenção)', x: 1280, y: 1680, type: 'room' }
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
   * Obtém o próximo destino de patrulha na sequência cíclica:
   * - Percorre a fila de geradores incompletos ciclicamente.
   * - Se todos estiverem concluídos, patrulha as salas principais.
   */
  public getNextDestination(
    generators: Array<{ name: string; x: number; y: number; progress?: number; isCompleted?: boolean } | null | undefined>,
    majorRooms: PatrolTarget[] = MAJOR_FACILITY_ROOMS
  ): PatrolTarget | null {
    const activeGens = this.filterActiveGenerators(generators);
    this.isInspecting = false;
    this.inspectTimer = 0;

    if (activeGens.length > 0) {
      this.currentIndex = this.currentIndex % activeGens.length;
      const target = activeGens[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % activeGens.length;
      this.currentDestination = target;
      return target;
    }

    // Se todos os geradores foram concluídos, ronda pelas salas principais
    const validRooms = (majorRooms || []).filter((r) => r && typeof r.x === 'number' && typeof r.y === 'number');
    if (validRooms.length > 0) {
      this.currentIndex = this.currentIndex % validRooms.length;
      const target = validRooms[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % validRooms.length;
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
}


