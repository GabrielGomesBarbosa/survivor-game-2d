/**
 * @file Killer.ts
 * @description Entidade física do Assassino (Killer / Pawn).
 * Executa comandos de controle de baixo nível (movimentação, rotação, animação e renderização de depuração),
 * delegando as decisões estratégicas da IA ao seu controlador desacoplado (KillerAIController).
 */

import Phaser from 'phaser';
import EasyStar from 'easystarjs';
import { DebugSettings, TILE_SIZE, COLS, ROWS } from '../config/constants';
import { resolveAntiPushVelocity, resolveSolidBodyCollision, clampCircleAgainstNavGrid, smoothPathNodes, isRayClearOnNavGrid } from '../utils/gameLogic';
import { Player } from './Player';

import { Generator } from './Generator';
import { IKillerController } from '../controllers/KillerController';
import { KillerAIController, IKillerPawn } from '../controllers/KillerAIController';

export class Killer implements IKillerPawn {
  public sprite: Phaser.Physics.Arcade.Sprite;
  public controller!: IKillerController;

  // Trava de integridade contra penetração em paredes e imovabilidade estável
  public lastSafeX = 1280;
  public lastSafeY = 224;
  public lastStableX = 1280;
  public lastStableY = 224;

  // Configurações ativas de depuração
  private settings: DebugSettings;

  // Ataque e colisão
  private lastAttackTime = 0;

  // Gráficos de depuração
  private visionGraphic: Phaser.GameObjects.Graphics;
  private aStarGraphic: Phaser.GameObjects.Graphics;

  private scene: Phaser.Scene;
  private easystar: EasyStar.js;
  private navGrid: number[][];
  private walls: Phaser.Physics.Arcade.StaticGroup;
  private obstacles: Phaser.Physics.Arcade.StaticGroup;

  /**
   * Instancia e inicializa o Killer.
   */
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    settings: DebugSettings,
    easystar: EasyStar.js,
    navGrid: number[][],
    walls: Phaser.Physics.Arcade.StaticGroup,
    obstacles: Phaser.Physics.Arcade.StaticGroup
  ) {
    this.scene = scene;
    this.settings = settings;
    this.easystar = easystar;
    this.navGrid = navGrid;
    this.walls = walls;
    this.obstacles = obstacles;
    this.lastSafeX = x;
    this.lastSafeY = y;
    this.lastStableX = x;
    this.lastStableY = y;

    // Sprite físico do Killer (clone com tom avermelhado e escala 1.28x)
    this.sprite = scene.physics.add.sprite(x, y, 'survivor', 0);
    this.sprite.setTint(0xcc2222);
    this.sprite.setOrigin(0.5, 0.5);
    this.sprite.setCollideWorldBounds(true);
    this.sprite.setDepth(9);

    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setDamping(false);
    body.setDrag(0, 0);
    body.setImmovable(true);
    body.pushable = false;
    body.mass = 100000;

    this.updateHitbox(settings.hitboxRadius, settings.playerScale);

    // Gráficos de depuração
    this.visionGraphic = scene.add.graphics();
    this.visionGraphic.setDepth(5);

    this.aStarGraphic = scene.add.graphics();
    this.aStarGraphic.setDepth(6);

    // Inicializa com o controlador padrão de IA
    this.setController(new KillerAIController(this));
  }

  /**
   * Permite alternar dinamicamente o controlador do Killer (bot de IA, jogador humano ou rede multiplayer).
   */
  public setController(controller: IKillerController): void {
    this.controller = controller;
  }

  public get state(): string {
    if (this.settings && !this.settings.killerAiEnabled) {
      return 'DESATIVADO';
    }
    return this.controller ? this.controller.getState() : 'PATROL';
  }

  /**
   * Recalibra a hitbox do Killer proporcionalmente ao Player (28% maior).
   */
  public updateHitbox(hitboxRadius: number, playerScale: number): void {
    const killerScale = playerScale * 1.28;
    this.sprite.setScale(killerScale);
    const frameW = this.sprite.frame.width;
    const frameH = this.sprite.frame.height;
    const radius = hitboxRadius;
    const offsetX = frameW * 0.5 - radius;
    const offsetY = frameH * 0.5 - radius;

    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    if (body) {
      body.setCircle(radius, offsetX, offsetY);
      body.setImmovable(true);
      body.pushable = false;
      body.mass = 100000;
    }
  }

  /**
   * Atualização principal delegada ao controlador ativo.
   */
  public update(delta: number, player: Player, generators: Generator[], settings: DebugSettings): void {
    this.settings = settings;
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    if (body && Math.hypot(body.velocity.x, body.velocity.y) < 0.1) {
      this.lastStableX = this.sprite.x;
      this.lastStableY = this.sprite.y;
    }
    if (this.controller) {
      this.controller.update(delta, player, generators, settings);
    }
  }

  /**
   * Encaminha sinal de ruído ao controlador.
   */
  public alertToNoise(x: number, y: number): void {
    if (this.controller) {
      this.controller.alertToNoise(x, y);
    }
  }

  // ==========================================
  // ATUADORES FÍSICOS (Comandos de Controle)
  // ==========================================

  public setVelocity(vx: number, vy: number): void {
    this.sprite.setVelocity(vx, vy);
  }

  public stopMovement(): void {
    this.sprite.setVelocity(0, 0);
  }

  public rotateTowards(targetAngle: number, delta: number, turnSpeed: number): void {
    let currentAngle = this.sprite.rotation;
    if (typeof currentAngle !== 'number' || isNaN(currentAngle) || !isFinite(currentAngle)) {
      currentAngle = targetAngle;
      this.sprite.rotation = targetAngle;
    }
    currentAngle = Phaser.Math.Angle.Wrap(currentAngle);

    const diff = Phaser.Math.Angle.Wrap(targetAngle - currentAngle);
    const deltaSec = Math.min(delta / 1000, 0.1);
    const maxStep = turnSpeed * deltaSec;

    if (Math.abs(diff) <= maxStep) {
      this.sprite.rotation = targetAngle;
    } else {
      this.sprite.rotation = Phaser.Math.Angle.Wrap(currentAngle + Math.sign(diff) * maxStep);
    }
  }

  public playAnimation(key: string): void {
    if (!this.sprite.anims.isPlaying || this.sprite.anims.currentAnim?.key !== key) {
      this.sprite.anims.play(key, true);
    }
  }

  public stopAnimation(frame?: number): void {
    if (this.sprite.anims.isPlaying) {
      this.sprite.anims.stop();
    }
    if (typeof frame === 'number') {
      this.sprite.setFrame(frame);
    }
  }

  public isWalkableTile(x: number, y: number, margin: number = 4): boolean {
    const points = [
      { x, y },
      { x: x - margin, y },
      { x: x + margin, y },
      { x, y: y - margin },
      { x, y: y + margin }
    ];
    for (const pt of points) {
      const col = Math.floor(pt.x / TILE_SIZE);
      const row = Math.floor(pt.y / TILE_SIZE);
      if (row < 0 || row >= ROWS || col < 0 || col >= COLS || this.navGrid[row]?.[col] !== 0) {
        return false;
      }
    }
    return true;
  }

  /**
   * Tratamento de colisão física sólida não-elástica com o Player (Anti-Tunelamento e Bloqueio Corporal Rígido).
   */
  public handlePlayerCollision(player: Player, settings: DebugSettings, onAttack?: () => void): void {
    if (!this.sprite || !player.sprite || !this.sprite.body || !player.sprite.body) return;

    const now = this.scene.time.now;
    if (now - this.lastAttackTime >= 1400) {
      this.lastAttackTime = now;
      this.scene.cameras.main.flash(260, 220, 20, 20);
      onAttack?.();
    }

    const playerBody = player.sprite.body as Phaser.Physics.Arcade.Body;
    const killerBody = this.sprite.body as Phaser.Physics.Arcade.Body;

    // Proteção estrita de imovabilidade: se o Killer estiver em repouso perante seu próprio comando,
    // restaura sua posição estável sem sofrer nenhum deslocamento vetorial transmitido pelo Survivor
    if (Math.hypot(killerBody.velocity.x, killerBody.velocity.y) < 0.1) {
      this.sprite.setPosition(this.lastStableX, this.lastStableY);
      killerBody.updateCenter();
    }

    const playerRadius = settings.hitboxRadius * settings.playerScale;
    const killerRadius = playerRadius * 1.28;

    const resolution = resolveSolidBodyCollision(
      {
        x: this.sprite.x,
        y: this.sprite.y,
        radius: killerRadius,
        vx: killerBody.velocity.x,
        vy: killerBody.velocity.y
      },
      {
        x: player.sprite.x,
        y: player.sprite.y,
        radius: playerRadius,
        vx: playerBody.velocity.x,
        vy: playerBody.velocity.y
      },
      (wx, wy) => this.isWalkableTile(wx, wy)
    );

    if (resolution.hasCollision) {
      this.sprite.setPosition(resolution.killerPos.x, resolution.killerPos.y);
      player.sprite.setPosition(resolution.playerPos.x, resolution.playerPos.y);

      this.enforceWallBounds(this.navGrid);
      player.enforceWallBounds(this.navGrid);

      killerBody.setVelocity(resolution.killerVel.x, resolution.killerVel.y);
      playerBody.setVelocity(resolution.playerVel.x, resolution.playerVel.y);

      killerBody.updateCenter();
      playerBody.updateCenter();
    }
  }

  /**
   * Guarda pós-física anti-tunelamento para o Killer: se penetrar em uma célula sólida,
   * restaura instantaneamente para a última posição segura conhecida.
   * @param {number[][]} navGrid - Matriz de navegação 0 (livre) e 1 (parede).
   */
  public enforceWallBounds(navGrid: number[][]): void {
    if (!this.sprite || !this.sprite.body || navGrid.length === 0) return;

    const playerRadius = (this.settings?.hitboxRadius ?? 53) * (this.settings?.playerScale ?? 1.25);
    const killerRadius = playerRadius * 1.28;
    const clampResult = clampCircleAgainstNavGrid(this.sprite.x, this.sprite.y, killerRadius, navGrid);

    if (clampResult.clamped) {
      this.sprite.setPosition(clampResult.x, clampResult.y);
      (this.sprite.body as Phaser.Physics.Arcade.Body).updateCenter();
    }
    this.lastSafeX = this.sprite.x;
    this.lastSafeY = this.sprite.y;
  }

  /**
   * Atualiza dinamicamente a malha navGrid ativa do Killer (com geradores e paredes).
   */
  public updateNavGrid(navGrid: number[][]): void {
    this.navGrid = navGrid;
  }

  /**
   * Pós-processamento físico do Killer no POST_UPDATE.
   */
  public postUpdate(_delta: number, navGrid: number[][]): void {
    this.enforceWallBounds(navGrid);
  }

  /**
   * Verifica linha de visão desobstruída (Line of Sight - LOS) considerando corpos sólidos e navGrid.
   */
  public hasLineOfSight(x1: number, y1: number, x2: number, y2: number, clearance: number = 18): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 2) return true;

    const pX = -dy / dist;
    const pY = dx / dist;

    const rays = [
      new Phaser.Geom.Line(x1, y1, x2, y2),
      new Phaser.Geom.Line(x1 + pX * clearance, y1 + pY * clearance, x2 + pX * clearance, y2 + pY * clearance),
      new Phaser.Geom.Line(x1 - pX * clearance, y1 - pY * clearance, x2 - pX * clearance, y2 - pY * clearance)
    ];

    const wallBodies = this.walls.getChildren() as Phaser.GameObjects.Rectangle[];
    const obstacleBodies = this.obstacles.getChildren() as Phaser.GameObjects.Rectangle[];
    const allSolids = wallBodies.concat(obstacleBodies);

    for (const solid of allSolids) {
      const b = solid.body as Phaser.Physics.Arcade.StaticBody;
      if (!b) continue;

      const rect = new Phaser.Geom.Rectangle(b.x, b.y, b.width, b.height);
      for (const ray of rays) {
        if (Phaser.Geom.Intersects.LineToRectangle(ray, rect)) {
          return false;
        }
      }
    }

    if (this.navGrid && this.navGrid.length > 0) {
      if (!isRayClearOnNavGrid(x1, y1, x2, y2, this.navGrid, clearance, TILE_SIZE)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Executa o cálculo de caminho A* usando EasyStar.js com suavização e ancoragem no destino exato.
   */
  public calculatePath(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    onPathFound: (path: Array<{ x: number; y: number }>) => void
  ): void {
    const startCol = Phaser.Math.Clamp(Math.floor(fromX / TILE_SIZE), 0, COLS - 1);
    const startRow = Phaser.Math.Clamp(Math.floor(fromY / TILE_SIZE), 0, ROWS - 1);
    const endCol = Phaser.Math.Clamp(Math.floor(toX / TILE_SIZE), 0, COLS - 1);
    const endRow = Phaser.Math.Clamp(Math.floor(toY / TILE_SIZE), 0, ROWS - 1);

    const safeStart = this.getNearestWalkableTile(startCol, startRow);
    const safeEnd = this.getNearestWalkableTile(endCol, endRow);
    if (!safeStart || !safeEnd) return;

    this.easystar.findPath(safeStart.x, safeStart.y, safeEnd.x, safeEnd.y, (path) => {
      if (path && path.length > 0) {
        const mapped = path.map((p) => ({
          x: p.x * TILE_SIZE + TILE_SIZE / 2,
          y: p.y * TILE_SIZE + TILE_SIZE / 2
        }));

        // Suavização da rota eliminando degraus e ancorando exatamente no ponto alvo (toX, toY)
        const smoothed = smoothPathNodes(
          mapped,
          { x: toX, y: toY },
          (x1, y1, x2, y2) => this.hasLineOfSight(x1, y1, x2, y2)
        );

        onPathFound(smoothed);
      }
    });
    this.easystar.calculate();
  }

  private getNearestWalkableTile(col: number, row: number): { x: number; y: number } | null {
    if (this.navGrid[row]?.[col] === 0) {
      return { x: col, y: row };
    }
    for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const c = col + dx;
          const rw = row + dy;
          if (rw >= 0 && rw < ROWS && c >= 0 && c < COLS && this.navGrid[rw]?.[c] === 0) {
            return { x: c, y: rw };
          }
        }
      }
    }
    return null;
  }

  // ==========================================
  // RENDERIZAÇÃO DE DEPURAÇÃO
  // ==========================================

  public renderVisionGraphic(settings: DebugSettings, targetPos: { x: number; y: number }, isChase: boolean): void {
    if (!this.visionGraphic) return;
    this.visionGraphic.clear();

    if (!settings.showKillerVision || !settings.killerAiEnabled) return;

    const kx = this.sprite.x;
    const ky = this.sprite.y;
    const detectionRadius = settings.detectionRadius;
    const loseRadius = detectionRadius * 1.5;

    this.visionGraphic.lineStyle(1.5, 0xf0c674, 0.25);
    this.visionGraphic.strokeCircle(kx, ky, loseRadius);

    if (isChase) {
      this.visionGraphic.fillStyle(0xff3333, 0.1);
      this.visionGraphic.fillCircle(kx, ky, detectionRadius);
      this.visionGraphic.lineStyle(2, 0xff2222, 0.7);
      this.visionGraphic.strokeCircle(kx, ky, detectionRadius);

      this.visionGraphic.lineStyle(2, 0xff2222, 0.6);
      this.visionGraphic.lineBetween(kx, ky, targetPos.x, targetPos.y);
    } else {
      this.visionGraphic.fillStyle(0xff8833, 0.05);
      this.visionGraphic.fillCircle(kx, ky, detectionRadius);
      this.visionGraphic.lineStyle(1.5, 0xff8833, 0.4);
      this.visionGraphic.strokeCircle(kx, ky, detectionRadius);

      this.visionGraphic.lineStyle(1, 0x88bbff, 0.25);
      this.visionGraphic.lineBetween(kx, ky, targetPos.x, targetPos.y);
    }
  }

  public renderRouteGraphic(
    settings: DebugSettings,
    path: Array<{ x: number; y: number }>,
    pathIndex: number,
    isChase: boolean,
    hasDirectLOS: boolean,
    targetPos: { x: number; y: number }
  ): void {
    if (!this.aStarGraphic) return;
    this.aStarGraphic.clear();

    if (!settings.showAStarPath || !settings.killerAiEnabled) return;

    if (isChase) {
      if (hasDirectLOS) {
        this.aStarGraphic.lineStyle(3.5, 0xff2222, 0.95);
        this.aStarGraphic.lineBetween(this.sprite.x, this.sprite.y, targetPos.x, targetPos.y);
        this.aStarGraphic.fillStyle(0xff2222, 0.7);
        this.aStarGraphic.fillCircle(targetPos.x, targetPos.y, 9);
      } else if (path && path.length > 0) {
        this.aStarGraphic.lineStyle(3.5, 0xff2222, 0.95);

        const currentNode = path[pathIndex];
        if (currentNode) {
          this.aStarGraphic.lineBetween(this.sprite.x, this.sprite.y, currentNode.x, currentNode.y);
        }

        for (let i = pathIndex; i < path.length - 1; i++) {
          const n1 = path[i];
          const n2 = path[i + 1];
          this.aStarGraphic.lineBetween(n1.x, n1.y, n2.x, n2.y);
        }

        const lastNode = path[path.length - 1];
        if (lastNode && (lastNode.x !== targetPos.x || lastNode.y !== targetPos.y)) {
          this.aStarGraphic.lineBetween(lastNode.x, lastNode.y, targetPos.x, targetPos.y);
        }

        for (let i = 0; i < path.length; i++) {
          const node = path[i];
          if (i === pathIndex) {
            this.aStarGraphic.fillStyle(0xffffff, 1);
            this.aStarGraphic.fillCircle(node.x, node.y, 6);
            this.aStarGraphic.lineStyle(2.5, 0xff2222, 1);
            this.aStarGraphic.strokeCircle(node.x, node.y, 10);
          } else if (i > pathIndex) {
            this.aStarGraphic.fillStyle(0xff3333, 0.85);
            this.aStarGraphic.fillCircle(node.x, node.y, 5);
            this.aStarGraphic.lineStyle(1.5, 0xff6666, 0.6);
            this.aStarGraphic.strokeCircle(node.x, node.y, 7);
          }
        }
      }
    } else if (path && path.length > 0) {
      this.aStarGraphic.lineStyle(3, 0xff3333, 0.9);
      const currentNode = path[pathIndex];
      if (currentNode) {
        this.aStarGraphic.lineBetween(this.sprite.x, this.sprite.y, currentNode.x, currentNode.y);
      }
      for (let i = pathIndex; i < path.length - 1; i++) {
        const n1 = path[i];
        const n2 = path[i + 1];
        this.aStarGraphic.lineBetween(n1.x, n1.y, n2.x, n2.y);
      }
      const lastNode = path[path.length - 1];
      if (lastNode && (lastNode.x !== targetPos.x || lastNode.y !== targetPos.y)) {
        this.aStarGraphic.lineBetween(lastNode.x, lastNode.y, targetPos.x, targetPos.y);
      }

      for (let i = pathIndex; i < path.length; i++) {
        const node = path[i];
        if (node.x !== targetPos.x || node.y !== targetPos.y) {
          this.aStarGraphic.fillStyle(0xffffff, 0.85);
          this.aStarGraphic.fillCircle(node.x, node.y, 4);
        }
      }

      this.aStarGraphic.fillStyle(0xff2222, 0.9);
      this.aStarGraphic.fillCircle(targetPos.x, targetPos.y, 7);
      this.aStarGraphic.lineStyle(2, 0xffffff, 0.95);
      this.aStarGraphic.strokeCircle(targetPos.x, targetPos.y, 11);
    } else {
      this.aStarGraphic.lineStyle(2.5, 0xff3333, 0.8);
      this.aStarGraphic.lineBetween(this.sprite.x, this.sprite.y, targetPos.x, targetPos.y);
      this.aStarGraphic.fillStyle(0xff2222, 0.85);
      this.aStarGraphic.fillCircle(targetPos.x, targetPos.y, 7);
      this.aStarGraphic.lineStyle(2, 0xffffff, 0.95);
      this.aStarGraphic.strokeCircle(targetPos.x, targetPos.y, 11);
    }
  }

  public destroy(): void {
    this.visionGraphic.destroy();
    this.aStarGraphic.destroy();
    this.sprite.destroy();
  }

  get x(): number {
    return this.sprite.x;
  }

  get y(): number {
    return this.sprite.y;
  }

  get rotation(): number {
    return this.sprite.rotation;
  }
}
