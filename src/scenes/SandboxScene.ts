import Phaser from 'phaser';
import GUI from 'lil-gui';
import survivorMeta from '../assets/survivor.json';

export interface DebugSettings {
  walkSpeed: number;
  runSpeed: number;
  turnSpeed: number;
  instantTurn: boolean;
  playerScale: number;
  hitboxRadius: number;
  showPhysicsDebug: boolean;
  walkAnimFrameRate: number;
  runAnimFrameRate: number;
}

const STORAGE_KEY = 'horror_topdown_debug_settings';

const DEFAULT_DEBUG_SETTINGS: DebugSettings = {
  walkSpeed: 140,
  runSpeed: 240,
  turnSpeed: 18,
  instantTurn: false,
  playerScale: 0.25,
  hitboxRadius: 265, // Envolve completamente os ombros e tronco (sem transbordar)
  showPhysicsDebug: true,
  walkAnimFrameRate: 8,
  runAnimFrameRate: 12
};

export class SandboxScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private obstacles!: Phaser.Physics.Arcade.StaticGroup;

  // Inputs
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private keyShift!: Phaser.Input.Keyboard.Key;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  // Debug settings (iniciadas com os padrões ou carregadas do localStorage)
  public debugSettings: DebugSettings = { ...DEFAULT_DEBUG_SETTINGS };

  // Monitor status for GUI
  public monitorState = {
    currentSpeed: 0,
    isMoving: false,
    isSprinting: false,
    rotationDeg: '0°',
    playerScale: '0.25x',
    hitboxPixels: '133px',
    playerX: '0',
    playerY: '0',
    fps: 0
  };

  private gui!: GUI;

  // Salvar última posição válida do ponteiro para evitar rotações espúrias
  private lastTargetAngle = 0;

  // Fallback de teclas globais para garantir movimentação ininterrupta mesmo ao interagir com o lil-gui
  private activeKeys: Set<string> = new Set();

  private onWindowKeyDown = (e: KeyboardEvent): void => {
    this.activeKeys.add(e.code);

    // Se o elemento ativo for um controle do lil-gui (ex: checkbox de Giro Instantâneo),
    // desfocar automaticamente para que o teclado continue no jogo
    if (
      document.activeElement &&
      document.activeElement !== document.body &&
      document.activeElement !== this.game.canvas
    ) {
      const isEditingText =
        document.activeElement instanceof HTMLInputElement &&
        (document.activeElement.type === 'text' || document.activeElement.type === 'number');

      if (!isEditingText) {
        (document.activeElement as HTMLElement).blur();
        this.game.canvas?.focus();
      }
    }
  };

  private onWindowKeyUp = (e: KeyboardEvent): void => {
    this.activeKeys.delete(e.code);
  };

  private onWindowBlur = (): void => {
    this.activeKeys.clear();
  };

  constructor() {
    super({ key: 'SandboxScene' });
  }

  init(): void {
    this.loadSettingsFromStorage();
  }

  preload(): void {
    // Carregar spritesheet gerado usando os metadados dinâmicos de survivor.json
    // Suporta qualquer alteração futura no tamanho da grelha de frames
    const frameWidth = survivorMeta.frameWidth || 704;
    const frameHeight = survivorMeta.frameHeight || 768;

    this.load.spritesheet('survivor', 'assets/survivor.png', {
      frameWidth,
      frameHeight
    });
  }

  create(): void {
    this.createEnvironment();
    this.createAnimations();
    this.createPlayer();
    this.setupInput();
    this.setupCollisions();
    this.setupDebugPanel();

    // Sincronizar visualização de física com a configuração carregada do localStorage
    this.physics.world.drawDebug = this.debugSettings.showPhysicsDebug;

    // Garantir foco direto e acessibilidade de teclado no canvas do jogo
    if (this.game.canvas) {
      this.game.canvas.setAttribute('tabindex', '0');
      this.game.canvas.style.outline = 'none';
      this.game.canvas.addEventListener('pointerdown', () => {
        this.game.canvas.focus();
      });
    }

    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', this.onWindowKeyDown, true);
      window.removeEventListener('keyup', this.onWindowKeyUp, true);
      window.removeEventListener('blur', this.onWindowBlur);
      if (this.gui) {
        this.gui.destroy();
      }
    });
  }

  /**
   * Cenário de Teste:
   * - Chão com grid visual (quadriculado escuro).
   * - 4 paredes delimitando o mapa (com colisão física estática).
   * - 3 obstáculos fechados no centro da sala para testar quinas.
   */
  private createEnvironment(): void {
    const { width, height } = this.scale;

    // 1. Chão com grid visual quadriculado escuro
    const grid = this.add.grid(
      width / 2,
      height / 2,
      width,
      height,
      64,
      64,
      0x13141a,
      1,
      0x212430,
      0.8
    );
    grid.setDepth(0);

    // Grid accent lines a cada 256px
    const majorGrid = this.add.grid(
      width / 2,
      height / 2,
      width,
      height,
      256,
      256,
      0x000000,
      0,
      0x34394c,
      0.6
    );
    majorGrid.setDepth(0);

    // 2. Paredes estáticas delimitando o mapa
    this.walls = this.physics.add.staticGroup();
    const wallThickness = 28;

    // Top wall
    this.buildWall(width / 2, wallThickness / 2, width, wallThickness);
    // Bottom wall
    this.buildWall(width / 2, height - wallThickness / 2, width, wallThickness);
    // Left wall
    this.buildWall(wallThickness / 2, height / 2, wallThickness, height);
    // Right wall
    this.buildWall(width - wallThickness / 2, height / 2, wallThickness, height);

    // 3. Obstáculos fechados no centro para teste de quinas e colisão
    this.obstacles = this.physics.add.staticGroup();

    // Obstáculo 1: Coluna quadrada (Centro-Oeste)
    this.buildObstacle(380, 360, 140, 140, 'Obstáculo A (140x140)');

    // Obstáculo 2: Barreira horizontal (Centro-Norte)
    this.buildObstacle(640, 210, 200, 90, 'Obstáculo B (200x90)');

    // Obstáculo 3: Pilar retangular vertical (Centro-Leste)
    this.buildObstacle(900, 410, 130, 180, 'Obstáculo C (130x180)');
  }

  private buildWall(x: number, y: number, width: number, height: number): void {
    const rect = this.add.rectangle(x, y, width, height, 0x222631);
    rect.setStrokeStyle(2, 0x41475b);
    rect.setDepth(1);
    this.walls.add(rect);
  }

  private buildObstacle(x: number, y: number, width: number, height: number, label: string): void {
    const shadow = this.add.rectangle(x + 6, y + 6, width, height, 0x050608, 0.6);
    shadow.setDepth(1);

    const rect = this.add.rectangle(x, y, width, height, 0x2b303e);
    rect.setStrokeStyle(3, 0x59627e);
    rect.setDepth(2);

    const innerRect = this.add.rectangle(x, y, width - 16, height - 16, 0x1f232e);
    innerRect.setStrokeStyle(1, 0x3d4355);
    innerRect.setDepth(2);

    this.add.text(x, y, label, {
      fontSize: '11px',
      color: '#8c95af',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(3);

    this.obstacles.add(rect);
  }

  /**
   * Animações do Player com base nos metadados de frames:
   * - walk: linha 1 do spritesheet (frames definidos em walkFrames)
   * - run: linha 2 do spritesheet (frames definidos em runFrames)
   */
  private createAnimations(): void {
    if (!this.textures.exists('survivor')) {
      console.warn('Textura "survivor" ainda não carregada na criação de animações.');
      return;
    }

    const walkFrames = survivorMeta.walkFrames || [0, 1, 2, 3];
    const runFrames = survivorMeta.runFrames || [4, 5, 6, 7];

    const walkConfig = this.anims.generateFrameNumbers('survivor', { frames: walkFrames });
    if (walkConfig && walkConfig.length > 0) {
      this.anims.create({
        key: 'walk',
        frames: walkConfig,
        frameRate: this.debugSettings.walkAnimFrameRate,
        repeat: -1
      });
    }

    const runConfig = this.anims.generateFrameNumbers('survivor', { frames: runFrames });
    if (runConfig && runConfig.length > 0) {
      this.anims.create({
        key: 'run',
        frames: runConfig,
        frameRate: this.debugSettings.runAnimFrameRate,
        repeat: -1
      });
    }
  }

  private createPlayer(): void {
    this.player = this.physics.add.sprite(640, 520, 'survivor', 0);
    this.player.setDepth(10);

    // O ponto de rotação (anchor / origin) está rigorosamente centralizado em (0.5, 0.5)
    // para que o giro aconteça exatamente no próprio eixo central
    this.player.setOrigin(0.5, 0.5);

    this.updatePlayerHitbox();
    this.player.setCollideWorldBounds(true);

    this.lastTargetAngle = 0;
  }

  /**
   * Atualiza a escala do jogador e calibra o círculo de colisão (Arcade Physics).
   * - Raio configurado para cobrir a largura dos ombros do personagem.
   * - Centro do círculo de colisão coincide com o centro de rotação (0.5, 0.5)
   *   para que o círculo não se desloque quando o jogador gira.
   */
  public updatePlayerHitbox(): void {
    if (!this.player || !this.player.body) return;

    this.player.setScale(this.debugSettings.playerScale);

    const frameW = survivorMeta.frameWidth || 704;
    const frameH = survivorMeta.frameHeight || 768;
    const radius = this.debugSettings.hitboxRadius;

    // Centro do frame: (frameW * 0.5, frameH * 0.5)
    // Offset para que o centro do círculo de colisão coincida exatamente com (0.5, 0.5):
    const offsetX = (frameW * 0.5) - radius;
    const offsetY = (frameH * 0.5) - radius;

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setCircle(radius, offsetX, offsetY);
  }

  private setupInput(): void {
    if (this.input.keyboard) {
      this.keyW = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
      this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
      this.keyS = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
      this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
      this.keyShift = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
      this.cursors = this.input.keyboard.createCursorKeys();
    }

    // Registrar listeners globais em fase de captura (true) para capturar o teclado antes do stopPropagation do lil-gui
    window.addEventListener('keydown', this.onWindowKeyDown, true);
    window.addEventListener('keyup', this.onWindowKeyUp, true);
    window.addEventListener('blur', this.onWindowBlur);
  }

  private setupCollisions(): void {
    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.player, this.obstacles);
  }

  /**
   * Sliders de Ajuste Rápido (lil-gui)
   * - walkSpeed (padrão: 140)
   * - runSpeed (padrão: 240)
   * - turnSpeed / Suavização da rotação
   * - Giro Instantâneo
   */
  private setupDebugPanel(): void {
    this.gui = new GUI({ title: '⚙️ Sandbox Debug' });
    this.gui.domElement.style.position = 'absolute';
    this.gui.domElement.style.top = '12px';
    this.gui.domElement.style.right = '12px';
    this.gui.domElement.style.zIndex = '100';

    const speedsFolder = this.gui.addFolder('Velocidades & Movimento');
    speedsFolder
      .add(this.debugSettings, 'walkSpeed', 50, 400, 5)
      .name('Walk Speed');
    speedsFolder
      .add(this.debugSettings, 'runSpeed', 100, 600, 5)
      .name('Run Speed');
    speedsFolder
      .add(this.debugSettings, 'turnSpeed', 1, 60, 1)
      .name('Turn Speed')
      .onChange((val: number) => {
        this.debugSettings.turnSpeed = Number(val) || 18;
      });
    speedsFolder
      .add(this.debugSettings, 'playerScale', 0.05, 1.0, 0.01)
      .name('Player Scale')
      .onChange((val: number) => {
        this.debugSettings.playerScale = Number(val) || 0.25;
        this.updatePlayerHitbox();
      });
    speedsFolder
      .add(this.debugSettings, 'instantTurn')
      .name('Giro Instantâneo')
      .onChange((val: boolean) => {
        this.debugSettings.instantTurn = Boolean(val);
      });

    const animFolder = this.gui.addFolder('Taxa de Animações (FPS)');
    animFolder
      .add(this.debugSettings, 'walkAnimFrameRate', 2, 24, 1)
      .name('Walk Anim FPS')
      .onChange((val: number) => {
        const anim = this.anims.get('walk');
        if (anim) anim.frameRate = val;
      });
    animFolder
      .add(this.debugSettings, 'runAnimFrameRate', 2, 30, 1)
      .name('Run Anim FPS')
      .onChange((val: number) => {
        const anim = this.anims.get('run');
        if (anim) anim.frameRate = val;
      });

    const displayFolder = this.gui.addFolder('Física & Renderização');
    displayFolder
      .add(this.debugSettings, 'hitboxRadius', 150, 350, 5)
      .name('Raio Base Hitbox')
      .onChange((val: number) => {
        this.debugSettings.hitboxRadius = Number(val) || 265;
        this.updatePlayerHitbox();
      });
    displayFolder
      .add(this.debugSettings, 'showPhysicsDebug')
      .name('Visualizar Colisão')
      .onChange((enabled: boolean) => {
        this.physics.world.drawDebug = enabled;
        if (!enabled && this.physics.world.debugGraphic) {
          this.physics.world.debugGraphic.clear();
        }
      });

    const monitorFolder = this.gui.addFolder('Telemetria em Tempo Real');
    monitorFolder.add(this.monitorState, 'currentSpeed').name('Vel. Atual').listen().disable();
    monitorFolder.add(this.monitorState, 'isMoving').name('Movendo').listen().disable();
    monitorFolder.add(this.monitorState, 'isSprinting').name('Sprint (Shift)').listen().disable();
    monitorFolder.add(this.monitorState, 'rotationDeg').name('Ângulo').listen().disable();
    monitorFolder.add(this.monitorState, 'playerScale').name('Escala Atual').listen().disable();
    monitorFolder.add(this.monitorState, 'hitboxPixels').name('Hitbox Diâmetro').listen().disable();
    monitorFolder.add(this.monitorState, 'playerX').name('Pos X').listen().disable();
    monitorFolder.add(this.monitorState, 'playerY').name('Pos Y').listen().disable();
    monitorFolder.add(this.monitorState, 'fps').name('Game FPS').listen().disable();

    speedsFolder.open();
    displayFolder.open();
    monitorFolder.open();

    // Ouvir qualquer alteração em qualquer controle do lil-gui para salvar no localStorage
    this.gui.onChange(() => {
      this.saveSettingsToStorage();
    });

    // Desfocar automaticamente checkboxes e controles ao interagir no lil-gui para que o foco volte ao jogo imediatamente
    this.gui.domElement.addEventListener('pointerup', () => {
      if (
        document.activeElement instanceof HTMLInputElement &&
        document.activeElement.type === 'checkbox'
      ) {
        document.activeElement.blur();
        this.game.canvas?.focus();
      }
    });

    this.gui.domElement.addEventListener('change', (e: Event) => {
      const target = e.target as HTMLElement;
      if (target && target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox') {
        target.blur();
        this.game.canvas?.focus();
      }
    });

    this.gui.domElement.addEventListener('pointerleave', () => {
      const active = document.activeElement;
      if (active && this.gui.domElement.contains(active)) {
        (active as HTMLElement).blur();
        this.game.canvas?.focus();
      }
    });

    // Botão de restaurar configurações padrão
    const actions = {
      resetDefaults: () => this.resetSettingsToDefaults()
    };
    this.gui.add(actions, 'resetDefaults').name('🔄 Restaurar Padrões');
  }

  /**
   * Carrega as configurações de depuração salvas no LocalStorage do navegador.
   */
  private loadSettingsFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        if (typeof parsed.walkSpeed === 'number' && !isNaN(parsed.walkSpeed)) {
          this.debugSettings.walkSpeed = parsed.walkSpeed;
        }
        if (typeof parsed.runSpeed === 'number' && !isNaN(parsed.runSpeed)) {
          this.debugSettings.runSpeed = parsed.runSpeed;
        }
        if (typeof parsed.turnSpeed === 'number' && !isNaN(parsed.turnSpeed)) {
          this.debugSettings.turnSpeed = parsed.turnSpeed;
        }
        if (typeof parsed.instantTurn === 'boolean') {
          this.debugSettings.instantTurn = parsed.instantTurn;
        }
        if (typeof parsed.playerScale === 'number' && !isNaN(parsed.playerScale)) {
          this.debugSettings.playerScale = parsed.playerScale;
        }
        if (typeof parsed.hitboxRadius === 'number' && !isNaN(parsed.hitboxRadius)) {
          this.debugSettings.hitboxRadius = parsed.hitboxRadius;
        }
        if (typeof parsed.showPhysicsDebug === 'boolean') {
          this.debugSettings.showPhysicsDebug = parsed.showPhysicsDebug;
        }
        if (typeof parsed.walkAnimFrameRate === 'number' && !isNaN(parsed.walkAnimFrameRate)) {
          this.debugSettings.walkAnimFrameRate = parsed.walkAnimFrameRate;
        }
        if (typeof parsed.runAnimFrameRate === 'number' && !isNaN(parsed.runAnimFrameRate)) {
          this.debugSettings.runAnimFrameRate = parsed.runAnimFrameRate;
        }
      }
    } catch (e) {
      console.warn('Erro ao carregar debugSettings do localStorage:', e);
    }
  }

  /**
   * Salva as configurações atuais de depuração no LocalStorage.
   */
  private saveSettingsToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.debugSettings));
    } catch (e) {
      console.warn('Erro ao salvar debugSettings no localStorage:', e);
    }
  }

  /**
   * Restaura todas as configurações de depuração para os valores padrão de fábrica.
   */
  private resetSettingsToDefaults(): void {
    Object.assign(this.debugSettings, DEFAULT_DEBUG_SETTINGS);
    this.saveSettingsToStorage();
    this.updatePlayerHitbox();

    const walkAnim = this.anims.get('walk');
    if (walkAnim) walkAnim.frameRate = this.debugSettings.walkAnimFrameRate;

    const runAnim = this.anims.get('run');
    if (runAnim) runAnim.frameRate = this.debugSettings.runAnimFrameRate;

    this.physics.world.drawDebug = this.debugSettings.showPhysicsDebug;
    if (!this.debugSettings.showPhysicsDebug && this.physics.world.debugGraphic) {
      this.physics.world.debugGraphic.clear();
    }

    if (this.gui) {
      this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    }
  }

  update(_time: number, delta: number): void {
    this.handleMovement();
    this.handleRotation(delta);
    this.updateTelemetry();
  }

  /**
   * Movimentação:
   * - Teclas WASD com movimento omnidirecional normalizado
   * - Sprint com tecla Shift (ativa runSpeed e animação run)
   */
  private handleMovement(): void {
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

    this.monitorState.isMoving = isMoving;
    this.monitorState.isSprinting = isSprinting;

    if (isMoving) {
      const moveVector = new Phaser.Math.Vector2(moveX, moveY).normalize();
      const currentSpeed = isSprinting ? this.debugSettings.runSpeed : this.debugSettings.walkSpeed;

      this.player.setVelocity(moveVector.x * currentSpeed, moveVector.y * currentSpeed);
      this.monitorState.currentSpeed = currentSpeed;

      const targetAnim = isSprinting ? 'run' : 'walk';
      if (this.anims.exists(targetAnim)) {
        const anim = this.anims.get(targetAnim);
        if (anim && anim.frames && anim.frames.length > 0) {
          if (!this.player.anims.isPlaying || this.player.anims.currentAnim?.key !== targetAnim) {
            this.player.anims.play(targetAnim, true);
          }
        }
      }
    } else {
      this.player.setVelocity(0, 0);
      this.monitorState.currentSpeed = 0;

      if (this.player.anims.isPlaying) {
        this.player.anims.stop();
        this.player.setFrame(0);
      }
    }
  }

  /**
   * Rotação:
   * - O sprite gira em 360° apontando para o cursor do mouse
   * - Suavização via turnSpeed ou rotação instantânea garantindo resiliência matemática:
   *   1. Prevenção de NaN, null ou undefined
   *   2. Envolvimento angular seguro (Angle.Wrap) em [-PI, PI] eliminando o bug de travamento de 2PI
   *   3. Transição perfeita e sem travamento entre modo amortecido e modo instantâneo
   */
  private handleRotation(delta: number): void {
    const pointer = this.input.activePointer;
    if (!pointer) return;

    // Verificar se coordenadas do cursor são numéricas válidas
    const pointerX = pointer.worldX;
    const pointerY = pointer.worldY;

    if (
      typeof pointerX === 'number' &&
      typeof pointerY === 'number' &&
      !isNaN(pointerX) &&
      !isNaN(pointerY)
    ) {
      const dx = pointerX - this.player.x;
      const dy = pointerY - this.player.y;

      // Se o mouse estiver a mais de 4px de distância do centro, recalcular targetAngle
      // (evita oscilação brusca quando o cursor está exatamente no ponto central)
      if (dx * dx + dy * dy >= 16) {
        // - Math.PI / 2 porque os frames originais do survivor no spritesheet estão desenhados olhando para frente/sul (+Y para baixo)
        this.lastTargetAngle = Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - Math.PI / 2);
      }
    }

    const targetAngle = this.lastTargetAngle;

    // Sanear a rotação atual do jogador contra NaN ou valores não-finitos
    let currentAngle = this.player.rotation;
    if (typeof currentAngle !== 'number' || isNaN(currentAngle) || !isFinite(currentAngle)) {
      currentAngle = targetAngle;
      this.player.rotation = targetAngle;
    }
    currentAngle = Phaser.Math.Angle.Wrap(currentAngle);

    // Modo Instantâneo
    if (this.debugSettings.instantTurn) {
      if (typeof targetAngle === 'number' && !isNaN(targetAngle) && isFinite(targetAngle)) {
        this.player.rotation = targetAngle;
      }
      return;
    }

    // Modo Amortecido / Suavizado
    const diff = Phaser.Math.Angle.Wrap(targetAngle - currentAngle);

    if (isNaN(diff)) {
      this.player.rotation = targetAngle;
      return;
    }

    // Tempo delta seguro (evita saltos por frame drop ou pausa de aba)
    const deltaSeconds =
      typeof delta === 'number' && !isNaN(delta) && delta > 0
        ? Math.min(delta / 1000, 0.1)
        : 1 / 60;

    const speed =
      typeof this.debugSettings.turnSpeed === 'number' &&
      !isNaN(this.debugSettings.turnSpeed) &&
      this.debugSettings.turnSpeed > 0
        ? this.debugSettings.turnSpeed
        : 18;

    const maxStep = speed * deltaSeconds;

    if (Math.abs(diff) <= maxStep) {
      this.player.rotation = targetAngle;
    } else {
      this.player.rotation = Phaser.Math.Angle.Wrap(currentAngle + Math.sign(diff) * maxStep);
    }
  }

  private updateTelemetry(): void {
    this.monitorState.playerX = this.player.x.toFixed(1);
    this.monitorState.playerY = this.player.y.toFixed(1);
    this.monitorState.fps = Math.round(this.game.loop.actualFps);

    const deg = Math.round(Phaser.Math.RadToDeg(this.player.rotation));
    this.monitorState.rotationDeg = `${deg}°`;

    this.monitorState.playerScale = `${this.debugSettings.playerScale.toFixed(2)}x`;
    this.monitorState.hitboxPixels = `${Math.round(this.debugSettings.hitboxRadius * 2 * this.debugSettings.playerScale)}px`;
  }
}
