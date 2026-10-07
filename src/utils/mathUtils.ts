/**
 * @file mathUtils.ts
 * @description Pure metric, angular, coordinate, and trigonometry math utilities.
 */

/**
 * Constantes e funções de conversão para o Sistema Métrico (Padrão Dead by Daylight).
 * Escala: 1 metro = 60 pixels.
 */
export const PIXELS_PER_METER = 60;
export const metersToPixels = (meters: number): number => meters * PIXELS_PER_METER;
export const pixelsToMeters = (pixels: number, decimals: number = 2): number => Number((pixels / PIXELS_PER_METER).toFixed(decimals));

/**
 * Formata as dimensões do mapa em pixels e metros.
 * @param widthPixels Largura total em pixels (padrão: 5120)
 * @param heightPixels Altura total em pixels (padrão: 3840)
 * @returns '5120x3840 px (85.3m x 64.0m)'
 */
export function formatMapDimensionsMetric(widthPixels: number = 5120, heightPixels: number = 3840): string {
  const wMeters = pixelsToMeters(widthPixels, 1).toFixed(1);
  const hMeters = pixelsToMeters(heightPixels, 1).toFixed(1);
  return `${widthPixels}x${heightPixels} px (${wMeters}m x ${hMeters}m)`;
}

/**
 * Wraps an angle in radians to [-PI, PI].
 */
export function wrapAngle(angle: number): number {
  while (angle > Math.PI) {
    angle -= 2 * Math.PI;
  }
  while (angle < -Math.PI) {
    angle += 2 * Math.PI;
  }
  return angle;
}

/**
 * Converte graus para radianos.
 */
export const degToRad = (degrees: number): number => degrees * (Math.PI / 180);

/**
 * Converte radianos para graus.
 */
export const radToDeg = (radians: number): number => radians * (180 / Math.PI);

/**
 * Retorna as coordenadas de tile inteiras baseadas nas posições de mundo em pixels.
 * @param x Coordenada X em pixels
 * @param y Coordenada Y em pixels
 * @param tileSize Tamanho do tile em pixels (padrão: 64)
 * @returns [tileX, tileY]
 */
export function calculateCurrentTile(x: number, y: number, tileSize: number = 64): [number, number] {
  const tileX = Math.floor(x / tileSize);
  const tileY = Math.floor(y / tileSize);
  return [tileX, tileY];
}

/**
 * Formata as coordenadas de tile em string amigável para HUD ou debug.
 * @param x Coordenada X em pixels
 * @param y Coordenada Y em pixels
 * @param tileSize Tamanho do tile em pixels (padrão: 64)
 * @returns Exemplo: "[12, 8]"
 */
export function formatCurrentTile(x: number, y: number, tileSize: number = 64): string {
  const [tileX, tileY] = calculateCurrentTile(x, y, tileSize);
  return `[${tileX}, ${tileY}]`;
}

/**
 * Calcula a escala compensatória de UI para anular a distorção do zoom da câmera.
 * @param zoom Fator de zoom atual da câmera
 * @param minZoom Limite inferior de zoom para evitar divisão por zero/valores extremos
 * @returns Fator de escala inverso (1 / clamp(zoom))
 */
export function calculateZoomCompensationScale(zoom: number, minZoom: number = 0.1): number {
  const clampedZoom = Math.max(zoom, minZoom);
  return 1 / clampedZoom;
}
