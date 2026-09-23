/**
 * @file Player.ts
 * @description Entidade do Jogador (Sobrevivente) com física Arcade, movimentação omnidirecional,
 * sprint com Shift, rotação resiliente em 360° em direção ao mouse e trava anti-tunelamento.
 */

import Phaser from 'phaser';
import { DebugSettings } from '../config/constants';
import { evaluatePlayerMovementState, clampCircleAgainstNavGrid, metersToPixels } from '../utils/gameLogic';

export class Player {
  public sprite: Phaser.Physics.Arcade.Sprite;
  public scene: Phaser.Scene;

  // Estado de movimentação e telemetria
  public isActive = true;
  public isMoving = false;
  public isSprinting = false;
  public currentSpeed = 0;
  public isInputMoving = false;
  public isSprintingInput = false;
  public inputDir = { x: 0, y: 0 };

  // Trava de integridade contra penetração em paredes
  public lastSafeX = 1280;
  public lastSafeY = 960;
  public lastPositionX = 1280;
  public lastPositionY = 960;

  // Configurações ativas de depuração
  private settings: DebugSettings;

  // Amostragem de deslocamento e velocidade resiliente a taxas de atualização variáveis (60Hz / 120Hz / 144Hz)
  private sampleDist = 0;
  private sampleTime = 0;
  private effectiveSpeed = 0;
  private lastInputDir = { x: 0, y: 0 };
  private wasInputMoving = false;

  // Ângulo alvo persistente para rotação suave
  private lastTargetAngle = 0;

  // Controles de entrada
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private keyShift!: Phaser.Input.Keyboard.Key;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private activeKeys: Set<string> = new Set();

  /**
   * Inicializa o Player na posição especificada.
   * @param {Phaser.Scene} scene - A cena do Phaser.
   * @param {number} x - Posição X inicial no mundo.
   * @param {number} y - Posição Y inicial no mundo.
   * @param {DebugSettings} settings - Configurações iniciais de depuração.
   */
  constructor(scene: Phaser.Scene, x: number, y: number, settings: DebugSettings) {
    this.scene = scene;
    this.settings = settings;
    this.lastSafeX = x;
    this.lastSafeY = y;
    this.lastPositionX = x;
    this.lastPositionY = y;

    // Criar sprite físico do Survivor
    this.sprite = scene.physics.add.sprite(x, y, 'survivor', 0);
    this.sprite.setScale(settings.playerScale);
    this.sprite.setOrigin(0.5, 0.5);
    this.sprite.setCollideWorldBounds(true);
    this.sprite.setDepth(10);

    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setDamping(false);
    body.setDrag(0, 0);

    this.updateHitbox(settings.hitboxRadius, settings.playerScale);
    this.setupInput();
  }

  /**
   * Configura os manipuladores de teclado com captura global resiliente ao lil-gui.
   */
  private setupInput(): void {
    if (this.scene.input.keyboard) {
      this.keyW = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
      this.keyA = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
      this.keyS = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
      this.keyD = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
      this.keyShift = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
      this.cursors = this.scene.input.keyboard.createCursorKeys();
    }

    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.activeKeys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.activeKeys.delete(e.code);
  };

  private onBlur = (): void => {
    this.activeKeys.clear();
  };

  /**
   * Destrói listeners globais ao desmontar a cena.
   */
  public destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onBlur);
    this.sprite.destroy();
  }

  /**
   * Recalibra o círculo de colisão física Arcade proporcionalmente ao tamanho do frame e escala.
   * @param {number} hitboxRadius - Raio configurado da hitbox.
   * @param {number} scale - Escala visual do personagem.
   */
  public updateHitbox(hitboxRadius: number, scale: number): void {
    this.sprite.setScale(scale);
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
   * Ativa ou desativa o Survivor no mapa (Modo Espectador do Killer).
   * - Quando desativado (false): torna o sprite invisível, desativa colisão física Arcade e bloqueia inputs WASD.
   * - Quando reativado (true): restaura a visibilidade, colisão física e controle do Survivor.
   */
  public setActiveState(active: boolean): void {
    this.isActive = active;
    this.sprite.setVisible(active);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    if (body) {
      body.enable = active;
    }
    if (!active) {
      this.sprite.setVelocity(0, 0);
      this.isMoving = false;
      this.isSprinting = false;
      this.currentSpeed = 0;
      this.effectiveSpeed = 0;
      this.isInputMoving = false;
      this.isSprintingInput = false;
      this.inputDir = { x: 0, y: 0 };
      if (this.sprite.anims.isPlaying) {
        this.sprite.anims.stop();
        this.sprite.setFrame(0);
      }
    }
  }

  /**
   * Atualização contínua por frame da movimentação, animação e rotação do jogador.
   * @param {number} delta - Tempo delta em milissegundos desde o último frame.
   * @param {boolean} isRepairing - True se o jogador estiver imobilizado reparando um gerador.
   * @param {DebugSettings} settings - Parâmetros de velocidade e rotação ativos.
   */
  public update(delta: number, isRepairing: boolean, settings: DebugSettings): void {
    this.settings = settings;
    if (settings.survivorActive !== undefined && settings.survivorActive !== this.isActive) {
      this.setActiveState(settings.survivorActive);
    }

    if (!this.isActive) {
      this.sprite.setVelocity(0, 0);
      this.isMoving = false;
      this.isSprinting = false;
      this.currentSpeed = 0;
      this.effectiveSpeed = 0;
      return;
    }

    this.handleMovement(isRepairing, settings);
    this.handleRotation(delta, settings);
  }

  /**
   * Processa entrada WASD, normalização vetorial e seleção de animação (walk / run).
   */
  private handleMovement(isRepairing: boolean, settings: DebugSettings): void {
    if (isRepairing) {
      this.sprite.setVelocity(0, 0);
      this.isInputMoving = false;
      this.isSprintingInput = false;
      this.isMoving = false;
      this.isSprinting = false;
      this.currentSpeed = 0;
      this.effectiveSpeed = 0;
      this.sampleDist = 0;
      this.sampleTime = 0;
      this.inputDir = { x: 0, y: 0 };
      if (this.sprite.anims.isPlaying) {
        this.sprite.anims.stop();
        this.sprite.setFrame(0);
      }
      return;
    }

    let moveX = 0;
    let moveY = 0;

    const isUp = Boolean(
      this.keyW?.isDown ||
      this.cursors?.up?.isDown ||
      this.activeKeys.has('KeyW') ||
      this.activeKeys.has('ArrowUp')
    );
    const isDown = Boolean(
      this.keyS?.isDown ||
      this.cursors?.down?.isDown ||
      this.activeKeys.has('KeyS') ||
      this.activeKeys.has('ArrowDown')
    );
    const isLeft = Boolean(
      this.keyA?.isDown ||
      this.cursors?.left?.isDown ||
      this.activeKeys.has('KeyA') ||
      this.activeKeys.has('ArrowLeft')
    );
    const isRight = Boolean(
      this.keyD?.isDown ||
      this.cursors?.right?.isDown ||
      this.activeKeys.has('KeyD') ||
      this.activeKeys.has('ArrowRight')
    );
    const isSprintingKey = Boolean(
      this.keyShift?.isDown ||
      this.activeKeys.has('ShiftLeft') ||
      this.activeKeys.has('ShiftRight')
    );

    if (isUp) moveY -= 1;
    if (isDown) moveY += 1;
    if (isLeft) moveX -= 1;
    if (isRight) moveX += 1;

    const isInputMoving = moveX !== 0 || moveY !== 0;
    const isSprinting = Boolean(isInputMoving && isSprintingKey);

    this.isInputMoving = isInputMoving;
    this.isSprintingInput = isSprinting;
    this.inputDir = { x: moveX, y: moveY };

    if (isInputMoving) {
      const moveVector = new Phaser.Math.Vector2(moveX, moveY).normalize();
      const intendedSpeedMeters = isSprinting ? settings.runSpeed : settings.walkSpeed;
      const intendedSpeed = metersToPixels(intendedSpeedMeters);
      this.sprite.setVelocity(moveVector.x * intendedSpeed, moveVector.y * intendedSpeed);
    } else {
      this.sprite.setVelocity(0, 0);
      this.isMoving = false;
      this.isSprinting = false;
      this.currentSpeed = 0;
      this.effectiveSpeed = 0;
      this.sampleDist = 0;
      this.sampleTime = 0;
      if (this.sprite.anims.isPlaying) {
        this.sprite.anims.stop();
        this.sprite.setFrame(0);
      }
    }
  }

  /**
   * Processa rotação suave em 360° em direção ao cursor do mouse com proteção angular segura.
   */
  private handleRotation(delta: number, settings: DebugSettings): void {
    const pointer = this.scene.input.activePointer;
    if (!pointer) return;

    const pointerX = pointer.worldX;
    const pointerY = pointer.worldY;

    if (
      typeof pointerX === 'number' &&
      typeof pointerY === 'number' &&
      !isNaN(pointerX) &&
      !isNaN(pointerY)
    ) {
      const dx = pointerX - this.sprite.x;
      const dy = pointerY - this.sprite.y;

      if (dx * dx + dy * dy >= 16) {
        // Offset de -PI/2 porque o sprite original olha para o Sul (+Y)
        this.lastTargetAngle = Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - Math.PI / 2);
      }
    }

    const targetAngle = this.lastTargetAngle;

    let currentAngle = this.sprite.rotation;
    if (typeof currentAngle !== 'number' || isNaN(currentAngle) || !isFinite(currentAngle)) {
      currentAngle = targetAngle;
      this.sprite.rotation = targetAngle;
    }
    currentAngle = Phaser.Math.Angle.Wrap(currentAngle);

    if (settings.instantTurn) {
      if (typeof targetAngle === 'number' && !isNaN(targetAngle) && isFinite(targetAngle)) {
        this.sprite.rotation = targetAngle;
      }
      return;
    }

    const diff = Phaser.Math.Angle.Wrap(targetAngle - currentAngle);
    if (isNaN(diff)) {
      this.sprite.rotation = targetAngle;
      return;
    }

    const deltaSeconds =
      typeof delta === 'number' && !isNaN(delta) && delta > 0
        ? Math.min(delta / 1000, 0.1)
        : 1 / 60;

    const speed =
      typeof settings.turnSpeed === 'number' && !isNaN(settings.turnSpeed) && settings.turnSpeed > 0
        ? settings.turnSpeed
        : 18;

    const maxStep = speed * deltaSeconds;

    if (Math.abs(diff) <= maxStep) {
      this.sprite.rotation = targetAngle;
    } else {
      this.sprite.rotation = Phaser.Math.Angle.Wrap(currentAngle + Math.sign(diff) * maxStep);
    }
  }

  /**
   * Guarda pós-física anti-tunelamento: se o Player penetrar em uma célula sólida,
   * restaura instantaneamente para a última posição segura conhecida com velocidade zero.
   * @param {number[][]} navGrid - Matriz de navegação 0 (livre) e 1 (parede).
   */
  public enforceWallBounds(navGrid: number[][]): void {
    if (!this.sprite || !this.sprite.body || navGrid.length === 0) return;

    const radius = (this.settings?.hitboxRadius ?? 53) * (this.settings?.playerScale ?? 1.25);
    const clampResult = clampCircleAgainstNavGrid(this.sprite.x, this.sprite.y, radius, navGrid);

    if (clampResult.clamped) {
      this.sprite.setPosition(clampResult.x, clampResult.y);
      (this.sprite.body as Phaser.Physics.Arcade.Body).updateCenter();
    }
    this.lastSafeX = this.sprite.x;
    this.lastSafeY = this.sprite.y;
  }

  /**
   * Pós-processamento físico do Player (executado no POST_UPDATE):
   * 1. Aplica trava de segurança anti-tunelamento nas paredes (enforceWallBounds).
   * 2. Calcula o deslocamento físico real no mundo e a velocidade efetiva com amostragem
   *    estabilizada contra discrepâncias de taxa de atualização (60Hz fixedStep vs 120Hz/144Hz render).
   * 3. Avalia o estado de bloqueio e animação: para e entra em 'idle' sob colisão frontal
   *    ou continua a animação caso esteja deslizando/strafing pela parede ou em espaço livre.
   */
  public postUpdate(delta: number, navGrid: number[][]): void {
    if (!this.isActive) {
      this.isMoving = false;
      this.isSprinting = false;
      this.currentSpeed = 0;
      this.effectiveSpeed = 0;
      this.lastPositionX = this.sprite.x;
      this.lastPositionY = this.sprite.y;
      return;
    }

    this.enforceWallBounds(navGrid);

    if (!this.isInputMoving) {
      this.isMoving = false;
      this.isSprinting = false;
      this.currentSpeed = 0;
      this.effectiveSpeed = 0;
      this.sampleDist = 0;
      this.sampleTime = 0;
      this.wasInputMoving = false;
      this.lastInputDir = { x: 0, y: 0 };
      if (this.sprite.anims.isPlaying) {
        this.sprite.anims.stop();
        this.sprite.setFrame(0);
      }
      this.lastPositionX = this.sprite.x;
      this.lastPositionY = this.sprite.y;
      return;
    }

    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    const deltaMs = delta > 0 ? delta : 16.66;
    const dx = this.sprite.x - this.lastPositionX;
    const dy = this.sprite.y - this.lastPositionY;
    const frameDist = Math.hypot(dx, dy);

    this.lastPositionX = this.sprite.x;
    this.lastPositionY = this.sprite.y;

    const blocked = body
      ? {
          left: Boolean(body.blocked.left || body.touching.left),
          right: Boolean(body.blocked.right || body.touching.right),
          up: Boolean(body.blocked.up || body.touching.up),
          down: Boolean(body.blocked.down || body.touching.down)
        }
      : undefined;

    const pushesIntoWallX = (this.inputDir.x > 0 && Boolean(blocked?.right)) || (this.inputDir.x < 0 && Boolean(blocked?.left));
    const pushesIntoWallY = (this.inputDir.y > 0 && Boolean(blocked?.down)) || (this.inputDir.y < 0 && Boolean(blocked?.up));
    const hasBlockedInput = (this.inputDir.x !== 0 && pushesIntoWallX) || (this.inputDir.y !== 0 && pushesIntoWallY);
    const hasUnblockedInput = (this.inputDir.x !== 0 && !pushesIntoWallX) || (this.inputDir.y !== 0 && !pushesIntoWallY);
    const isDirectlyBlocked = hasBlockedInput && !hasUnblockedInput;

    const inputChanged =
      this.inputDir.x !== this.lastInputDir.x ||
      this.inputDir.y !== this.lastInputDir.y ||
      !this.wasInputMoving;

    this.lastInputDir = { ...this.inputDir };
    this.wasInputMoving = true;

    if (isDirectlyBlocked && frameDist < 0.1) {
      this.effectiveSpeed = 0;
      this.sampleDist = 0;
      this.sampleTime = 0;
    } else {
      const intendedSpeedMeters = this.isSprintingInput
        ? (this.settings?.runSpeed ?? 4.0)
        : (this.settings?.walkSpeed ?? 2.26);
      const intendedSpeed = metersToPixels(intendedSpeedMeters);
      const strafeSpeed = (pushesIntoWallX || pushesIntoWallY) ? intendedSpeed * Math.SQRT1_2 : intendedSpeed;

      if (inputChanged || frameDist > 0.05) {
        if (this.effectiveSpeed === 0) {
          this.effectiveSpeed = strafeSpeed;
        }
      }

      this.sampleDist += frameDist;
      this.sampleTime += deltaMs;

      // Amostragem em janela (~50ms) para estabilizar fixedStep de 60Hz contra telas de 120Hz/144Hz
      if (this.sampleTime >= 50) {
        const measured = (this.sampleDist / this.sampleTime) * 1000;
        if (this.sampleDist < 0.2 && isDirectlyBlocked) {
          // Corpo estagnado/preso contra obstáculo sólido
          this.effectiveSpeed = 0;
        } else {
          this.effectiveSpeed = Math.max(measured, hasUnblockedInput ? strafeSpeed * 0.5 : 0);
        }
        this.sampleDist = 0;
        this.sampleTime = 0;
      }
    }

    const evalState = evaluatePlayerMovementState(
      this.isInputMoving,
      this.isSprintingInput,
      this.effectiveSpeed,
      5,
      blocked,
      this.inputDir
    );

    this.isMoving = evalState.isMoving;
    this.isSprinting = evalState.isMoving && this.isSprintingInput;
    this.currentSpeed = Math.round(evalState.actualSpeed);

    if (evalState.animState === 'idle') {
      if (this.sprite.anims.isPlaying) {
        this.sprite.anims.stop();
        this.sprite.setFrame(0);
      }
    } else {
      if (this.scene.anims.exists(evalState.animState)) {
        if (!this.sprite.anims.isPlaying || this.sprite.anims.currentAnim?.key !== evalState.animState) {
          this.sprite.anims.play(evalState.animState, true);
        }
      }
    }
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
