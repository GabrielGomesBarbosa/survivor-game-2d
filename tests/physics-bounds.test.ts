import { describe, it, expect } from 'vitest';
import { COLS, ROWS, TILE_SIZE } from '../src/config/constants';
import {
  wrapAngle,
  resolveAntiPushVelocity,
  resolveSolidBodyCollision,
  calculateEffectiveSpeed,
  evaluatePlayerMovementState,
  clampCircleAgainstNavGrid
} from '../src/utils/gameLogic';

describe('Physics & Navigation Bounds Logic (Pure Rules)', () => {
  it('correctly wraps angles into [-PI, PI] without discontinuity', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(-Math.PI);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(-Math.PI);
    expect(wrapAngle(2 * Math.PI)).toBeCloseTo(0);
  });

  it('cancels killer approach velocity towards player on collision without pushing player', () => {
    // Player at (100, 100), Killer at (100, 80) moving down (+Y) at 150 px/s
    const playerVel = { x: 0, y: 0 };
    const killerVel = { x: 0, y: 150 };
    const dx = 0; // killer.x - player.x = 0
    const dy = -20; // killer.y - player.y = -20 (normal points from player to killer)

    const resolved = resolveAntiPushVelocity(killerVel, playerVel, dx, dy);

    // Killer downward approach velocity towards player is cancelled to 0
    expect(resolved.killerVel.y).toBeCloseTo(0);
    expect(resolved.killerVel.x).toBe(0);

    // Player remains stationary, not pushed
    expect(resolved.playerVel.x).toBe(0);
    expect(resolved.playerVel.y).toBe(0);
  });

  it('strictly enforces solid body non-penetration: separates overlapping bodies to distance >= sum of radii', () => {
    // Player radius: 66.25, Killer radius: 84.8 -> minDistance = 151.05
    const player = { x: 100, y: 100, radius: 66.25, vx: 0, vy: 0 };
    const killer = { x: 100, y: 80, radius: 84.8, vx: 0, vy: 150 }; // distance = 20px (overlap = 131.05px)

    const res = resolveSolidBodyCollision(killer, player);

    expect(res.hasCollision).toBe(true);
    expect(res.overlap).toBeCloseTo(131.05, 1);
    expect(res.minDistance).toBeCloseTo(151.05, 1);

    // Distance between resolved positions MUST be >= minDistance
    const finalDist = Math.hypot(res.killerPos.x - res.playerPos.x, res.killerPos.y - res.playerPos.y);
    expect(finalDist).toBeGreaterThanOrEqual(res.minDistance - 0.001);
    expect(finalDist).toBeCloseTo(151.05, 1);

    // Approach velocity along normal must be cancelled to 0
    expect(res.killerVel.y).toBeCloseTo(0);
  });

  it('preserves positions and velocities when bodies do not overlap (distance >= sum of radii)', () => {
    const player = { x: 100, y: 100, radius: 66.25, vx: 10, vy: 10 };
    const killer = { x: 100, y: 300, radius: 84.8, vx: 0, vy: -50 }; // distance = 200px > 151.05px

    const res = resolveSolidBodyCollision(killer, player);

    expect(res.hasCollision).toBe(false);
    expect(res.overlap).toBe(0);
    expect(res.killerPos.x).toBe(100);
    expect(res.killerPos.y).toBe(300);
    expect(res.playerPos.x).toBe(100);
    expect(res.playerPos.y).toBe(100);
    expect(res.killerVel.y).toBe(-50);
    expect(res.playerVel.x).toBe(10);
  });

  it('guarantees collision between entities never alters the position of an entity at rest (mutual immobility)', () => {
    // Caso 1: Killer em repouso absoluto (vx = 0, vy = 0), Player colidindo com velocidade
    const killerAtRest = { x: 100, y: 100, radius: 84.8, vx: 0, vy: 0 };
    const movingPlayer = { x: 100, y: 120, radius: 66.25, vx: 0, vy: -140 };

    const res1 = resolveSolidBodyCollision(killerAtRest, movingPlayer);

    expect(res1.hasCollision).toBe(true);
    // A posição do Killer em repouso NÃO pode ser alterada
    expect(res1.killerPos.x).toBe(100);
    expect(res1.killerPos.y).toBe(100);
    // O Player recua até a distância mínima de segurança
    expect(res1.playerPos.y).toBeCloseTo(100 + res1.minDistance, 1);
    expect(res1.playerVel.y).toBe(0);

    // Caso 2: Player em repouso absoluto (vx = 0, vy = 0), Killer colidindo com velocidade
    const playerAtRest = { x: 100, y: 100, radius: 66.25, vx: 0, vy: 0 };
    const movingKiller = { x: 100, y: 80, radius: 84.8, vx: 0, vy: 150 };

    const res2 = resolveSolidBodyCollision(movingKiller, playerAtRest);

    expect(res2.hasCollision).toBe(true);
    // A posição do Player em repouso NÃO pode ser alterada
    expect(res2.playerPos.x).toBe(100);
    expect(res2.playerPos.y).toBe(100);
    // O Killer recua até a distância mínima de segurança
    expect(res2.killerPos.y).toBeCloseTo(100 - res2.minDistance, 1);
    expect(res2.killerVel.y).toBe(0);
  });

  it('guarantees strict wall non-penetration: collision resolution never displaces entity into static wall bounds', () => {
    // Killer em repouso rente a uma parede sólida superior (y <= 100 é livre, y < 100 é parede)
    const killer = { x: 100, y: 100, radius: 84.8, vx: 0, vy: 0 };
    const player = { x: 100, y: 120, radius: 66.25, vx: 0, vy: -140 };

    const isWalkable = (_x: number, y: number) => y >= 100;

    const res = resolveSolidBodyCollision(killer, player, isWalkable);

    expect(res.hasCollision).toBe(true);
    // Killer em repouso rente à parede não é empurrado para dentro da parede
    expect(res.killerPos.y).toBe(100);
    expect(res.killerPos.y).toBeGreaterThanOrEqual(100);

    // Caso inverso: Entidade que recuaria contra uma parede sólida tem seu recuo contido
    const movingKiller = { x: 100, y: 80, radius: 84.8, vx: 0, vy: 150 };
    const playerAtRest = { x: 100, y: 100, radius: 66.25, vx: 0, vy: 0 };
    // y < 80 é parede sólida
    const isWalkableTop = (_x: number, y: number) => y >= 80;

    const resWall = resolveSolidBodyCollision(movingKiller, playerAtRest, isWalkableTop);
    // Killer não ultrapassa o limite da parede estática (y >= 80)
    expect(resWall.killerPos.y).toBeGreaterThanOrEqual(80);
    // Player em repouso permanece intacto
    expect(resWall.playerPos.y).toBe(100);
  });

  it('strictly preserves killer position with delta = 0 under consecutive discrete taps (W micro-impulses) near obstacles', () => {
    // Killer em repouso posicionado junto a um obstáculo superior (y = 150, parede em y <= 64)
    const killer = { x: 500, y: 150, radius: 84.8, vx: 0, vy: 0 };
    const initialKillerX = killer.x;
    const initialKillerY = killer.y;

    // Matriz de navegação simulada 30x40 com paredes na linha 0 (y <= 64)
    const mockNavGrid: number[][] = Array.from({ length: ROWS }, (_, r) =>
      Array.from({ length: COLS }, () => (r === 0 ? 1 : 0))
    );

    // Simulação de 25 toques rápidos (taps no 'W') consecutivos:
    // Em cada toque, o Player ganha velocidade em direção ao Killer, colide,
    // e no frame seguinte o jogador solta a tecla (velocidade zera enquanto ainda há proximidade).
    for (let tap = 0; tap < 25; tap++) {
      // 1. Frame de toque ativo: Player se move para cima (vy = -140) colidindo com o Killer
      const activePlayer = { x: 500, y: 220, radius: 66.25, vx: 0, vy: -140 };
      const resActive = resolveSolidBodyCollision(killer, activePlayer);

      expect(resActive.hasCollision).toBe(true);
      // As coordenadas do Killer DEVEM permanecer rigorosamente idênticas (delta = 0)
      expect(resActive.killerPos.x).toBe(initialKillerX);
      expect(resActive.killerPos.y).toBe(initialKillerY);
      expect(Math.hypot(resActive.killerPos.x - initialKillerX, resActive.killerPos.y - initialKillerY)).toBe(0);

      // 2. Frame de tecla solta (micro-impulsos onde ambos ficam com velocidade 0 sobrepostos)
      const releasedPlayer = { x: resActive.playerPos.x, y: resActive.playerPos.y, radius: 66.25, vx: 0, vy: 0 };
      const resReleased = resolveSolidBodyCollision(killer, releasedPlayer);

      expect(resReleased.killerPos.x).toBe(initialKillerX);
      expect(resReleased.killerPos.y).toBe(initialKillerY);
      expect(Math.hypot(resReleased.killerPos.x - initialKillerX, resReleased.killerPos.y - initialKillerY)).toBe(0);

      // 3. Verificação de contenção: Killer permanece 100% contido dentro da área navegável sem violar a parede
      const clampCheck = clampCircleAgainstNavGrid(resActive.killerPos.x, resActive.killerPos.y, killer.radius, mockNavGrid);
      expect(clampCheck.clamped).toBe(false); // Já está perfeitamente fora da parede
      expect(clampCheck.y - killer.radius).toBeGreaterThanOrEqual(TILE_SIZE); // Borda superior estritamente >= 64px
    }
  });

  it('guarantees hard edge clamping against walls: circle never penetrates or overlaps static tiles', () => {
    // Matriz de navegação com linha 0 como parede sólida (y in [0, 64])
    const mockNavGrid: number[][] = Array.from({ length: ROWS }, (_, r) =>
      Array.from({ length: COLS }, () => (r === 0 ? 1 : 0))
    );

    // Entidade projetada para y = 80 com raio 50 (borda superior estaria em y = 30, dentro da parede [0, 64])
    const clamped = clampCircleAgainstNavGrid(200, 80, 50, mockNavGrid);

    expect(clamped.clamped).toBe(true);
    // Coordenada Y foi ajustada para que o topo do círculo fique exatamente na borda externa (64 + 50 = 114)
    expect(clamped.y).toBe(114);
    expect(clamped.y - 50).toBe(64); // Borda exatamente tangenciando a parede, sem sobreposição
  });

  it('allows killer to slide tangentially without sticking', () => {
    // Killer moving diagonally down-right (vx: 100, vy: 100) towards player who is straight below (dx: 0, dy: -20)
    const playerVel = { x: 0, y: 0 };
    const killerVel = { x: 100, y: 100 };
    const dx = 0;
    const dy = -20;

    const resolved = resolveAntiPushVelocity(killerVel, playerVel, dx, dy);

    // Approach velocity (vy) is cancelled to 0, but tangential velocity (vx) is preserved
    expect(resolved.killerVel.y).toBeCloseTo(0);
    expect(resolved.killerVel.x).toBeCloseTo(100);
  });

  it('maps world coordinates to correct tile indices within boundaries', () => {
    const worldX = 2560;
    const worldY = 1920;
    const col = Math.floor(worldX / TILE_SIZE);
    const row = Math.floor(worldY / TILE_SIZE);

    expect(col).toBe(40);
    expect(row).toBe(30);
    expect(col).toBeGreaterThanOrEqual(0);
    expect(col).toBeLessThan(COLS);
    expect(row).toBeGreaterThanOrEqual(0);
    expect(row).toBeLessThan(ROWS);
  });

  it('evaluates movement state to idle and 0 speed under frontal wall collision with zero displacement', () => {
    // Jogador pressionando W (moveY = -1), colidindo frontalmente com parede superior (blocked.up = true, displacement = 0)
    const isInputMoving = true;
    const isSprinting = false;
    const effectiveSpeed = 0;
    const blocked = { up: true, down: false, left: false, right: false };
    const inputDir = { x: 0, y: -1 };

    const result = evaluatePlayerMovementState(
      isInputMoving,
      isSprinting,
      effectiveSpeed,
      5,
      blocked,
      inputDir
    );

    expect(result.animState).toBe('idle');
    expect(result.isMoving).toBe(false);
    expect(result.actualSpeed).toBe(0);
  });

  it('evaluates movement state to idle even when sprinting into a wall with zero displacement', () => {
    const result = evaluatePlayerMovementState(
      true,
      true,
      0,
      5,
      { left: true, right: false, up: false, down: false },
      { x: -1, y: 0 }
    );

    expect(result.animState).toBe('idle');
    expect(result.isMoving).toBe(false);
    expect(result.actualSpeed).toBe(0);
  });

  it('preserves walking and running animation when strafing along a wall with positive displacement', () => {
    // Jogador pressionando W + D contra parede superior (W bloqueado, D livre com deslocamento horizontal)
    const blocked = { up: true, down: false, left: false, right: false };
    const inputDir = { x: 1, y: -1 };
    const effectiveSpeed = 99; // Deslocamento real na horizontal

    const walkResult = evaluatePlayerMovementState(true, false, effectiveSpeed, 5, blocked, inputDir);
    expect(walkResult.animState).toBe('walk');
    expect(walkResult.isMoving).toBe(true);
    expect(walkResult.actualSpeed).toBe(99);

    const runResult = evaluatePlayerMovementState(true, true, effectiveSpeed, 5, blocked, inputDir);
    expect(runResult.animState).toBe('run');
    expect(runResult.isMoving).toBe(true);
    expect(runResult.actualSpeed).toBe(99);
  });

  it('correctly computes effective speed from delta position and delta time', () => {
    // 2.333px em 16.666ms -> ~140 px/s
    const speed = calculateEffectiveSpeed(2.333, 0, 16.666);
    expect(speed).toBeCloseTo(140, 0);

    // Deslocamento zero -> 0 px/s
    expect(calculateEffectiveSpeed(0, 0, 16.666)).toBe(0);

    // Delta time zero ou negativo -> 0 px/s
    expect(calculateEffectiveSpeed(5, 5, 0)).toBe(0);
  });

  it('enables functional detachment and backoff from 90° corners without pinning or locking into idle', () => {
    // Grade de teste com quina interna em L:
    // Parede superior (linha 0) e parede esquerda (coluna 0)
    const mockNavGrid: number[][] = Array.from({ length: ROWS }, (_, r) =>
      Array.from({ length: COLS }, (_, c) => (r === 0 || c === 0 ? 1 : 0))
    );

    const radius = 50;
    // Posição inicial projetada profundamente para a quina (x = 40, y = 40)
    const clampedCorner = clampCircleAgainstNavGrid(40, 40, radius, mockNavGrid);
    expect(clampedCorner.clamped).toBe(true);
    // Posição ajustada para a tangente de ambas as paredes (TILE_SIZE + radius = 64 + 50 = 114)
    expect(clampedCorner.x).toBe(114);
    expect(clampedCorner.y).toBe(114);

    // No frame seguinte em repouso sobre a quina, a histerese (epsilon) NÃO deve acionar clamped
    const restingCheck = clampCircleAgainstNavGrid(clampedCorner.x, clampedCorner.y, radius, mockNavGrid);
    expect(restingCheck.clamped).toBe(false);

    // O jogador tenta recuar da quina (movendo para baixo-direita: inputDir = { x: 1, y: 1 })
    // Flags Arcade reportam bloqueio prévio na esquerda e topo
    const blockedCorner = { left: true, right: false, up: true, down: false };
    const escapeInput = { x: 1, y: 1 };
    const evalEscape = evaluatePlayerMovementState(true, false, 99, 5, blockedCorner, escapeInput);

    // O comando de recuo NÃO pode ser julgado como bloqueado/idle
    expect(evalEscape.animState).toBe('walk');
    expect(evalEscape.isMoving).toBe(true);

    // Deslocamento de 1 frame de recuo (2.33px a 140px/s)
    const newX = clampedCorner.x + 2.33;
    const newY = clampedCorner.y + 2.33;
    const movingAwayCheck = clampCircleAgainstNavGrid(newX, newY, radius, mockNavGrid);
    expect(movingAwayCheck.clamped).toBe(false);
    expect(movingAwayCheck.x).toBe(newX);
    expect(movingAwayCheck.y).toBe(newY);
  });

  it('maintains absolute positional stability without flicker/oscillation during sustained Player vs Killer contact', () => {
    // Killer em repouso em (500, 300), Player colidindo continuamente de baixo (vy = -140)
    const killer = { x: 500, y: 300, radius: 84.8, vx: 0, vy: 0 };
    const playerRadius = 66.25;
    const minDistance = killer.radius + playerRadius; // 151.05

    let currentPlayerPos = { x: 500, y: 300 + minDistance - 5 }; // Começa 5px sobreposto
    let lastPlayerY = currentPlayerPos.y;

    // Simula 30 frames de contato sustentado onde a cada frame o jogador avança contra o Killer
    const stepDelta = 16.666 / 1000;
    for (let frame = 0; frame < 30; frame++) {
      // Simula o passo de física: Player avança com velocidade vy = -140 em direção ao Killer
      const integratedY = frame === 0 ? currentPlayerPos.y : currentPlayerPos.y + (-140 * stepDelta);
      const activePlayer = {
        x: currentPlayerPos.x,
        y: integratedY,
        radius: playerRadius,
        vx: 0,
        vy: -140
      };

      const res = resolveSolidBodyCollision(killer, activePlayer);

      expect(res.hasCollision).toBe(true);
      // Killer permanece perfeitamente imóvel (sem jitter ou oscilação)
      expect(res.killerPos.x).toBe(killer.x);
      expect(res.killerPos.y).toBe(killer.y);

      // Posição do Player é mantida exatamente na borda de separação >= minDistance
      const currentDist = Math.hypot(res.killerPos.x - res.playerPos.x, res.killerPos.y - res.playerPos.y);
      expect(currentDist).toBeGreaterThanOrEqual(minDistance - 0.001);

      if (frame > 0) {
        // Estabilidade posicional estrita: sem alternância de alta frequência (flicker/tremulação)
        expect(Math.abs(res.playerPos.y - lastPlayerY)).toBeLessThan(0.001);
      }

      // Velocidade frontal de aproximação é anulada
      expect(res.playerVel.y).toBe(0);

      lastPlayerY = res.playerPos.y;
      currentPlayerPos = { ...res.playerPos };
    }
  });

  it('strictly guarantees killer immobility (delta = 0) at rest under continuous player impact while preserving player tangential slide', () => {
    const killer = { x: 400, y: 400, radius: 84.8, vx: 0, vy: 0 };
    const playerRadius = 66.25;
    const minDistance = killer.radius + playerRadius;

    // Player se move diagonalmente para cima e para a direita (tentando deslizar em torno do Killer)
    // vx = 100, vy = -140 (Killer está diretamente acima em dx = 0, dy = -minDistance)
    const playerAtContact = {
      x: 400,
      y: 400 + minDistance - 2, // 2px sobreposto
      radius: playerRadius,
      vx: 100,
      vy: -140
    };

    const res = resolveSolidBodyCollision(killer, playerAtContact);

    expect(res.hasCollision).toBe(true);
    // Killer em repouso: delta = 0
    expect(res.killerPos.x).toBe(400);
    expect(res.killerPos.y).toBe(400);

    // Velocidade de aproximação vertical foi zerada, mas componente tangencial horizontal foi 100% preservada
    expect(res.playerVel.y).toBeCloseTo(0);
    expect(res.playerVel.x).toBeCloseTo(100);
  });
});
