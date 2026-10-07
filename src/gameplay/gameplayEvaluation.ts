/**
 * @file gameplayEvaluation.ts
 * @description Skill checks, locomotion evaluation, camera pan state, generator progress, and combat hit detection.
 */

import { metersToPixels, wrapAngle } from '../utils/mathUtils';

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

export type PlayerAnimState = 'idle' | 'walk' | 'run';

export interface PlayerMovementEvaluation {
  animState: PlayerAnimState;
  isMoving: boolean;
  actualSpeed: number;
}

/**
 * Calcula a velocidade escalar real de deslocamento no mundo a partir do delta de posição e delta time.
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
 * Avalia o estado real de locomoção e animação do jogador com base no deslocamento espacial efetivo.
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
 */
export function applyExplosionPenalty(current: number, penalty: number = 10): number {
  return Math.max(0, current - penalty);
}

/**
 * Avalia a transição de estado da IA do Assassino.
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

export interface CameraPanEvaluation {
  shouldPan: boolean;
  canPlaceGenerator: boolean;
  panReason: 'middle_drag' | 'space_drag' | 'freecam_drag' | 'none';
}

/**
 * Avalia de forma determinística a intenção do usuário entre mover a câmera (Pan)
 * ou fixar um candidato a gerador no mapa.
 */
export function evaluateCameraPanState(
  isMiddleDown: boolean,
  isSpaceDown: boolean,
  isLeftDown: boolean,
  _isFreeCam: boolean,
  isPlacerActive: boolean
): CameraPanEvaluation {
  if (isMiddleDown) {
    return { shouldPan: true, canPlaceGenerator: false, panReason: 'middle_drag' };
  }
  if (isSpaceDown && isLeftDown) {
    return { shouldPan: true, canPlaceGenerator: false, panReason: 'space_drag' };
  }
  const canPlace = isPlacerActive && isLeftDown && !isSpaceDown && !isMiddleDown;
  return { shouldPan: false, canPlaceGenerator: canPlace, panReason: 'none' };
}

/**
 * Formata o texto da métrica de geradores para exibição no Telemetry HUD.
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
 * Avalia se o Survivor está detectável pelo Killer.
 */
export function isPlayerDetectableByKiller(
  survivorActive: boolean = true,
  isPlayerActive: boolean = true,
  isPlayerVisible: boolean = true
): boolean {
  return survivorActive && isPlayerActive && isPlayerVisible;
}

/**
 * Aplica o impacto inicial do chute do Killer no gerador.
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

/**
 * Verifica se a área de corte em arco frontal do Killer atinge o Survivor.
 */
export function checkAttackHit(
  killerPos: { x: number; y: number },
  killerRotation: number,
  playerPos: { x: number; y: number },
  playerRadius: number,
  killerRadius: number,
  maxReachMeters: number = 1.9
): boolean {
  const dx = playerPos.x - killerPos.x;
  const dy = playerPos.y - killerPos.y;
  const dist = Math.hypot(dx, dy);
  const maxReachPixels = metersToPixels(maxReachMeters);

  if (dist > maxReachPixels) {
    return false;
  }

  // Contato físico direto imediato
  if (dist <= (playerRadius + killerRadius) + 12) {
    return true;
  }

  // Arco frontal de corte (~140° total, ±70° a partir do vetor frontal do Killer)
  const headingAngle = wrapAngle(killerRotation + Math.PI / 2);
  const targetAngle = Math.atan2(dy, dx);
  const angleDiff = Math.abs(wrapAngle(targetAngle - headingAngle));

  return angleDiff <= (Math.PI * 0.40);
}
