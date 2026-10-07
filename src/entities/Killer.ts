/**
 * @file Killer.ts
 * @description Entidade física do Assassino (Killer / Pawn).
 * Focado na física Arcade, movimentação, colisão sólida e atuação do peão,
 * delegando o combate M1 a KillerCombatSystem e depuração visual a KillerDebugRenderer.
 */

import Phaser from 'phaser';
import EasyStar from 'easystarjs';
import { DebugSettings, TILE_SIZE, COLS, ROWS } from '../config/constants';
import { resolveSolidBodyCollision, clampCircleAgainstNavGrid, smoothPathNodes, isRayClearOnNavGrid, hasClearanceLineOfSight, buildAiWeightedGrid } from '../utils/gameLogic';
import { Player } from './Player';
import { Generator } from './Generator';
import { IKillerController } from '../controllers/KillerController';
import { KillerAIController, IKillerPawn } from '../controllers/KillerAIController';
import { KillerCombatSystem, KillerAttackState, KillerAttackCallbacks, ICombatPawn } from '../combat/KillerCombatSystem';
import { KillerDebugRenderer } from '../rendering/KillerDebugRenderer';

export type { KillerAttackState, KillerAttackCallbacks };

function checkRaysIntersectSolids(x1: number, y1: number, x2: number, y2: number, clearance: number, solids: Phaser.GameObjects.Rectangle[]): boolean {
  const dx = x2 - x1, dy = y2 - y1, dist = Math.hypot(dx, dy);
  if (dist < 2) return false;
  const pX = (-dy / dist) * clearance, pY = (dx / dist) * clearance;
  const rays = [
    new Phaser.Geom.Line(x1, y1, x2, y2),
    new Phaser.Geom.Line(x1 + pX, y1 + pY, x2 + pX, y2 + pY),
    new Phaser.Geom.Line(x1 - pX, y1 - pY, x2 - pX, y2 - pY)
  ];
  for (const solid of solids) {
    const b = solid.body as Phaser.Physics.Arcade.StaticBody;
    if (b && rays.some((r) => Phaser.Geom.Intersects.LineToRectangle(r, new Phaser.Geom.Rectangle(b.x, b.y, b.width, b.height)))) return true;
  }
  return false;
}

export class Killer implements IKillerPawn, ICombatPawn {
  public sprite: Phaser.Physics.Arcade.Sprite;
  public controller!: IKillerController;

  public lastSafeX = 1280;
  public lastSafeY = 224;
  public lastStableX = 1280;
  public lastStableY = 224;

  private combatSystem: KillerCombatSystem;
  private debugRenderer: KillerDebugRenderer;
  private settings: DebugSettings;
  private lastAttackTime = 0;
  private scene: Phaser.Scene;
  private easystar: EasyStar.js;
  private navGrid: number[][];
  private weightedGrid: number[][];
  private walls: Phaser.Physics.Arcade.StaticGroup;
  private obstacles: Phaser.Physics.Arcade.StaticGroup;

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
    this.weightedGrid = buildAiWeightedGrid(navGrid);
    this.walls = walls;
    this.obstacles = obstacles;
    this.lastSafeX = x; this.lastSafeY = y;
    this.lastStableX = x; this.lastStableY = y;

    this.sprite = scene.physics.add.sprite(x, y, 'survivor', 0);
    this.sprite.setTint(0xcc2222).setOrigin(0.5, 0.5).setCollideWorldBounds(true).setDepth(9);

    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setDamping(false).setDrag(0, 0).setImmovable(true);
    body.pushable = false; body.mass = 100000;

    this.updateHitbox(settings.hitboxRadius, settings.playerScale);
    this.combatSystem = new KillerCombatSystem(this);
    this.debugRenderer = new KillerDebugRenderer(scene);
    this.setController(new KillerAIController(this));
  }

  public setController(controller: IKillerController): void { this.controller = controller; }

  public get state(): string {
    if (this.settings && !this.settings.killerAiEnabled) return 'DESATIVADO';
    return this.combatSystem.getStateLabel() || (this.controller ? this.controller.getState() : 'PATROL');
  }

  // Delegados de combate M1 para compatibilidade de API
  public get isAttacking(): boolean { return this.combatSystem.isAttacking; }
  public set isAttacking(v: boolean) { this.combatSystem.isAttacking = v; }
  public get attackState(): KillerAttackState { return this.combatSystem.attackState; }
  public set attackState(v: KillerAttackState) { this.combatSystem.attackState = v; }
  public get attackTimer(): number { return this.combatSystem.attackTimer; }
  public set attackTimer(v: number) { this.combatSystem.attackTimer = v; }
  public get attackCallbacks(): KillerAttackCallbacks { return this.combatSystem.attackCallbacks; }
  public set attackCallbacks(v: KillerAttackCallbacks) { this.combatSystem.attackCallbacks = v; }
  public get targetSurvivor(): Player | undefined { return this.combatSystem.targetSurvivor; }
  public set targetSurvivor(v: Player | undefined) { this.combatSystem.targetSurvivor = v; }

  public performAttack(targetPlayer?: Player): boolean { return this.combatSystem.performAttack(targetPlayer, this.settings); }
  public updateAttack(delta: number, player?: Player, settings?: DebugSettings): void { this.combatSystem.updateAttack(delta, player, settings || this.settings); }
  public onAttackHit(survivor?: Player): void { this.combatSystem.onAttackHit(survivor); }
  public onAttackMiss(): void { this.combatSystem.onAttackMiss(); }
  public checkSlashHit(player: Player, settings?: DebugSettings): boolean { return this.combatSystem.checkSlashHit(player, settings || this.settings); }

  public flashCamera(duration = 260, red = 220, green = 20, blue = 20): void {
    if (this.scene?.cameras?.main) this.scene.cameras.main.flash(duration, red, green, blue);
  }

  public updateHitbox(hitboxRadius: number, playerScale: number): void {
    this.sprite.setScale(playerScale * 1.28);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    if (body) {
      body.setCircle(hitboxRadius, this.sprite.frame.width * 0.5 - hitboxRadius, this.sprite.frame.height * 0.5 - hitboxRadius);
      body.setImmovable(true); body.pushable = false; body.mass = 100000;
    }
  }

  public update(delta: number, player: Player, generators: Generator[], settings: DebugSettings): void {
    this.settings = settings;
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    if (body && Math.hypot(body.velocity.x, body.velocity.y) < 0.1) {
      this.lastStableX = this.sprite.x; this.lastStableY = this.sprite.y;
    }
    if (this.isAttacking) this.updateAttack(delta, player, settings);
    if (this.controller) this.controller.update(delta, player, generators, settings);
  }

  public alertToNoise(x: number, y: number, targetGen?: Generator | { name: string; x: number; y: number; rotation?: number }): void {
    if (this.controller) this.controller.alertToNoise(x, y, targetGen);
  }

  public get isMoving(): boolean {
    const body = this.sprite?.body as Phaser.Physics.Arcade.Body | undefined;
    return body ? Math.hypot(body.velocity.x, body.velocity.y) > 10 : false;
  }

  public setVelocity(vx: number, vy: number): void { this.sprite.setVelocity(vx, vy); }
  public stopMovement(): void { this.sprite.setVelocity(0, 0); }

  public rotateTowards(targetAngle: number, delta: number, turnSpeed: number): void {
    let currentAngle = this.sprite.rotation;
    if (typeof currentAngle !== 'number' || isNaN(currentAngle) || !isFinite(currentAngle)) {
      currentAngle = targetAngle; this.sprite.rotation = targetAngle;
    }
    currentAngle = Phaser.Math.Angle.Wrap(currentAngle);
    const diff = Phaser.Math.Angle.Wrap(targetAngle - currentAngle);
    const maxStep = turnSpeed * Math.min(delta / 1000, 0.1);
    this.sprite.rotation = Math.abs(diff) <= maxStep ? targetAngle : Phaser.Math.Angle.Wrap(currentAngle + Math.sign(diff) * maxStep);
  }

  public playAnimation(key: string): void {
    if (!this.sprite.anims.isPlaying || this.sprite.anims.currentAnim?.key !== key) this.sprite.anims.play(key, true);
  }

  public stopAnimation(frame?: number): void {
    if (this.sprite.anims.isPlaying) this.sprite.anims.stop();
    if (typeof frame === 'number') this.sprite.setFrame(frame);
  }

  public isWalkableTile(x: number, y: number, margin = 4): boolean {
    const pts = [{ x, y }, { x: x - margin, y }, { x: x + margin, y }, { x, y: y - margin }, { x, y: y + margin }];
    for (const pt of pts) {
      const col = Math.floor(pt.x / TILE_SIZE), row = Math.floor(pt.y / TILE_SIZE);
      if (row < 0 || row >= ROWS || col < 0 || col >= COLS || this.navGrid[row]?.[col] !== 0) return false;
    }
    return true;
  }

  public handlePlayerCollision(player: Player, settings: DebugSettings, onAttack?: () => void): void {
    if (!this.sprite || !player.sprite || !this.sprite.body || !player.sprite.body) return;
    if (this.isAttacking && this.attackState === 'LUNGE') this.onAttackHit(player);

    const now = this.scene.time.now;
    if (now - this.lastAttackTime >= 1400) {
      this.lastAttackTime = now;
      this.flashCamera(260, 220, 20, 20);
      onAttack?.();
    }

    const playerBody = player.sprite.body as Phaser.Physics.Arcade.Body;
    const killerBody = this.sprite.body as Phaser.Physics.Arcade.Body;
    if (Math.hypot(killerBody.velocity.x, killerBody.velocity.y) < 0.1) {
      this.sprite.setPosition(this.lastStableX, this.lastStableY);
      killerBody.updateCenter();
    }

    const pRadius = settings.hitboxRadius * settings.playerScale;
    const res = resolveSolidBodyCollision(
      { x: this.sprite.x, y: this.sprite.y, radius: pRadius * 1.28, vx: killerBody.velocity.x, vy: killerBody.velocity.y },
      { x: player.sprite.x, y: player.sprite.y, radius: pRadius, vx: playerBody.velocity.x, vy: playerBody.velocity.y },
      (wx, wy) => this.isWalkableTile(wx, wy)
    );

    if (res.hasCollision) {
      this.sprite.setPosition(res.killerPos.x, res.killerPos.y);
      player.sprite.setPosition(res.playerPos.x, res.playerPos.y);
      this.enforceWallBounds(this.navGrid);
      player.enforceWallBounds(this.navGrid);
      killerBody.setVelocity(res.killerVel.x, res.killerVel.y);
      playerBody.setVelocity(res.playerVel.x, res.playerVel.y);
      killerBody.updateCenter(); playerBody.updateCenter();
    }
  }

  public enforceWallBounds(navGrid: number[][]): void {
    if (!this.sprite?.body || navGrid.length === 0) return;
    const pRadius = (this.settings?.hitboxRadius ?? 53) * (this.settings?.playerScale ?? 1.25);
    const clampRes = clampCircleAgainstNavGrid(this.sprite.x, this.sprite.y, pRadius * 1.28, navGrid);
    if (clampRes.clamped) {
      this.sprite.setPosition(clampRes.x, clampRes.y);
      (this.sprite.body as Phaser.Physics.Arcade.Body).updateCenter();
    }
    this.lastSafeX = this.sprite.x; this.lastSafeY = this.sprite.y;
  }

  public updateNavGrid(navGrid: number[][], weightedGrid?: number[][]): void {
    this.navGrid = navGrid;
    this.weightedGrid = weightedGrid || buildAiWeightedGrid(navGrid);
  }

  public getNavGrid(): number[][] { return this.navGrid; }
  public getWeightedGrid(): number[][] { return this.weightedGrid; }
  public postUpdate(_delta: number, navGrid: number[][]): void { this.enforceWallBounds(navGrid); }

  private getAllSolids(): Phaser.GameObjects.Rectangle[] {
    return (this.walls.getChildren() as Phaser.GameObjects.Rectangle[]).concat(this.obstacles.getChildren() as Phaser.GameObjects.Rectangle[]);
  }

  public hasLineOfSight(x1: number, y1: number, x2: number, y2: number, clearance = 18): boolean {
    if (checkRaysIntersectSolids(x1, y1, x2, y2, clearance, this.getAllSolids())) return false;
    return !this.navGrid || this.navGrid.length === 0 || isRayClearOnNavGrid(x1, y1, x2, y2, this.navGrid, clearance, TILE_SIZE);
  }

  public hasClearanceLineOfSight(x1: number, y1: number, x2: number, y2: number, clearanceRadius = 45): boolean {
    if (checkRaysIntersectSolids(x1, y1, x2, y2, clearanceRadius, this.getAllSolids())) return false;
    return !this.navGrid || this.navGrid.length === 0 || hasClearanceLineOfSight(x1, y1, x2, y2, this.navGrid, clearanceRadius, TILE_SIZE, this.weightedGrid);
  }

  public calculatePath(fromX: number, fromY: number, toX: number, toY: number, onPathFound: (path: Array<{ x: number; y: number }>) => void): void {
    const sCol = Phaser.Math.Clamp(Math.floor(fromX / TILE_SIZE), 0, COLS - 1), sRow = Phaser.Math.Clamp(Math.floor(fromY / TILE_SIZE), 0, ROWS - 1);
    const eCol = Phaser.Math.Clamp(Math.floor(toX / TILE_SIZE), 0, COLS - 1), eRow = Phaser.Math.Clamp(Math.floor(toY / TILE_SIZE), 0, ROWS - 1);
    const safeStart = this.getNearestWalkableTile(sCol, sRow), safeEnd = this.getNearestWalkableTile(eCol, eRow);
    if (!safeStart || !safeEnd) return;

    this.easystar.findPath(safeStart.x, safeStart.y, safeEnd.x, safeEnd.y, (path) => {
      if (path && path.length > 0) {
        const mapped = path.map((p) => ({ x: p.x * TILE_SIZE + TILE_SIZE / 2, y: p.y * TILE_SIZE + TILE_SIZE / 2 }));
        const smoothed = smoothPathNodes(mapped, { x: toX, y: toY }, (x1, y1, x2, y2) => this.hasClearanceLineOfSight(x1, y1, x2, y2, 45), this.weightedGrid, TILE_SIZE);
        onPathFound(smoothed);
      }
    });
    this.easystar.calculate();
  }

  private getNearestWalkableTile(col: number, row: number): { x: number; y: number } | null {
    if (this.navGrid[row]?.[col] === 0) return { x: col, y: row };
    for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const c = col + dx, rw = row + dy;
          if (rw >= 0 && rw < ROWS && c >= 0 && c < COLS && this.navGrid[rw]?.[c] === 0) return { x: c, y: rw };
        }
      }
    }
    return null;
  }

  public renderVisionGraphic(s: DebugSettings, targetPos: { x: number; y: number }, isChase: boolean): void {
    this.debugRenderer.renderVision({ x: this.sprite.x, y: this.sprite.y }, s, targetPos, isChase);
  }

  public renderRouteGraphic(s: DebugSettings, path: Array<{ x: number; y: number }>, idx: number, isChase: boolean, directLOS: boolean, targetPos: { x: number; y: number }): void {
    this.debugRenderer.renderRoute({ x: this.sprite.x, y: this.sprite.y }, s, path, idx, isChase, directLOS, targetPos);
  }

  public destroy(): void { this.debugRenderer.destroy(); this.sprite.destroy(); }
  get x(): number { return this.sprite.x; }
  get y(): number { return this.sprite.y; }
  get rotation(): number { return this.sprite.rotation; }
}
