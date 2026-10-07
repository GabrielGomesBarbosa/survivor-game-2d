/**
 * @file generatorHitbox.ts
 * @description Generator physical dimensions, static AABB boundaries, and geometric distance checks.
 */

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
