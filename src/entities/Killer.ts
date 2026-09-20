/**
 * @file Killer.ts
 * @description Entidade do Assassino (Killer) com IA baseada em Máquina de Estados Finitos (FSM: PATROL/CHASE),
 * detecção em raio, linha de visão desobstruída (LOS), contorno inteligente de quinas via A* (EasyStar.js),
 * tratamento de colisão não-elástica anti-tunelamento e reação a ruídos de explosão.
 */

import Phaser from 'phaser';
import EasyStar from 'easystarjs';
import { DebugSettings, TILE_SIZE, COLS, ROWS } from '../config/constants';
import { resolveAntiPushVelocity } from '../utils/gameLogic';
import { Player } from './Player';
import { Generator } from './Generator';

export type KillerState = 'PATROL' | 'CHASE';

export class Killer {
  public sprite: Phaser.Physics.Arcade.Sprite;
  public state: KillerState = 'PATROL';
  public patrolTarget: Phaser.Math.Vector2;
  public patrolWaitTimer = 0;

  // Rotação e visada
  public hasDirectLOS = false;
  private pathRecalcTimer = 0;
  private currentChasePath: Array<{ x: number; y: number }> = [];
  private currentPathIndex = 0;
  private patrolPath: Array<{ x: number; y: number }> = [];
  private patrolPathIndex = 0;

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

  // Waypoints pré-calibrados nos eixos de circulação
  private patrolWaypoints: Array<{ x: number; y: number }> = [
    { x: 1280, y: 480 },  // Corredor Norte Centro
    { x: 720, y: 480 },   // Corredor Norte / Oeste
    { x: 1840, y: 480 },  // Corredor Norte / Leste
    { x: 720, y: 960 },   // Corredor Oeste Central
    { x: 1840, y: 960 },  // Corredor Leste Central
    { x: 1280, y: 1440 }, // Corredor Sul Centro
    { x: 720, y: 1440 },  // Corredor Sul / Oeste
    { x: 1840, y: 1440 }, // Corredor Sul / Leste
    { x: 320, y: 960 },   // Enfermaria (Ala Oeste)
    { x: 2240, y: 960 },  // Gerador A (Ala Leste)
    { x: 1280, y: 960 },  // Recepção Central
    { x: 1280, y: 224 },  // Ala de Contenção (Norte)
    { x: 1280, y: 1680 }  // Setor de Manutenção (Sul)
  ];

  /**
   * Instancia e inicializa o Killer.
   * @param {Phaser.Scene} scene - Cena do Phaser.
   * @param {number} x - Posição X inicial (ex: 1280).
   * @param {number} y - Posição Y inicial (ex: 224 na Contenção).
   * @param {DebugSettings} settings - Parâmetros iniciais.
   * @param {EasyStar.js} easystar - Instância de pathfinding A*.
   * @param {number[][]} navGrid - Matriz de navegação lógica.
   * @param {Phaser.Physics.Arcade.StaticGroup} walls - Grupo estático de paredes.
   * @param {Phaser.Physics.Arcade.StaticGroup} obstacles - Grupo estático de obstáculos/geradores.
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
    this.easystar = easystar;
    this.navGrid = navGrid;
    this.walls = walls;
    this.obstacles = obstacles;
    this.patrolTarget = new Phaser.Math.Vector2(1280, 480);

    // Sprite físico do Killer (clone com tom avermelhado e escala 1.28x)
    this.sprite = scene.physics.add.sprite(x, y, 'survivor', 0);
    this.sprite.setTint(0xcc2222);
    this.sprite.setOrigin(0.5, 0.5);
    this.sprite.setCollideWorldBounds(true);
    this.sprite.setDepth(9);

    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setDamping(false);
    body.setDrag(0, 0);

    this.updateHitbox(settings.hitboxRadius, settings.playerScale);

    // Gráficos de depuração
    this.visionGraphic = scene.add.graphics();
    this.visionGraphic.setDepth(5);

    this.aStarGraphic = scene.add.graphics();
    this.aStarGraphic.setDepth(6);
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
    }
  }

  /**
   * Atualização principal por frame da IA do Assassino.
   * @param {number} delta - Delta em milissegundos.
   * @param {Player} player - Entidade do jogador alvo.
   * @param {Generator[]} incompleteGenerators - Lista de geradores que ainda requerem reparo.
   * @param {DebugSettings} settings - Parâmetros de velocidade e IA.
   */
  public update(
    delta: number,
    player: Player,
    incompleteGenerators: Generator[],
    settings: DebugSettings
  ): void {
    this.handleAI(delta, player, incompleteGenerators, settings);
    this.updateVisionGraphic(settings, player);
    this.updateAStarGraphic(settings, player);
  }

  /**
   * Lógica da Máquina de Estados (FSM) e perseguição inteligente com A*.
   */
  private handleAI(
    delta: number,
    player: Player,
    incompleteGenerators: Generator[],
    settings: DebugSettings
  ): void {
    if (!settings.killerAiEnabled) {
      this.sprite.setVelocity(0, 0);
      if (this.sprite.anims.isPlaying) {
        this.sprite.anims.stop();
        this.sprite.setFrame(0);
      }
      return;
    }

    const distToPlayer = Phaser.Math.Distance.Between(
      this.sprite.x,
      this.sprite.y,
      player.x,
      player.y
    );

    const detectionRadius = settings.detectionRadius;
    const loseRadius = detectionRadius * 1.5;

    // Transição de estado
    if (this.state === 'PATROL') {
      if (distToPlayer <= detectionRadius) {
        this.state = 'CHASE';
        this.currentChasePath = [];
        this.currentPathIndex = 0;
        this.pathRecalcTimer = 300;
      }
    } else if (this.state === 'CHASE') {
      if (distToPlayer > loseRadius) {
        this.state = 'PATROL';
        this.currentChasePath = [];
        this.pickNewPatrolTarget(incompleteGenerators);
      }
    }

    // Execução do estado
    if (this.state === 'CHASE') {
      const speed = settings.killerSpeed;

      if (distToPlayer < 24) {
        // Encurralou o jogador: mantém pressão sem atravessar
        this.sprite.setVelocity(0, 0);
        if (this.sprite.anims.isPlaying) {
          this.sprite.anims.stop();
          this.sprite.setFrame(0);
        }

        const dx = player.x - this.sprite.x;
        const dy = player.y - this.sprite.y;
        const targetAngle = Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - Math.PI / 2);
        this.rotateTowards(targetAngle, delta, 14);
      } else {
        // Verificar linha direta de visão (Line of Sight)
        this.hasDirectLOS = this.hasLineOfSight(
          this.sprite.x,
          this.sprite.y,
          player.x,
          player.y
        );

        if (this.hasDirectLOS) {
          this.currentChasePath = [];
          const dx = player.x - this.sprite.x;
          const dy = player.y - this.sprite.y;
          const moveVec = new Phaser.Math.Vector2(dx, dy).normalize();

          this.sprite.setVelocity(moveVec.x * speed, moveVec.y * speed);

          if (!this.sprite.anims.isPlaying || this.sprite.anims.currentAnim?.key !== 'run') {
            this.sprite.anims.play('run', true);
          }

          const targetAngle = Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - Math.PI / 2);
          this.rotateTowards(targetAngle, delta, 14);
        } else {
          // Visão bloqueada por obstáculos: A* Pathfinding
          this.pathRecalcTimer += delta;
          if (this.pathRecalcTimer >= 250 || this.currentChasePath.length === 0) {
            this.pathRecalcTimer = 0;
            this.calculateAStarPath(this.sprite.x, this.sprite.y, player.x, player.y);
          }

          if (this.currentChasePath.length > 0) {
            const targetNode = this.currentChasePath[this.currentPathIndex];
            const distToNode = Phaser.Math.Distance.Between(
              this.sprite.x,
              this.sprite.y,
              targetNode.x,
              targetNode.y
            );

            if (distToNode < 36 && this.currentPathIndex < this.currentChasePath.length - 1) {
              this.currentPathIndex++;
            }

            // String pulling: atalho se já houver LOS para o próximo nó
            if (this.currentPathIndex + 1 < this.currentChasePath.length) {
              const nextNode = this.currentChasePath[this.currentPathIndex + 1];
              if (this.hasLineOfSight(this.sprite.x, this.sprite.y, nextNode.x, nextNode.y)) {
                this.currentPathIndex++;
              }
            }

            const activeNode = this.currentChasePath[this.currentPathIndex];
            const dx = activeNode.x - this.sprite.x;
            const dy = activeNode.y - this.sprite.y;
            const moveVec = new Phaser.Math.Vector2(dx, dy).normalize();

            this.sprite.setVelocity(moveVec.x * speed, moveVec.y * speed);

            if (!this.sprite.anims.isPlaying || this.sprite.anims.currentAnim?.key !== 'run') {
              this.sprite.anims.play('run', true);
            }

            const targetAngle = Phaser.Math.Angle.Wrap(Math.atan2(moveVec.y, moveVec.x) - Math.PI / 2);
            this.rotateTowards(targetAngle, delta, 12);
          } else {
            const dx = player.x - this.sprite.x;
            const dy = player.y - this.sprite.y;
            const moveVec = new Phaser.Math.Vector2(dx, dy).normalize();
            this.sprite.setVelocity(moveVec.x * speed * 0.5, moveVec.y * speed * 0.5);
          }
        }
      }
    } else {
      // Estado PATROL
      const distToTarget = Phaser.Math.Distance.Between(
        this.sprite.x,
        this.sprite.y,
        this.patrolTarget.x,
        this.patrolTarget.y
      );

      if (distToTarget < 38) {
        this.sprite.setVelocity(0, 0);
        if (this.sprite.anims.isPlaying) {
          this.sprite.anims.stop();
          this.sprite.setFrame(0);
        }

        this.patrolWaitTimer += delta;
        if (this.patrolWaitTimer >= 1800) {
          this.patrolWaitTimer = 0;
          this.pickNewPatrolTarget(incompleteGenerators);
        }
      } else {
        const patrolSpeed = settings.killerSpeed * 0.45;

        if (this.hasLineOfSight(this.sprite.x, this.sprite.y, this.patrolTarget.x, this.patrolTarget.y)) {
          this.patrolPath = [];
          const dx = this.patrolTarget.x - this.sprite.x;
          const dy = this.patrolTarget.y - this.sprite.y;
          const moveVec = new Phaser.Math.Vector2(dx, dy).normalize();

          this.sprite.setVelocity(moveVec.x * patrolSpeed, moveVec.y * patrolSpeed);

          if (!this.sprite.anims.isPlaying || this.sprite.anims.currentAnim?.key !== 'walk') {
            this.sprite.anims.play('walk', true);
          }

          const targetAngle = Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - Math.PI / 2);
          this.rotateTowards(targetAngle, delta, 5);
        } else {
          if (this.patrolPath.length > 0) {
            const targetNode = this.patrolPath[this.patrolPathIndex];
            const distToNode = Phaser.Math.Distance.Between(
              this.sprite.x,
              this.sprite.y,
              targetNode.x,
              targetNode.y
            );

            if (distToNode < 36 && this.patrolPathIndex < this.patrolPath.length - 1) {
              this.patrolPathIndex++;
            }

            const activeNode = this.patrolPath[this.patrolPathIndex];
            const dx = activeNode.x - this.sprite.x;
            const dy = activeNode.y - this.sprite.y;
            const moveVec = new Phaser.Math.Vector2(dx, dy).normalize();

            this.sprite.setVelocity(moveVec.x * patrolSpeed, moveVec.y * patrolSpeed);

            if (!this.sprite.anims.isPlaying || this.sprite.anims.currentAnim?.key !== 'walk') {
              this.sprite.anims.play('walk', true);
            }

            const targetAngle = Phaser.Math.Angle.Wrap(Math.atan2(moveVec.y, moveVec.x) - Math.PI / 2);
            this.rotateTowards(targetAngle, delta, 6);
          } else {
            this.calculatePatrolPath(this.sprite.x, this.sprite.y, this.patrolTarget.x, this.patrolTarget.y);
          }
        }
      }
    }
  }

  /**
   * Escolhe um novo ponto de ronda (50% de chance de inspecionar gerador incompleto).
   */
  public pickNewPatrolTarget(incompleteGenerators: Generator[]): void {
    if (incompleteGenerators.length > 0 && Math.random() < 0.5) {
      const targetGen = Phaser.Utils.Array.GetRandom(incompleteGenerators);
      const offsetX = Phaser.Math.Between(-35, 35);
      const offsetY = Phaser.Math.Between(-35, 35);
      this.patrolTarget.set(targetGen.x + offsetX, targetGen.y + offsetY);
    } else {
      const randomWp = Phaser.Utils.Array.GetRandom(this.patrolWaypoints);
      const offsetX = Phaser.Math.Between(-25, 25);
      const offsetY = Phaser.Math.Between(-25, 25);
      this.patrolTarget.set(randomWp.x + offsetX, randomWp.y + offsetY);
    }

    this.patrolPath = [];
    this.patrolPathIndex = 0;
    this.calculatePatrolPath(this.sprite.x, this.sprite.y, this.patrolTarget.x, this.patrolTarget.y);
  }

  /**
   * Alerta imediatamente o Killer em direção a uma explosão de gerador.
   * @param {number} x - Coordenada X da explosão.
   * @param {number} y - Coordenada Y da explosão.
   */
  public alertToNoise(x: number, y: number): void {
    if (this.state === 'PATROL') {
      this.patrolTarget.set(x, y);
      this.patrolPath = [];
      this.patrolPathIndex = 0;
      this.patrolWaitTimer = 0;
      this.calculatePatrolPath(this.sprite.x, this.sprite.y, x, y);
    }
  }

  /**
   * Tratamento de colisão física sólida não-elástica com o Player (Zero Regressão contra Tunelamento):
   * Anula a velocidade frontal de aproximação mútua, impedindo que o Killer empurre o Player para as paredes.
   * @param {Player} player - Instância do jogador.
   * @param {() => void} onAttack - Callback disparado quando o ataque é registrado.
   */
  public handlePlayerCollision(player: Player, onAttack?: () => void): void {
    if (!this.sprite || !player.sprite || !this.sprite.body || !player.sprite.body) return;

    const now = this.scene.time.now;
    if (now - this.lastAttackTime >= 1400) {
      this.lastAttackTime = now;
      this.scene.cameras.main.flash(260, 220, 20, 20);
      onAttack?.();
    }

    const playerBody = player.sprite.body as Phaser.Physics.Arcade.Body;
    const killerBody = this.sprite.body as Phaser.Physics.Arcade.Body;

    const dx = this.sprite.x - player.sprite.x;
    const dy = this.sprite.y - player.sprite.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 0.001) {
      const resolved = resolveAntiPushVelocity(killerBody.velocity, playerBody.velocity, dx, dy);
      killerBody.setVelocity(resolved.killerVel.x, resolved.killerVel.y);
      playerBody.setVelocity(resolved.playerVel.x, resolved.playerVel.y);
    }
  }

  /**
   * Verifica se há linha de visão desobstruída (Line of Sight - LOS).
   */
  public hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 2) return true;

    const pX = -dy / dist;
    const pY = dx / dist;
    const margin = 26;

    const rays = [
      new Phaser.Geom.Line(x1, y1, x2, y2),
      new Phaser.Geom.Line(x1 + pX * margin, y1 + pY * margin, x2 + pX * margin, y2 + pY * margin),
      new Phaser.Geom.Line(x1 - pX * margin, y1 - pY * margin, x2 - pX * margin, y2 - pY * margin)
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
    return true;
  }

  private calculateAStarPath(fromX: number, fromY: number, toX: number, toY: number): void {
    const startCol = Phaser.Math.Clamp(Math.floor(fromX / TILE_SIZE), 0, COLS - 1);
    const startRow = Phaser.Math.Clamp(Math.floor(fromY / TILE_SIZE), 0, ROWS - 1);
    const endCol = Phaser.Math.Clamp(Math.floor(toX / TILE_SIZE), 0, COLS - 1);
    const endRow = Phaser.Math.Clamp(Math.floor(toY / TILE_SIZE), 0, ROWS - 1);

    const safeStart = this.getNearestWalkableTile(startCol, startRow);
    const safeEnd = this.getNearestWalkableTile(endCol, endRow);
    if (!safeStart || !safeEnd) return;

    this.easystar.findPath(safeStart.x, safeStart.y, safeEnd.x, safeEnd.y, (path) => {
      if (path && path.length > 0) {
        this.currentChasePath = path.map((p) => ({
          x: p.x * TILE_SIZE + TILE_SIZE / 2,
          y: p.y * TILE_SIZE + TILE_SIZE / 2
        }));
        this.currentPathIndex = this.currentChasePath.length > 1 ? 1 : 0;
      }
    });
    this.easystar.calculate();
  }

  private calculatePatrolPath(fromX: number, fromY: number, toX: number, toY: number): void {
    const startCol = Phaser.Math.Clamp(Math.floor(fromX / TILE_SIZE), 0, COLS - 1);
    const startRow = Phaser.Math.Clamp(Math.floor(fromY / TILE_SIZE), 0, ROWS - 1);
    const endCol = Phaser.Math.Clamp(Math.floor(toX / TILE_SIZE), 0, COLS - 1);
    const endRow = Phaser.Math.Clamp(Math.floor(toY / TILE_SIZE), 0, ROWS - 1);

    const safeStart = this.getNearestWalkableTile(startCol, startRow);
    const safeEnd = this.getNearestWalkableTile(endCol, endRow);
    if (!safeStart || !safeEnd) return;

    this.easystar.findPath(safeStart.x, safeStart.y, safeEnd.x, safeEnd.y, (path) => {
      if (path && path.length > 0) {
        this.patrolPath = path.map((p) => ({
          x: p.x * TILE_SIZE + TILE_SIZE / 2,
          y: p.y * TILE_SIZE + TILE_SIZE / 2
        }));
        this.patrolPathIndex = this.patrolPath.length > 1 ? 1 : 0;
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

  private rotateTowards(targetAngle: number, delta: number, turnSpeed: number): void {
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

  private updateVisionGraphic(settings: DebugSettings, player: Player): void {
    if (!this.visionGraphic) return;
    this.visionGraphic.clear();

    if (!settings.showKillerVision || !settings.killerAiEnabled) return;

    const kx = this.sprite.x;
    const ky = this.sprite.y;
    const detectionRadius = settings.detectionRadius;
    const loseRadius = detectionRadius * 1.5;

    this.visionGraphic.lineStyle(1.5, 0xf0c674, 0.25);
    this.visionGraphic.strokeCircle(kx, ky, loseRadius);

    if (this.state === 'CHASE') {
      this.visionGraphic.fillStyle(0xff3333, 0.1);
      this.visionGraphic.fillCircle(kx, ky, detectionRadius);
      this.visionGraphic.lineStyle(2, 0xff2222, 0.7);
      this.visionGraphic.strokeCircle(kx, ky, detectionRadius);

      this.visionGraphic.lineStyle(2, 0xff2222, 0.6);
      this.visionGraphic.lineBetween(kx, ky, player.x, player.y);
    } else {
      this.visionGraphic.fillStyle(0xff8833, 0.05);
      this.visionGraphic.fillCircle(kx, ky, detectionRadius);
      this.visionGraphic.lineStyle(1.5, 0xff8833, 0.4);
      this.visionGraphic.strokeCircle(kx, ky, detectionRadius);

      this.visionGraphic.lineStyle(1, 0x88bbff, 0.25);
      this.visionGraphic.lineBetween(kx, ky, this.patrolTarget.x, this.patrolTarget.y);
    }
  }

  private updateAStarGraphic(settings: DebugSettings, player: Player): void {
    if (!this.aStarGraphic) return;
    this.aStarGraphic.clear();

    if (!settings.showAStarPath || !settings.killerAiEnabled) return;

    if (this.state === 'CHASE') {
      if (this.hasDirectLOS) {
        this.aStarGraphic.lineStyle(2.5, 0x00ff88, 0.7);
        this.aStarGraphic.lineBetween(this.sprite.x, this.sprite.y, player.x, player.y);
        this.aStarGraphic.fillStyle(0x00ff88, 0.4);
        this.aStarGraphic.fillCircle(player.x, player.y, 8);
      } else if (this.currentChasePath && this.currentChasePath.length > 0) {
        this.aStarGraphic.lineStyle(3, 0x00d4ff, 0.85);

        const currentNode = this.currentChasePath[this.currentPathIndex];
        if (currentNode) {
          this.aStarGraphic.lineBetween(this.sprite.x, this.sprite.y, currentNode.x, currentNode.y);
        }

        for (let i = this.currentPathIndex; i < this.currentChasePath.length - 1; i++) {
          const n1 = this.currentChasePath[i];
          const n2 = this.currentChasePath[i + 1];
          this.aStarGraphic.lineBetween(n1.x, n1.y, n2.x, n2.y);
        }

        const lastNode = this.currentChasePath[this.currentChasePath.length - 1];
        if (lastNode) {
          this.aStarGraphic.lineStyle(2, 0xffaa00, 0.8);
          this.aStarGraphic.lineBetween(lastNode.x, lastNode.y, player.x, player.y);
        }

        for (let i = 0; i < this.currentChasePath.length; i++) {
          const node = this.currentChasePath[i];
          if (i === this.currentPathIndex) {
            this.aStarGraphic.fillStyle(0xffbb00, 0.9);
            this.aStarGraphic.fillCircle(node.x, node.y, 7);
            this.aStarGraphic.lineStyle(2, 0xffffff, 1);
            this.aStarGraphic.strokeCircle(node.x, node.y, 10);
          } else if (i > this.currentPathIndex) {
            this.aStarGraphic.fillStyle(0x00d4ff, 0.7);
            this.aStarGraphic.fillCircle(node.x, node.y, 5);
            this.aStarGraphic.lineStyle(1.5, 0x0088cc, 0.5);
            this.aStarGraphic.strokeCircle(node.x, node.y, 7);
          }
        }
      }
    } else if (this.patrolPath && this.patrolPath.length > 0) {
      this.aStarGraphic.lineStyle(1.5, 0x88bbff, 0.4);
      const currentNode = this.patrolPath[this.patrolPathIndex];
      if (currentNode) {
        this.aStarGraphic.lineBetween(this.sprite.x, this.sprite.y, currentNode.x, currentNode.y);
      }
      for (let i = this.patrolPathIndex; i < this.patrolPath.length - 1; i++) {
        const n1 = this.patrolPath[i];
        const n2 = this.patrolPath[i + 1];
        this.aStarGraphic.lineBetween(n1.x, n1.y, n2.x, n2.y);
      }
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
}
