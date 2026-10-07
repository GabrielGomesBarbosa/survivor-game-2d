/**
 * @file SpatialAudioService.ts
 * @description Spatial distance attenuation formulas and terror radius cadence/drone calculations.
 */

import { TERROR_RADIUS_MAX } from '../../config/constants';
import { metersToPixels } from '../../utils/mathUtils';

export { TERROR_RADIUS_MAX };

/**
 * Raio auditivo máximo para o som de motor danificado / regredindo: 10 metros (600px).
 */
export const GENERATOR_AUDIO_MAX_DIST = metersToPixels(10.0);

/**
 * Raio de volume total para o som de motor danificado / regredindo: 1.5 metros (90px).
 */
export const GENERATOR_AUDIO_MIN_DIST = metersToPixels(1.5);

/**
 * Calcula o fator de volume (0.0 a 1.0) do áudio espacial de gerador regredindo com base na distância.
 * - dist >= GENERATOR_AUDIO_MAX_DIST (600px): volume = 0 (silêncio total)
 * - dist <= GENERATOR_AUDIO_MIN_DIST (90px): volume = 1.0 (volume nominal)
 * - intervalo [90px, 600px]: atenuação linear decrescente
 * @param dist Distância euclidiana em pixels até o gerador mais próximo
 */
export function calculateDamagedGeneratorAudioVolume(dist: number): number {
  if (!isFinite(dist) || dist >= GENERATOR_AUDIO_MAX_DIST) {
    return 0;
  }
  if (dist <= GENERATOR_AUDIO_MIN_DIST) {
    return 1.0;
  }
  return 1.0 - ((dist - GENERATOR_AUDIO_MIN_DIST) / (GENERATOR_AUDIO_MAX_DIST - GENERATOR_AUDIO_MIN_DIST));
}

/**
 * Calcula a cadência e intensidade do batimento cardíaco (Camada 1) a partir da distância até o Killer.
 * @param distanceToKiller Distância euclidiana em pixels entre Survivor e Killer.
 * @returns { intervalMs: number; volume: number; active: boolean }
 */
export function calculateTerrorCadence(distanceToKiller: number): {
  intervalMs: number;
  volume: number;
  active: boolean;
} {
  if (distanceToKiller >= TERROR_RADIUS_MAX) {
    return { intervalMs: 1100, volume: 0, active: false };
  }
  const minThreshold = 300; // < 5 metros (300px)
  const maxThreshold = TERROR_RADIUS_MAX; // 32 metros (1920px)
  const clamped = Math.max(minThreshold, Math.min(maxThreshold, distanceToKiller));
  const t = (clamped - minThreshold) / (maxThreshold - minThreshold); // 0 (<= 300px) a 1 (1920px)

  // 1920px (32m): ~55 BPM (intervalo de 1100ms) | <= 300px (< 5m): ~150 BPM (intervalo de 400ms)
  const intervalMs = 400 + t * (1100 - 400);
  // Volume proporcional: ganho suave de 0.08 no limiar de 1920px até 0.45 em proximidade imediata (< 5m)
  const volume = 0.45 - t * (0.45 - 0.08);

  return { intervalMs, volume, active: true };
}

/**
 * Calcula os parâmetros de corte e ganho do Drone Dissonante (Camada 2).
 * @param distanceToKiller Distância euclidiana em pixels até o Killer.
 * @param isChase Indica se o Killer está em perseguição ativa (CHASE).
 * @returns { active: boolean; cutoffHz: number; volume: number }
 */
export function calculateTerrorDrone(
  distanceToKiller: number,
  isChase: boolean = false
): {
  active: boolean;
  cutoffHz: number;
  volume: number;
} {
  if (distanceToKiller >= TERROR_RADIUS_MAX) {
    return { active: false, cutoffHz: 180, volume: 0 };
  }

  if (isChase) {
    // Durante perseguição ativa, presença agressiva estendida para todo o raio ativo
    const clampedDist = Math.max(40, Math.min(TERROR_RADIUS_MAX, distanceToKiller));
    const t = (clampedDist - 40) / (TERROR_RADIUS_MAX - 40);
    const cutoffHz = 1200 - t * 350; // 850Hz a 1200Hz
    const volume = 0.28 - t * 0.08;  // 0.20 a 0.28
    return { active: true, cutoffHz, volume };
  }

  // Abaixo de 120px (< 2m): Corte aberto a 950Hz e volume 0.26 (máxima agressividade)
  if (distanceToKiller < 120) {
    return { active: true, cutoffHz: 950, volume: 0.26 };
  }

  // Entre 600px e 120px (10m a 2m): Filtro abrindo progressivamente de 320Hz até 750Hz com ganho subindo para 0.20
  if (distanceToKiller < 600) {
    const t = (distanceToKiller - 120) / (600 - 120); // 0 (120px) a 1 (600px)
    const cutoffHz = 750 - t * (750 - 320);          // 750Hz -> 320Hz
    const volume = 0.20 - t * (0.20 - 0.12);         // 0.20 -> 0.12
    return { active: true, cutoffHz, volume };
  }

  // Entre 1920px e 600px (32m a 10m): Drone sutil com filtro fechado entre 180Hz e 320Hz e ganho proporcional (0.05 a 0.12)
  const t = (distanceToKiller - 600) / (TERROR_RADIUS_MAX - 600); // 0 (600px) a 1 (1920px)
  const cutoffHz = 320 - t * (320 - 180);                         // 320Hz -> 180Hz
  const volume = 0.12 - t * (0.12 - 0.05);                        // 0.12 -> 0.05
  return { active: true, cutoffHz, volume };
}
