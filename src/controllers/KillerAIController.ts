/**
 * @file KillerAIController.ts
 * @description Controlador de Inteligência Artificial do Assassino (Killer).
 * Gerencia a Máquina de Estados Finitos (PATROL, INSPECTING, CHASE), ciclo orgânico
 * de ronda entre geradores incompletos com pausa de inspeção e detecção prioritária do jogador.
 */

import Phaser from 'phaser';
import { DebugSettings } from '../config/constants';
import { Player } from '../entities/Player';
import { Generator } from '../entities/Generator';
import { GeneratorPatrolManager, PatrolTarget, MAJOR_FACILITY_ROOMS, getGeneratorStandOffPoint, evaluateKillerAiState, isPlayerDetectableByKiller, evaluatePatrolArrival } from '../utils/gameLogic';
import { IKillerController } from './KillerController';

export type AIState = 'PATROL' | 'INSPECTING' | 'CHASE' | 'DESATIVADO' | 'STANDBY';

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
}

export class KillerAIController implements IKillerController {
  private pawn: IKillerPawn;
  public state: AIState = 'STANDBY';
  public patrolManager: GeneratorPatrolManager;

  // Alvo e caminhos
  public patrolTarget: Phaser.Math.Vector2;
  private currentPath: Array<{ x: number; y: number }> = [];
  private currentPathIndex = 0;
  private pathRecalcTimer = 0;
  private hasDirectLOS = false;
  private baseInspectAngle = 0;
  private lastKnownGenerators: Generator[] = [];

  constructor(pawn: IKillerPawn) {
    this.pawn = pawn;
    this.patrolManager = new GeneratorPatrolManager();
    this.patrolTarget = new Phaser.Math.Vector2(pawn.x, pawn.y);
  }

  public getState(): string {
    return this.state;
  }

  /**
   * Atualização principal de IA por frame.
   */
  public update(delta: number, player: Player, generators: Generator[], settings: DebugSettings): void {
    this.lastKnownGenerators = generators || [];
    if (!settings.killerAiEnabled) {
      this.state = 'DESATIVADO';
      this.pawn.stopMovement();
      this.pawn.stopAnimation(0);
      this.pawn.renderVisionGraphic(settings, { x: this.pawn.x, y: this.pawn.y }, false);
      this.pawn.renderRouteGraphic(settings, [], 0, false, false, { x: this.pawn.x, y: this.pawn.y });
      return;
    }

    const genCount = generators ? generators.length : 0;
    if (genCount === 0) {
      this.state = 'STANDBY';
      this.currentPath = [];
      this.currentPathIndex = 0;
      this.pawn.stopMovement();
      this.pawn.stopAnimation(0);
      this.pawn.renderVisionGraphic(settings, { x: this.pawn.x, y: this.pawn.y }, false);
      this.pawn.renderRouteGraphic(settings, [], 0, false, false, { x: this.pawn.x, y: this.pawn.y });
      return;
    }

    const prevState = this.state;
    this.state = evaluateKillerAiState(this.state, settings.killerAiEnabled, genCount) as AIState;
    if (prevState === 'STANDBY' && this.state === 'PATROL') {
      this.advanceToNextPatrolGenerator(generators);
    }

    const isPlayerDetectable = isPlayerDetectableByKiller(
      settings.survivorActive ?? true,
      player ? player.isActive !== false : false,
      player && player.sprite ? player.sprite.visible : true
    );

    if (isPlayerDetectable) {
      const distToPlayer = Phaser.Math.Distance.Between(this.pawn.x, this.pawn.y, player.x, player.y);
      const detectionRadius = settings.detectionRadius;
      const loseRadius = detectionRadius * 1.5;

      // 1. Prioridade Absoluta: Detecção do Jogador -> Transição para CHASE
      if (distToPlayer <= detectionRadius) {
        const hasLOS = this.pawn.hasLineOfSight(this.pawn.x, this.pawn.y, player.x, player.y);
        if (hasLOS || distToPlayer <= 100) {
          if (this.state !== 'CHASE') {
            this.patrolManager.interruptInspection();
            this.state = 'CHASE';
            this.currentPath = [];
            this.currentPathIndex = 0;
            this.pathRecalcTimer = 300;
          }
        }
      } else if (this.state === 'CHASE' && distToPlayer > loseRadius) {
        // Perdeu o rastro do jogador -> Volta para PATROL no próximo gerador
        this.state = 'PATROL';
        this.currentPath = [];
        this.currentPathIndex = 0;
        this.advanceToNextPatrolGenerator(generators);
      }
    } else {
      // Se o survivor foi desativado enquanto estava em perseguição, aborta perseguição e retoma patrulha
      if (this.state === 'CHASE') {
        this.state = 'PATROL';
        this.currentPath = [];
        this.currentPathIndex = 0;
        this.advanceToNextPatrolGenerator(generators);
      }
    }

    // 2. Execução dos estados da FSM
    if (this.state === 'CHASE' && isPlayerDetectable) {
      const distToPlayer = Phaser.Math.Distance.Between(this.pawn.x, this.pawn.y, player.x, player.y);
      this.handleChaseState(delta, player, distToPlayer, settings);
    } else if (this.state === 'INSPECTING') {
      this.handleInspectingState(delta, generators);
    } else {
      this.handlePatrolState(delta, generators, settings);
    }

    // 3. Renderização de depuração
    const isChasing = this.state === 'CHASE' && isPlayerDetectable;
    this.pawn.renderVisionGraphic(
      settings,
      isChasing ? { x: player.x, y: player.y } : { x: this.patrolTarget.x, y: this.patrolTarget.y },
      isChasing
    );
    this.pawn.renderRouteGraphic(
      settings,
      this.currentPath,
      this.currentPathIndex,
      isChasing,
      this.hasDirectLOS,
      isChasing ? { x: player.x, y: player.y } : { x: this.patrolTarget.x, y: this.patrolTarget.y }
    );
  }

  /**
   * Estado CHASE: perseguição direta ou contorno via A*.
   */
  private handleChaseState(delta: number, player: Player, distToPlayer: number, settings: DebugSettings): void {
    const speed = settings.killerSpeed;
    const minBodyDist = settings.hitboxRadius * settings.playerScale * 2.28;

    if (distToPlayer <= minBodyDist) {
      this.pawn.stopMovement();
      this.pawn.stopAnimation(0);
      const dx = player.x - this.pawn.x;
      const dy = player.y - this.pawn.y;
      const targetAngle = Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - Math.PI / 2);
      this.pawn.rotateTowards(targetAngle, delta, 14);
      return;
    }

    this.hasDirectLOS = this.pawn.hasLineOfSight(this.pawn.x, this.pawn.y, player.x, player.y);

    if (this.hasDirectLOS) {
      this.currentPath = [];
      const dx = player.x - this.pawn.x;
      const dy = player.y - this.pawn.y;
      const moveVec = new Phaser.Math.Vector2(dx, dy).normalize();

      this.pawn.setVelocity(moveVec.x * speed, moveVec.y * speed);
      this.pawn.playAnimation('run');

      const targetAngle = Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - Math.PI / 2);
      this.pawn.rotateTowards(targetAngle, delta, 14);
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
        const targetNode = this.currentPath[this.currentPathIndex];
        const distToNode = Phaser.Math.Distance.Between(this.pawn.x, this.pawn.y, targetNode.x, targetNode.y);

        if (distToNode < 36 && this.currentPathIndex < this.currentPath.length - 1) {
          this.currentPathIndex++;
        }

        if (this.currentPathIndex + 1 < this.currentPath.length) {
          const nextNode = this.currentPath[this.currentPathIndex + 1];
          if (this.pawn.hasLineOfSight(this.pawn.x, this.pawn.y, nextNode.x, nextNode.y)) {
            this.currentPathIndex++;
          }
        }

        const activeNode = this.currentPath[this.currentPathIndex];
        const dx = activeNode.x - this.pawn.x;
        const dy = activeNode.y - this.pawn.y;
        const moveVec = new Phaser.Math.Vector2(dx, dy).normalize();

        this.pawn.setVelocity(moveVec.x * speed, moveVec.y * speed);
        this.pawn.playAnimation('run');

        const targetAngle = Phaser.Math.Angle.Wrap(Math.atan2(moveVec.y, moveVec.x) - Math.PI / 2);
        this.pawn.rotateTowards(targetAngle, delta, 12);
      } else {
        const dx = player.x - this.pawn.x;
        const dy = player.y - this.pawn.y;
        const moveVec = new Phaser.Math.Vector2(dx, dy).normalize();
        this.pawn.setVelocity(moveVec.x * speed * 0.5, moveVec.y * speed * 0.5);
      }
    }
  }

  /**
   * Estado INSPECTING: pausa de 2.5s no gerador olhando ao redor da sala.
   */
  private handleInspectingState(delta: number, generators: Generator[]): void {
    this.pawn.stopMovement();
    this.pawn.stopAnimation(0);

    const { isComplete, lookOffset } = this.patrolManager.tickInspection(delta);
    this.pawn.rotateTowards(this.baseInspectAngle + lookOffset, delta, 4);

    if (isComplete) {
      // Concluiu inspeção -> avança ciclicamente para o próximo gerador
      this.state = 'PATROL';
      this.advanceToNextPatrolGenerator(generators);
    }
  }

  /**
   * Estado PATROL: navega em direção ao gerador ou sala alvo.
   */
  private handlePatrolState(delta: number, generators: Generator[], settings: DebugSettings): void {
    if (!this.patrolManager.currentDestination) {
      this.advanceToNextPatrolGenerator(generators);
      return;
    }

    const distToTarget = Phaser.Math.Distance.Between(this.pawn.x, this.pawn.y, this.patrolTarget.x, this.patrolTarget.y);
    const isTargetingGenerator = Boolean(
      this.patrolManager.currentDestination && this.patrolManager.currentDestination.type === 'generator'
    );
    const currentDest = this.patrolManager.currentDestination;
    const distToGen = (isTargetingGenerator && currentDest)
      ? Phaser.Math.Distance.Between(this.pawn.x, this.pawn.y, currentDest.x, currentDest.y)
      : distToTarget;

    // Chegou ao ponto frontal do gerador (stand-off) ou ao centro do cômodo
    const hasArrived = evaluatePatrolArrival(distToTarget, isTargetingGenerator, distToGen);

    if (hasArrived) {
      this.pawn.stopMovement();
      this.pawn.stopAnimation(0);

      // Inicia inspeção com tempo configurável (inspectionTime, padrão: 2.5s)
      this.state = 'INSPECTING';
      if (isTargetingGenerator && currentDest) {
        this.baseInspectAngle = Phaser.Math.Angle.Wrap(Math.atan2(currentDest.y - this.pawn.y, currentDest.x - this.pawn.x) - Math.PI / 2);
      } else {
        this.baseInspectAngle = this.pawn.rotation;
      }
      const inspectMs = (settings.inspectionTime ?? 2.5) * 1000;
      this.patrolManager.startInspection(inspectMs);
      this.currentPath = [];
      return;
    }

    const patrolSpeed = settings.killerSpeed * 0.45;

    // Se houver linha direta de visão até a área segura do gerador, caminhar direto
    if (this.pawn.hasLineOfSight(this.pawn.x, this.pawn.y, this.patrolTarget.x, this.patrolTarget.y)) {
      this.currentPath = [];
      const dx = this.patrolTarget.x - this.pawn.x;
      const dy = this.patrolTarget.y - this.pawn.y;
      const moveVec = new Phaser.Math.Vector2(dx, dy).normalize();

      this.pawn.setVelocity(moveVec.x * patrolSpeed, moveVec.y * patrolSpeed);
      this.pawn.playAnimation('walk');

      const targetAngle = Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - Math.PI / 2);
      this.pawn.rotateTowards(targetAngle, delta, 5);
    } else {
      if (this.currentPath.length > 0) {
        const targetNode = this.currentPath[this.currentPathIndex];
        const distToNode = Phaser.Math.Distance.Between(this.pawn.x, this.pawn.y, targetNode.x, targetNode.y);

        if (distToNode < 36 && this.currentPathIndex < this.currentPath.length - 1) {
          this.currentPathIndex++;
        }

        const activeNode = this.currentPath[this.currentPathIndex];
        const dx = activeNode.x - this.pawn.x;
        const dy = activeNode.y - this.pawn.y;
        const moveVec = new Phaser.Math.Vector2(dx, dy).normalize();

        this.pawn.setVelocity(moveVec.x * patrolSpeed, moveVec.y * patrolSpeed);
        this.pawn.playAnimation('walk');

        const targetAngle = Phaser.Math.Angle.Wrap(Math.atan2(moveVec.y, moveVec.x) - Math.PI / 2);
        this.pawn.rotateTowards(targetAngle, delta, 6);
      } else {
        this.pawn.calculatePath(this.pawn.x, this.pawn.y, this.patrolTarget.x, this.patrolTarget.y, (path) => {
          this.currentPath = path;
          this.currentPathIndex = path.length > 1 ? 1 : 0;
        });
      }
    }
  }

  /**
   * Seleciona o próximo gerador da fila de patrulha e calcula rota A*.
   */
  public advanceToNextPatrolGenerator(generators: Generator[]): void {
    if (!generators || generators.length === 0) {
      this.state = 'STANDBY';
      this.currentPath = [];
      this.currentPathIndex = 0;
      return;
    }

    const candidateGens = (generators || []).map((g) => ({
      name: g.name,
      x: g.x,
      y: g.y,
      progress: g.progress,
      isCompleted: g.isCompleted
    }));

    const nextDest = this.patrolManager.getNextDestination(candidateGens, MAJOR_FACILITY_ROOMS);
    if (nextDest) {
      if (nextDest.type === 'generator') {
        const matchingGen = generators.find((g) => g.name === nextDest.name);
        const navGrid = this.pawn.getNavGrid ? this.pawn.getNavGrid() : undefined;
        const standOff = getGeneratorStandOffPoint(
          { x: nextDest.x, y: nextDest.y, rotation: matchingGen?.rotation ?? 0 },
          { x: this.pawn.x, y: this.pawn.y },
          (wx, wy) => this.pawn.isWalkableTile(wx, wy),
          112,
          navGrid
        );
        this.patrolTarget.set(standOff.x, standOff.y);
      } else {
        this.patrolTarget.set(nextDest.x, nextDest.y);
      }
    }

    this.currentPath = [];
    this.currentPathIndex = 0;
    this.pawn.calculatePath(this.pawn.x, this.pawn.y, this.patrolTarget.x, this.patrolTarget.y, (path) => {
      this.currentPath = path;
      this.currentPathIndex = path.length > 1 ? 1 : 0;
    });
  }

  /**
   * Alerta imediato de ruído (falha de Skill Check em gerador).
   */
  public alertToNoise(
    x: number,
    y: number,
    targetGen?: Generator | { name: string; x: number; y: number; rotation?: number }
  ): void {
    if (this.state === 'DESATIVADO' || this.state === 'STANDBY') return;
    this.patrolManager.interruptInspection();
    this.state = 'PATROL';

    const gen =
      targetGen ||
      this.lastKnownGenerators.find((g) => Math.hypot(g.x - x, g.y - y) <= 130);

    if (gen) {
      const navGrid = this.pawn.getNavGrid ? this.pawn.getNavGrid() : undefined;
      const standOff = getGeneratorStandOffPoint(
        { x: gen.x, y: gen.y, rotation: gen.rotation ?? 0 },
        { x: this.pawn.x, y: this.pawn.y },
        (wx, wy) => this.pawn.isWalkableTile(wx, wy),
        112,
        navGrid
      );
      this.patrolTarget.set(standOff.x, standOff.y);
      this.patrolManager.registerAlertDestination(gen);
    } else {
      this.patrolTarget.set(x, y);
      this.patrolManager.registerAlertDestination({ name: 'Ruído Detectado', x, y });
    }

    this.currentPath = [];
    this.currentPathIndex = 0;
    this.pawn.calculatePath(this.pawn.x, this.pawn.y, this.patrolTarget.x, this.patrolTarget.y, (path) => {
      this.currentPath = path;
      this.currentPathIndex = path.length > 1 ? 1 : 0;
    });
  }
}
