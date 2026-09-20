/**
 * @file Player.ts
 * @description Entidade do Jogador (Sobrevivente) com física Arcade, movimentação omnidirecional,
 * sprint com Shift, rotação resiliente em 360° em direção ao mouse e trava anti-tunelamento.
 */

import Phaser from 'phaser';
import { DebugSettings } from '../config/constants';

export class Player {
  public sprite: Phaser.Physics.Arcade.Sprite;
  public scene: Phaser.Scene;

  // Estado de movimentação e telemetria
  public isMoving = false;
  public isSprinting = false;
  public currentSpeed = 0;

  // Trava de integridade contra penetração em paredes
  public lastSafeX = 1280;
  public lastSafeY = 960;

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
    this.lastSafeX = x;
    this.lastSafeY = y;

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
   * Atualização contínua por frame da movimentação, animação e rotação do jogador.
   * @param {number} delta - Tempo delta em milissegundos desde o último frame.
   * @param {boolean} isRepairing - True se o jogador estiver imobilizado reparando um gerador.
   * @param {DebugSettings} settings - Parâmetros de velocidade e rotação ativos.
   */
  public update(delta: number, isRepairing: boolean, settings: DebugSettings): void {
    this.handleMovement(isRepairing, settings);
    this.handleRotation(delta, settings);
  }

  /**
   * Processa entrada WASD, normalização vetorial e seleção de animação (walk / run).
   */
  private handleMovement(isRepairing: boolean, settings: DebugSettings): void {
    if (isRepairing) {
      this.sprite.setVelocity(0, 0);
      this.isMoving = false;
      this.isSprinting = false;
      this.currentSpeed = 0;
      if (this.sprite.anims.isPlaying && this.sprite.anims.currentAnim?.key !== 'walk') {
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

    const isMoving = moveX !== 0 || moveY !== 0;
    const isSprinting = Boolean(isMoving && isSprintingKey);

    this.isMoving = isMoving;
    this.isSprinting = isSprinting;

    if (isMoving) {
      const moveVector = new Phaser.Math.Vector2(moveX, moveY).normalize();
      const currentSpeed = isSprinting ? settings.runSpeed : settings.walkSpeed;

      this.sprite.setVelocity(moveVector.x * currentSpeed, moveVector.y * currentSpeed);
      this.currentSpeed = currentSpeed;

      const targetAnim = isSprinting ? 'run' : 'walk';
      if (this.scene.anims.exists(targetAnim)) {
        if (!this.sprite.anims.isPlaying || this.sprite.anims.currentAnim?.key !== targetAnim) {
          this.sprite.anims.play(targetAnim, true);
        }
      }
    } else {
      this.sprite.setVelocity(0, 0);
      this.currentSpeed = 0;

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

    const col = Math.floor(this.sprite.x / 64);
    const row = Math.floor(this.sprite.y / 64);

    if (row >= 0 && row < 30 && col >= 0 && col < 40 && navGrid[row]?.[col] === 0) {
      this.lastSafeX = this.sprite.x;
      this.lastSafeY = this.sprite.y;
    } else {
      this.sprite.setPosition(this.lastSafeX, this.lastSafeY);
      this.sprite.setVelocity(0, 0);
      (this.sprite.body as Phaser.Physics.Arcade.Body).updateCenter();
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
