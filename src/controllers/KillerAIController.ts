/**
 * @file KillerAIController.ts
 * @description Controlador de Inteligência Artificial do Assassino (Killer).
 * Gerencia a Máquina de Estados Finitos (PATROL, INSPECTING, CHASE), ciclo orgânico
 * de ronda entre geradores incompletos com pausa de inspeção e detecção prioritária do jogador.
 */

import { DebugSettings } from '../config/constants';
import type { Player } from '../entities/Player';
import type { Generator } from '../entities/Generator';
import {
  GeneratorPatrolManager,
  PatrolTarget,
  MAJOR_FACILITY_ROOMS,
  getGeneratorStandOffPoint,
  evaluateKillerAiState,
  isPlayerDetectableByKiller,
  evaluatePatrolArrival,
  shouldKillerKickGenerator,
  wrapAngle,
  metersToPixels
} from '../utils/gameLogic';
import { IKillerController } from './KillerController';

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
  if (len === 0) return { x: 0, y: 0 };
  return { x: dx / len, y: dy / len };
}

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
  performAttack?(target?: Player): boolean;
  isAttacking?: boolean;
  attackState?: string;
}

export class KillerAIController implements IKillerController {
  private pawn: IKillerPawn;
  public state: AIState = 'STANDBY';
  public patrolManager: GeneratorPatrolManager;

  // Alvo e caminhos
  public patrolTarget: Vector2D;
  private currentPath: Array<{ x: number; y: number }> = [];
  private currentPathIndex = 0;
  private pathRecalcTimer = 0;
  private hasDirectLOS = false;
  private baseInspectAngle = 0;
  private lastKnownGenerators: Generator[] = [];
  private isKicking = false;
  private kickTimer = 0;

  // Watchdog Anti-Stuck
  private stuckSampleTimer = 0;
  private stuckDuration = 0;
  private lastSampleX = 0;
  private lastSampleY = 0;
  private hasInitializedSamplePos = false;

  constructor(pawn: IKillerPawn) {
    this.pawn = pawn;
    this.patrolManager = new GeneratorPatrolManager();
    this.patrolTarget = new Vector2D(pawn.x, pawn.y);
  }

  public getState(): string {
    return this.state;
  }

  public get isKickingGenerator(): boolean {
    return this.isKicking;
  }

  public get stuckTimer(): number {
    return this.stuckDuration;
  }

  public get path(): Array<{ x: number; y: number }> {
    return this.currentPath;
  }

  public get pathIndex(): number {
    return this.currentPathIndex;
  }

  public setPathForTesting(path: Array<{ x: number; y: number }>, index: number = 0): void {
    this.currentPath = path;
    this.currentPathIndex = index;
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
      const distToPlayer = Math.hypot(player.x - this.pawn.x, player.y - this.pawn.y);
      const detectionRadius = metersToPixels(settings.detectionRadius);
      const loseRadius = detectionRadius * 1.5;

      // 1. Prioridade Absoluta: Detecção do Jogador -> Transição para CHASE
      if (distToPlayer <= detectionRadius) {
        const hasLOS = this.pawn.hasLineOfSight(this.pawn.x, this.pawn.y, player.x, player.y);
        if (hasLOS || distToPlayer <= 100) {
          if (this.state !== 'CHASE') {
            this.patrolManager.interruptInspection();
            this.isKicking = false;
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
    this.handleWatchdogAntiStuck(delta, generators);

    if (this.state === 'CHASE' && isPlayerDetectable) {
      const distToPlayer = Math.hypot(player.x - this.pawn.x, player.y - this.pawn.y);
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
    if (this.pawn.isAttacking) {
      return;
    }

    const speed = metersToPixels(settings.killerSpeed);
    const minBodyDist = settings.hitboxRadius * settings.playerScale * 2.28;

    this.hasDirectLOS = this.pawn.hasLineOfSight(this.pawn.x, this.pawn.y, player.x, player.y);

    // Gatilho de Ataque M1 da IA:
    // No estado CHASE: quando a distância euclidiana for <= 1.8m (~108-110px) com linha de visão direta, dispara o ataque
    const attackRange = metersToPixels(1.8);
    if (distToPlayer <= attackRange && this.hasDirectLOS) {
      if (this.pawn.performAttack && !this.pawn.isAttacking) {
        const started = this.pawn.performAttack(player);
        if (started) {
          return;
        }
      }
    }

    if (distToPlayer <= minBodyDist) {
      this.pawn.stopMovement();
      this.pawn.stopAnimation(0);
      const dx = player.x - this.pawn.x;
      const dy = player.y - this.pawn.y;
      const targetAngle = wrapAngle(Math.atan2(dy, dx) - Math.PI / 2);
      this.pawn.rotateTowards(targetAngle, delta, 14);
      return;
    }

    if (this.hasDirectLOS) {
      this.currentPath = [];
      const dx = player.x - this.pawn.x;
      const dy = player.y - this.pawn.y;
      const moveVec = normalizeVec(dx, dy);

      this.pawn.setVelocity(moveVec.x * speed, moveVec.y * speed);
      this.pawn.playAnimation('run');

      const targetAngle = wrapAngle(Math.atan2(dy, dx) - Math.PI / 2);
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
        const distToNode = Math.hypot(targetNode.x - this.pawn.x, targetNode.y - this.pawn.y);

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
        const moveVec = normalizeVec(dx, dy);

        this.pawn.setVelocity(moveVec.x * speed, moveVec.y * speed);
        this.pawn.playAnimation('run');

        const targetAngle = wrapAngle(Math.atan2(moveVec.y, moveVec.x) - Math.PI / 2);
        this.pawn.rotateTowards(targetAngle, delta, 12);
      } else {
        const dx = player.x - this.pawn.x;
        const dy = player.y - this.pawn.y;
        const moveVec = normalizeVec(dx, dy);
        this.pawn.setVelocity(moveVec.x * speed, moveVec.y * speed);
      }
    }
  }

  /**
   * Estado INSPECTING: pausa de inspeção ou ação de chute no gerador voltado para o motor.
   */
  private handleInspectingState(delta: number, generators: Generator[]): void {
    this.pawn.stopMovement();
    this.pawn.stopAnimation(0);

    if (this.isKicking) {
      this.kickTimer -= delta;
      // Mantém o Killer voltado diretamente para o gerador durante o impacto do chute
      this.pawn.rotateTowards(this.baseInspectAngle, delta, 12);
      if (this.kickTimer <= 0) {
        this.isKicking = false;
        this.state = 'PATROL';
        this.advanceToNextPatrolGenerator(generators);
      }
      return;
    }

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

    const distToTarget = Math.hypot(this.patrolTarget.x - this.pawn.x, this.patrolTarget.y - this.pawn.y);
    const isTargetingGenerator = Boolean(
      this.patrolManager.currentDestination && this.patrolManager.currentDestination.type === 'generator'
    );
    const currentDest = this.patrolManager.currentDestination;
    const distToGen = (isTargetingGenerator && currentDest)
      ? Math.hypot(currentDest.x - this.pawn.x, currentDest.y - this.pawn.y)
      : distToTarget;

    // Chegou ao ponto frontal do gerador (stand-off) ou ao centro do cômodo
    const hasArrived = evaluatePatrolArrival(distToTarget, isTargetingGenerator, distToGen);

    if (hasArrived) {
      this.pawn.stopMovement();
      this.pawn.stopAnimation(0);

      // Inicia inspeção com tempo configurável (inspectionTime, padrão: 2.5s)
      this.state = 'INSPECTING';
      if (isTargetingGenerator && currentDest) {
        this.baseInspectAngle = wrapAngle(Math.atan2(currentDest.y - this.pawn.y, currentDest.x - this.pawn.x) - Math.PI / 2);
      } else {
        this.baseInspectAngle = this.pawn.rotation;
      }
      this.currentPath = [];

      // Avalia se o gerador alvo pode ser chutado (>0%, não concluído, não regredindo)
      const targetGen = (isTargetingGenerator && currentDest)
        ? generators.find((g) => g.name === currentDest.name || Math.hypot(g.x - currentDest.x, g.y - currentDest.y) <= 130)
        : undefined;

      if (targetGen && shouldKillerKickGenerator(targetGen)) {
        this.isKicking = true;
        this.kickTimer = 1500; // ~1.5s voltado para o motor
        targetGen.kickGenerator();
        this.patrolManager.startInspection(1500);
      } else {
        this.isKicking = false;
        const inspectMs = (settings.inspectionTime ?? 2.5) * 1000;
        this.patrolManager.startInspection(inspectMs);
      }
      return;
    }

    const speed = metersToPixels(settings.killerSpeed);

    // Se houver linha direta de visão até a área segura do gerador, caminhar direto
    if (this.pawn.hasLineOfSight(this.pawn.x, this.pawn.y, this.patrolTarget.x, this.patrolTarget.y)) {
      this.currentPath = [];
      const dx = this.patrolTarget.x - this.pawn.x;
      const dy = this.patrolTarget.y - this.pawn.y;
      const moveVec = normalizeVec(dx, dy);

      this.pawn.setVelocity(moveVec.x * speed, moveVec.y * speed);
      this.pawn.playAnimation('walk');

      const targetAngle = wrapAngle(Math.atan2(dy, dx) - Math.PI / 2);
      this.pawn.rotateTowards(targetAngle, delta, 5);
    } else {
      if (this.currentPath.length > 0) {
        const targetNode = this.currentPath[this.currentPathIndex];
        const distToNode = Math.hypot(targetNode.x - this.pawn.x, targetNode.y - this.pawn.y);

        if (distToNode < 36 && this.currentPathIndex < this.currentPath.length - 1) {
          this.currentPathIndex++;
        }

        const activeNode = this.currentPath[this.currentPathIndex];
        const dx = activeNode.x - this.pawn.x;
        const dy = activeNode.y - this.pawn.y;
        const moveVec = normalizeVec(dx, dy);

        this.pawn.setVelocity(moveVec.x * speed, moveVec.y * speed);
        this.pawn.playAnimation('walk');

        const targetAngle = wrapAngle(Math.atan2(moveVec.y, moveVec.x) - Math.PI / 2);
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
    this.isKicking = false;
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
    this.stuckSampleTimer = 0;
    this.stuckDuration = 0;
    this.lastSampleX = this.pawn.x;
    this.lastSampleY = this.pawn.y;
    this.hasInitializedSamplePos = true;
    this.pawn.calculatePath(this.pawn.x, this.pawn.y, this.patrolTarget.x, this.patrolTarget.y, (path) => {
      this.currentPath = path;
      this.currentPathIndex = path.length > 1 ? 1 : 0;
    });
  }

  /**
   * Watchdog Anti-Stuck: monitora o deslocamento real do Killer a cada ~300ms/400ms.
   * Se o Killer estiver em estado de movimento ('PATROL' ou 'CHASE'):
   * - Se deslocar MENOS de 8 pixels em 400ms (indicando que está travado/patinando contra um colisor):
   *   a) Pula imediatamente para o próximo waypoint do caminho (this.currentPathIndex++).
   *   b) Aplica um pequeno impulso perpendicular à rota/quina para descolar do obstáculo.
   * - Se permanecer estagnado por mais de 800ms:
   *   a) Cancela a rota atual.
   *   b) Força advanceToNextPatrolGenerator() (em PATROL) ou novo cálculo de rota (em CHASE).
   */
  public handleWatchdogAntiStuck(delta: number, generators: Generator[]): void {
    const isMovingState = (this.state === 'PATROL' || this.state === 'CHASE') && !this.pawn.isAttacking;
    if (!isMovingState) {
      this.stuckSampleTimer = 0;
      this.stuckDuration = 0;
      this.lastSampleX = this.pawn.x;
      this.lastSampleY = this.pawn.y;
      this.hasInitializedSamplePos = true;
      return;
    }

    if (!this.hasInitializedSamplePos) {
      this.lastSampleX = this.pawn.x;
      this.lastSampleY = this.pawn.y;
      this.hasInitializedSamplePos = true;
      return;
    }

    this.stuckSampleTimer += delta;
    if (this.stuckSampleTimer >= 300) {
      const distMoved = Math.hypot(
        this.pawn.x - this.lastSampleX,
        this.pawn.y - this.lastSampleY
      );

      if (distMoved < 8) {
        this.stuckDuration += this.stuckSampleTimer;

        // Estágio 1: Estagnado há >= 400ms -> Pula para o próximo nó do A* e aplica impulso perpendicular
        if (this.stuckDuration >= 400 && this.stuckDuration < 800) {
          if (this.currentPath.length > 0 && this.currentPathIndex < this.currentPath.length - 1) {
            this.currentPathIndex++;
          }
          let nudgeX = 0;
          let nudgeY = 0;
          if (this.currentPath.length > 0 && this.currentPath[this.currentPathIndex]) {
            const targetNode = this.currentPath[this.currentPathIndex];
            const angle = Math.atan2(targetNode.y - this.pawn.y, targetNode.x - this.pawn.x);
            nudgeX = -Math.sin(angle) * 75;
            nudgeY = Math.cos(angle) * 75;
          } else {
            const angle = this.pawn.rotation + Math.PI / 2;
            nudgeX = Math.cos(angle) * 75;
            nudgeY = Math.sin(angle) * 75;
          }
          this.pawn.setVelocity(nudgeX, nudgeY);
        }

        // Estágio 2: Estagnado há >= 800ms -> Cancela rota e força avanço para o próximo gerador / recalcula rota
        if (this.stuckDuration >= 800) {
          this.currentPath = [];
          this.currentPathIndex = 0;
          this.stuckDuration = 0;
          if (this.state === 'PATROL') {
            this.advanceToNextPatrolGenerator(generators);
          } else if (this.state === 'CHASE') {
            this.pathRecalcTimer = 300;
          }
        }
      } else {
        this.stuckDuration = 0;
      }

      this.stuckSampleTimer = 0;
      this.lastSampleX = this.pawn.x;
      this.lastSampleY = this.pawn.y;
    }
  }
}
