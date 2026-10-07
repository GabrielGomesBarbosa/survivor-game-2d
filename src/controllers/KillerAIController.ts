/**
 * @file KillerAIController.ts
 * @description Controlador de IA do Assassino (Killer).
 * Coordena detecção de jogadores, navegação tática e patrulha, delegando a máquina de estados para KillerFSM.
 */

import { DebugSettings } from '../config/constants';
import type { Player } from '../entities/Player';
import type { Generator } from '../entities/Generator';
import {
  GeneratorPatrolManager,
  MAJOR_FACILITY_ROOMS,
  getGeneratorStandOffPoint,
  isPlayerDetectableByKiller,
  evaluatePatrolArrival,
  shouldKillerKickGenerator,
  wrapAngle,
  metersToPixels
} from '../utils/gameLogic';
import { IKillerController } from './KillerController';
import { KillerFSM, AIState } from '../ai/KillerFSM';

export type { AIState };

export class Vector2D {
  public x: number;
  public y: number;
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }
}

function normalizeVec(dx: number, dy: number): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  return len === 0 ? { x: 0, y: 0 } : { x: dx / len, y: dy / len };
}

export interface IKillerPawn {
  x: number;
  y: number;
  rotation: number;
  setVelocity(vx: number, vy: number): void;
  stopMovement(): void;
  rotateTowards(targetAngle: number, delta: number, turnSpeed: number): void;
  playAnimation(key: string): void;
  stopAnimation(frame?: number): void;
  isWalkableTile(x: number, y: number): boolean;
  hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean;
  calculatePath(fromX: number, fromY: number, toX: number, toY: number, onPathFound: (path: Array<{ x: number; y: number }>) => void): void;
  renderVisionGraphic(settings: DebugSettings, targetPos: { x: number; y: number }, isChase: boolean): void;
  renderRouteGraphic(
    settings: DebugSettings,
    path: Array<{ x: number; y: number }>,
    pathIndex: number,
    isChase: boolean,
    hasDirectLOS: boolean,
    targetPos: { x: number; y: number }
  ): void;
  getNavGrid?(): number[][];
  getWeightedGrid?(): number[][];
  hasClearanceLineOfSight?(x1: number, y1: number, x2: number, y2: number, clearanceRadius?: number): boolean;
  performAttack?(target?: Player): boolean;
  isAttacking?: boolean;
  attackState?: string;
}

export class KillerAIController implements IKillerController {
  private pawn: IKillerPawn;
  public fsm: KillerFSM;
  public patrolManager: GeneratorPatrolManager;

  public patrolTarget: Vector2D;
  private currentPath: Array<{ x: number; y: number }> = [];
  private currentPathIndex = 0;
  private pathRecalcTimer = 0;
  private hasDirectLOS = false;
  private baseInspectAngle = 0;
  private lastKnownGenerators: Generator[] = [];

  // Watchdog Anti-Stuck
  private stuckSampleTimer = 0;
  private stuckDuration = 0;
  private lastSampleX = 0;
  private lastSampleY = 0;
  private hasInitializedSamplePos = false;

  constructor(pawn: IKillerPawn) {
    this.pawn = pawn;
    this.fsm = new KillerFSM('STANDBY');
    this.patrolManager = new GeneratorPatrolManager();
    this.patrolTarget = new Vector2D(pawn.x, pawn.y);
  }

  public get state(): AIState { return this.fsm.state; }
  public set state(s: AIState) { this.fsm.state = s; }
  public getState(): string { return this.fsm.state; }
  public get isKickingGenerator(): boolean { return this.fsm.isKicking; }
  public get stuckTimer(): number { return this.stuckDuration; }
  public get path(): Array<{ x: number; y: number }> { return this.currentPath; }
  public get pathIndex(): number { return this.currentPathIndex; }
  public get investigateTimer(): number { return this.fsm.investigateTimer; }
  public set investigateTimer(v: number) { this.fsm.investigateTimer = v; }
  public get isSniffingSound(): boolean { return this.fsm.isSniffingSound; }
  public set isSniffingSound(v: boolean) { this.fsm.isSniffingSound = v; }

  public setPathForTesting(path: Array<{ x: number; y: number }>, index = 0): void {
    this.currentPath = path;
    this.currentPathIndex = index;
  }

  public update(delta: number, player: Player, generators: Generator[], settings: DebugSettings): void {
    this.lastKnownGenerators = generators || [];
    const prevState = this.fsm.state;
    const currentState = this.fsm.evaluateGlobalState(settings.killerAiEnabled, generators ? generators.length : 0);

    if (currentState === 'DESATIVADO' || currentState === 'STANDBY') {
      this.currentPath = []; this.currentPathIndex = 0;
      this.pawn.stopMovement(); this.pawn.stopAnimation(0);
      this.pawn.renderVisionGraphic(settings, { x: this.pawn.x, y: this.pawn.y }, false);
      this.pawn.renderRouteGraphic(settings, [], 0, false, false, { x: this.pawn.x, y: this.pawn.y });
      return;
    }

    if (prevState === 'STANDBY' && currentState === 'PATROL') {
      this.advanceToNextPatrolGenerator(generators);
    }

    const isPlayerDetectable = isPlayerDetectableByKiller(
      settings.survivorActive ?? true,
      player ? player.isActive !== false : false,
      player && player.sprite ? player.sprite.visible : true
    );

    if (isPlayerDetectable) {
      const distToPlayer = Math.hypot(player.x - this.pawn.x, player.y - this.pawn.y);
      const detectionRadius = metersToPixels(settings.detectionRadius);
      const loseRadius = detectionRadius * 1.5;

      if (distToPlayer <= detectionRadius) {
        const hasLOS = this.pawn.hasLineOfSight(this.pawn.x, this.pawn.y, player.x, player.y);
        if ((hasLOS || distToPlayer <= 100) && this.state !== 'CHASE') {
          this.patrolManager.interruptInspection();
          this.fsm.startChase();
          this.currentPath = []; this.currentPathIndex = 0; this.pathRecalcTimer = 300;
        }
      } else if (this.state === 'CHASE' && distToPlayer > loseRadius) {
        this.fsm.loseChase();
        this.currentPath = []; this.currentPathIndex = 0;
        this.advanceToNextPatrolGenerator(generators);
      } else if (this.state === 'PATROL' && player?.noiseRadius && player.noiseRadius > 0) {
        if (distToPlayer <= metersToPixels(player.noiseRadius)) this.investigateSound(player.x, player.y);
      }
    } else if (this.state === 'CHASE' || this.state === 'INVESTIGATING_SOUND') {
      this.fsm.abortToPatrol();
      this.currentPath = []; this.currentPathIndex = 0;
      this.advanceToNextPatrolGenerator(generators);
    }

    this.handleWatchdogAntiStuck(delta, generators);

    if (this.state === 'CHASE' && isPlayerDetectable) {
      this.handleChaseState(delta, player, Math.hypot(player.x - this.pawn.x, player.y - this.pawn.y), settings);
    } else if (this.state === 'INSPECTING') {
      this.handleInspectingState(delta, generators);
    } else if (this.state === 'INVESTIGATING_SOUND') {
      this.handleInvestigatingSoundState(delta, player, generators, settings);
    } else {
      this.handlePatrolState(delta, generators, settings);
    }

    const isChasing = this.state === 'CHASE' && isPlayerDetectable;
    const targetPos = isChasing ? { x: player.x, y: player.y } : { x: this.patrolTarget.x, y: this.patrolTarget.y };
    this.pawn.renderVisionGraphic(settings, targetPos, isChasing);
    this.pawn.renderRouteGraphic(settings, this.currentPath, this.currentPathIndex, isChasing, this.hasDirectLOS, targetPos);
  }

  private followPath(delta: number, speed: number, animKey: string, turnSpeed: number): void {
    if (this.currentPath.length === 0) return;
    let targetNode = this.currentPath[this.currentPathIndex];
    let distToNode = Math.hypot(targetNode.x - this.pawn.x, targetNode.y - this.pawn.y);

    if (distToNode <= 24 && this.currentPathIndex < this.currentPath.length - 1) {
      this.currentPathIndex++;
      targetNode = this.currentPath[this.currentPathIndex];
      distToNode = Math.hypot(targetNode.x - this.pawn.x, targetNode.y - this.pawn.y);
    }

    if (this.currentPathIndex + 1 < this.currentPath.length) {
      const nextNode = this.currentPath[this.currentPathIndex + 1];
      const hasClearLOS = this.pawn.hasClearanceLineOfSight
        ? this.pawn.hasClearanceLineOfSight(this.pawn.x, this.pawn.y, nextNode.x, nextNode.y, 45)
        : this.pawn.hasLineOfSight(this.pawn.x, this.pawn.y, nextNode.x, nextNode.y);
      if (hasClearLOS && distToNode <= 36) {
        this.currentPathIndex++;
        targetNode = this.currentPath[this.currentPathIndex];
        distToNode = Math.hypot(targetNode.x - this.pawn.x, targetNode.y - this.pawn.y);
      }
    }

    const vCurr = normalizeVec(targetNode.x - this.pawn.x, targetNode.y - this.pawn.y);
    let moveVec = vCurr;
    if (this.currentPathIndex < this.currentPath.length - 1 && distToNode < 36) {
      const nextNode = this.currentPath[this.currentPathIndex + 1];
      const vNext = normalizeVec(nextNode.x - this.pawn.x, nextNode.y - this.pawn.y);
      const blend = Math.min(1, Math.max(0, (36 - distToNode) / 36)) * 0.5;
      moveVec = normalizeVec(vCurr.x * (1 - blend) + vNext.x * blend, vCurr.y * (1 - blend) + vNext.y * blend);
    }

    this.pawn.setVelocity(moveVec.x * speed, moveVec.y * speed);
    this.pawn.playAnimation(animKey);
    const targetAngle = wrapAngle(Math.atan2(moveVec.y, moveVec.x) - Math.PI / 2);
    this.pawn.rotateTowards(targetAngle, delta, turnSpeed);
  }

  private handleChaseState(delta: number, player: Player, distToPlayer: number, settings: DebugSettings): void {
    if (this.pawn.isAttacking) return;
    const speed = metersToPixels(settings.killerSpeed);
    const minBodyDist = settings.hitboxRadius * settings.playerScale * 2.28;
    this.hasDirectLOS = this.pawn.hasLineOfSight(this.pawn.x, this.pawn.y, player.x, player.y);

    if (distToPlayer <= metersToPixels(1.8) && this.hasDirectLOS && this.pawn.performAttack && !this.pawn.isAttacking) {
      if (this.pawn.performAttack(player)) return;
    }

    if (distToPlayer <= minBodyDist) {
      this.pawn.stopMovement(); this.pawn.stopAnimation(0);
      const targetAngle = wrapAngle(Math.atan2(player.y - this.pawn.y, player.x - this.pawn.x) - Math.PI / 2);
      this.pawn.rotateTowards(targetAngle, delta, 14);
      return;
    }

    if (this.hasDirectLOS) {
      this.currentPath = [];
      const moveVec = normalizeVec(player.x - this.pawn.x, player.y - this.pawn.y);
      this.pawn.setVelocity(moveVec.x * speed, moveVec.y * speed);
      this.pawn.playAnimation('run');
      this.pawn.rotateTowards(wrapAngle(Math.atan2(player.y - this.pawn.y, player.x - this.pawn.x) - Math.PI / 2), delta, 14);
    } else {
      this.pathRecalcTimer += delta;
      if (this.pathRecalcTimer >= 250 || this.currentPath.length === 0) {
        this.pathRecalcTimer = 0;
        this.pawn.calculatePath(this.pawn.x, this.pawn.y, player.x, player.y, (path) => {
          this.currentPath = path;
          this.currentPathIndex = path.length > 1 ? 1 : 0;
        });
      }
      if (this.currentPath.length > 0) {
        this.followPath(delta, speed, 'run', 12);
      } else {
        const moveVec = normalizeVec(player.x - this.pawn.x, player.y - this.pawn.y);
        this.pawn.setVelocity(moveVec.x * speed, moveVec.y * speed);
      }
    }
  }

  private handleInspectingState(delta: number, generators: Generator[]): void {
    this.pawn.stopMovement();
    this.pawn.stopAnimation(0);
    if (this.fsm.isKicking) {
      if (this.fsm.tickKick(delta)) this.advanceToNextPatrolGenerator(generators);
      else this.pawn.rotateTowards(this.baseInspectAngle, delta, 12);
      return;
    }

    const { isComplete, lookOffset } = this.patrolManager.tickInspection(delta);
    this.pawn.rotateTowards(this.baseInspectAngle + lookOffset, delta, 4);
    if (isComplete) {
      this.fsm.completeInspection();
      this.advanceToNextPatrolGenerator(generators);
    }
  }

  private handlePatrolState(delta: number, generators: Generator[], settings: DebugSettings): void {
    if (!this.patrolManager.currentDestination) {
      this.advanceToNextPatrolGenerator(generators);
      return;
    }
    const distToTarget = Math.hypot(this.patrolTarget.x - this.pawn.x, this.patrolTarget.y - this.pawn.y);
    const dest = this.patrolManager.currentDestination;
    const isTargetingGen = Boolean(dest && dest.type === 'generator');
    const distToGen = (isTargetingGen && dest) ? Math.hypot(dest.x - this.pawn.x, dest.y - this.pawn.y) : distToTarget;

    if (evaluatePatrolArrival(distToTarget, isTargetingGen, distToGen)) {
      this.pawn.stopMovement(); this.pawn.stopAnimation(0);
      this.baseInspectAngle = (isTargetingGen && dest)
        ? wrapAngle(Math.atan2(dest.y - this.pawn.y, dest.x - this.pawn.x) - Math.PI / 2)
        : this.pawn.rotation;
      this.currentPath = [];

      const targetGen = (isTargetingGen && dest)
        ? generators.find((g) => g.name === dest.name || Math.hypot(g.x - dest.x, g.y - dest.y) <= 130)
        : undefined;

      if (targetGen && shouldKillerKickGenerator(targetGen)) {
        this.fsm.startInspecting(true, 1500);
        targetGen.kickGenerator();
        this.patrolManager.startInspection(1500);
      } else {
        this.fsm.startInspecting(false);
        this.patrolManager.startInspection((settings.inspectionTime ?? 2.5) * 1000);
      }
      return;
    }

    const speed = metersToPixels(settings.killerSpeed);
    const canWalkDirectly = this.pawn.hasClearanceLineOfSight
      ? this.pawn.hasClearanceLineOfSight(this.pawn.x, this.pawn.y, this.patrolTarget.x, this.patrolTarget.y, 45)
      : this.pawn.hasLineOfSight(this.pawn.x, this.pawn.y, this.patrolTarget.x, this.patrolTarget.y);

    if (canWalkDirectly) {
      this.currentPath = [];
      const moveVec = normalizeVec(this.patrolTarget.x - this.pawn.x, this.patrolTarget.y - this.pawn.y);
      this.pawn.setVelocity(moveVec.x * speed, moveVec.y * speed);
      this.pawn.playAnimation('walk');
      this.pawn.rotateTowards(wrapAngle(Math.atan2(moveVec.y, moveVec.x) - Math.PI / 2), delta, 5);
    } else if (this.currentPath.length > 0) {
      this.followPath(delta, speed, 'walk', 6);
    } else {
      this.pawn.calculatePath(this.pawn.x, this.pawn.y, this.patrolTarget.x, this.patrolTarget.y, (path) => {
        this.currentPath = path; this.currentPathIndex = path.length > 1 ? 1 : 0;
      });
    }
  }

  public advanceToNextPatrolGenerator(generators: Generator[]): void {
    if (!generators || generators.length === 0) {
      this.fsm.transitionTo('STANDBY');
      this.currentPath = []; this.currentPathIndex = 0;
      return;
    }
    const candidateGens = generators.map((g) => ({ name: g.name, x: g.x, y: g.y, progress: g.progress, isCompleted: g.isCompleted }));
    const nextDest = this.patrolManager.getNextDestination(candidateGens, MAJOR_FACILITY_ROOMS);
    if (nextDest) {
      if (nextDest.type === 'generator') {
        const matchingGen = generators.find((g) => g.name === nextDest.name);
        const standOff = getGeneratorStandOffPoint(
          { x: nextDest.x, y: nextDest.y, rotation: matchingGen?.rotation ?? 0 },
          { x: this.pawn.x, y: this.pawn.y },
          (wx, wy) => this.pawn.isWalkableTile(wx, wy),
          112,
          this.pawn.getNavGrid ? this.pawn.getNavGrid() : undefined
        );
        this.patrolTarget.set(standOff.x, standOff.y);
      } else {
        this.patrolTarget.set(nextDest.x, nextDest.y);
      }
    }
    this.currentPath = []; this.currentPathIndex = 0;
    this.pawn.calculatePath(this.pawn.x, this.pawn.y, this.patrolTarget.x, this.patrolTarget.y, (path) => {
      this.currentPath = path; this.currentPathIndex = path.length > 1 ? 1 : 0;
    });
  }

  private handleInvestigatingSoundState(delta: number, _player: Player, generators: Generator[], settings: DebugSettings): void {
    if (this.fsm.isSniffingSound) {
      this.pawn.stopMovement(); this.pawn.stopAnimation(0);
      const { isComplete, sweepAngle } = this.fsm.tickSniffing(delta);
      this.pawn.rotateTowards(this.baseInspectAngle + sweepAngle, delta, 3);
      if (isComplete) this.advanceToNextPatrolGenerator(generators);
      return;
    }

    const distToTarget = Math.hypot(this.patrolTarget.x - this.pawn.x, this.patrolTarget.y - this.pawn.y);
    if (distToTarget <= 36) {
      this.pawn.stopMovement(); this.pawn.stopAnimation(0);
      this.fsm.startSniffing(2000);
      this.baseInspectAngle = this.pawn.rotation;
      this.currentPath = [];
      return;
    }

    const speed = metersToPixels(settings.killerSpeed);
    const canWalkDirectly = this.pawn.hasClearanceLineOfSight
      ? this.pawn.hasClearanceLineOfSight(this.pawn.x, this.pawn.y, this.patrolTarget.x, this.patrolTarget.y, 45)
      : this.pawn.hasLineOfSight(this.pawn.x, this.pawn.y, this.patrolTarget.x, this.patrolTarget.y);

    if (canWalkDirectly) {
      this.currentPath = [];
      const moveVec = normalizeVec(this.patrolTarget.x - this.pawn.x, this.patrolTarget.y - this.pawn.y);
      this.pawn.setVelocity(moveVec.x * speed, moveVec.y * speed);
      this.pawn.playAnimation('walk');
      this.pawn.rotateTowards(wrapAngle(Math.atan2(moveVec.y, moveVec.x) - Math.PI / 2), delta, 5);
    } else if (this.currentPath.length > 0) {
      this.followPath(delta, speed, 'walk', 6);
      const node = this.currentPath[this.currentPathIndex];
      if (this.currentPathIndex === this.currentPath.length - 1 && node && Math.hypot(node.x - this.pawn.x, node.y - this.pawn.y) <= 28) {
        this.pawn.stopMovement(); this.pawn.stopAnimation(0);
        this.fsm.startSniffing(2000);
        this.baseInspectAngle = this.pawn.rotation;
        this.currentPath = [];
      }
    } else {
      this.pawn.calculatePath(this.pawn.x, this.pawn.y, this.patrolTarget.x, this.patrolTarget.y, (path) => {
        this.currentPath = path; this.currentPathIndex = path.length > 1 ? 1 : 0;
      });
    }
  }

  public investigateSound(x: number, y: number): void {
    if (!this.fsm.canInvestigateSound()) return;
    this.patrolManager.interruptInspection();
    this.fsm.startInvestigatingSound();
    this.patrolTarget.set(x, y);
    this.currentPath = []; this.currentPathIndex = 0;
    this.stuckSampleTimer = 0; this.stuckDuration = 0;
    this.lastSampleX = this.pawn.x; this.lastSampleY = this.pawn.y;
    this.hasInitializedSamplePos = true;
    this.pawn.calculatePath(this.pawn.x, this.pawn.y, this.patrolTarget.x, this.patrolTarget.y, (path) => {
      this.currentPath = path; this.currentPathIndex = path.length > 1 ? 1 : 0;
    });
  }

  public alertToNoise(x: number, y: number, targetGen?: Generator | { name: string; x: number; y: number; rotation?: number }): void {
    if (!this.fsm.canAlertNoise()) return;
    this.patrolManager.interruptInspection();
    this.fsm.state = 'PATROL';

    const gen = targetGen || this.lastKnownGenerators.find((g) => Math.hypot(g.x - x, g.y - y) <= 130);
    if (gen) {
      const standOff = getGeneratorStandOffPoint(
        { x: gen.x, y: gen.y, rotation: gen.rotation ?? 0 },
        { x: this.pawn.x, y: this.pawn.y },
        (wx, wy) => this.pawn.isWalkableTile(wx, wy),
        112,
        this.pawn.getNavGrid ? this.pawn.getNavGrid() : undefined
      );
      this.patrolTarget.set(standOff.x, standOff.y);
      this.patrolManager.registerAlertDestination(gen);
    } else {
      this.patrolTarget.set(x, y);
      this.patrolManager.registerAlertDestination({ name: 'Ruído Detectado', x, y });
    }

    this.currentPath = []; this.currentPathIndex = 0;
    this.stuckSampleTimer = 0; this.stuckDuration = 0;
    this.lastSampleX = this.pawn.x; this.lastSampleY = this.pawn.y;
    this.hasInitializedSamplePos = true;
    this.pawn.calculatePath(this.pawn.x, this.pawn.y, this.patrolTarget.x, this.patrolTarget.y, (path) => {
      this.currentPath = path; this.currentPathIndex = path.length > 1 ? 1 : 0;
    });
  }

  public handleWatchdogAntiStuck(delta: number, generators: Generator[]): void {
    if (!this.fsm.isMovingState(Boolean(this.pawn.isAttacking))) {
      this.stuckSampleTimer = 0; this.stuckDuration = 0;
      this.lastSampleX = this.pawn.x; this.lastSampleY = this.pawn.y;
      this.hasInitializedSamplePos = true;
      return;
    }

    if (!this.hasInitializedSamplePos) {
      this.lastSampleX = this.pawn.x; this.lastSampleY = this.pawn.y;
      this.hasInitializedSamplePos = true;
      return;
    }

    this.stuckSampleTimer += delta;
    if (this.stuckSampleTimer >= 300) {
      if (Math.hypot(this.pawn.x - this.lastSampleX, this.pawn.y - this.lastSampleY) < 8) {
        this.stuckDuration += this.stuckSampleTimer;

        if (this.stuckDuration >= 400 && this.stuckDuration < 800) {
          if (this.currentPath.length > 0 && this.currentPathIndex < this.currentPath.length - 1) this.currentPathIndex++;
          let angle = this.pawn.rotation + Math.PI / 2;
          if (this.currentPath.length > 0 && this.currentPath[this.currentPathIndex]) {
            const target = this.currentPath[this.currentPathIndex];
            angle = Math.atan2(target.y - this.pawn.y, target.x - this.pawn.x);
          }
          this.pawn.setVelocity(-Math.sin(angle) * 75, Math.cos(angle) * 75);
        }

        if (this.stuckDuration >= 800) {
          this.currentPath = []; this.currentPathIndex = 0; this.stuckDuration = 0;
          if (this.state === 'PATROL' || this.state === 'INVESTIGATING_SOUND') this.advanceToNextPatrolGenerator(generators);
          else if (this.state === 'CHASE') this.pathRecalcTimer = 300;
        }
      } else {
        this.stuckDuration = 0;
      }
      this.stuckSampleTimer = 0;
      this.lastSampleX = this.pawn.x; this.lastSampleY = this.pawn.y;
    }
  }
}
