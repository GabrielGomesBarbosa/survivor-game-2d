import Phaser from 'phaser';
import GUI from 'lil-gui';
import survivorMeta from '../assets/survivor.json';

export const WORLD_WIDTH = 3000;
export const WORLD_HEIGHT = 2000;

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
  cameraZoom: number;
  // Killer Settings
  killerSpeed: number;
  detectionRadius: number;
  showKillerVision: boolean;
  killerAiEnabled: boolean;
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
  runAnimFrameRate: 12,
  cameraZoom: 1.0,
  killerSpeed: 170,
  detectionRadius: 280,
  showKillerVision: true,
  killerAiEnabled: true
};

export class SandboxScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private killer!: Phaser.Physics.Arcade.Sprite;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private obstacles!: Phaser.Physics.Arcade.StaticGroup;

  // Killer AI (FSM)
  private killerState: 'PATROL' | 'CHASE' = 'PATROL';
  private patrolTarget: Phaser.Math.Vector2 = new Phaser.Math.Vector2(1500, 480);
  private patrolWaitTimer = 0;
  private killerVisionGraphic!: Phaser.GameObjects.Graphics;
  private lastAttackTime = 0;
  private attackAlertUI!: Phaser.GameObjects.Container;

  // Pontos de patrulha navegáveis pelo complexo
  private patrolWaypoints: Array<{ x: number; y: number }> = [
    { x: 1500, y: 480 },  // Galpão Norte Centro
    { x: 1250, y: 350 },  // Galpão Norte Oeste
    { x: 1750, y: 350 },  // Galpão Norte Leste
    { x: 1500, y: 780 },  // Corredor Norte
    { x: 1100, y: 1000 }, // Corredor Oeste
    { x: 1500, y: 1000 }, // Pátio Central
    { x: 1900, y: 1000 }, // Corredor Leste
    { x: 2500, y: 800 },  // Usina Termoelétrica
    { x: 2500, y: 1300 }, // Sala dos Pilares
    { x: 780, y: 850 },   // Saída Laboratório
    { x: 500, y: 1200 },  // Posto Segurança
    { x: 1500, y: 1400 }, // Acesso Bunker
    { x: 1300, y: 1700 }, // Trincheira Sul
    { x: 1700, y: 1700 }  // Checkpoint Sul
  ];

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
    playerX: '1500',
    playerY: '1000',
    worldSize: '3000 x 2000',
    killerState: 'PATROL',
    killerDist: '0px',
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
    this.createKiller();
    this.createAttackUI();
    this.setupCamera();
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
   * Configuração de Câmera Dinâmica:
   * - Segue o jogador suavemente (lerp 0.08)
   * - Respeita os limites do mundo de 3000x2000
   * - Suporta zoom dinâmico ajustável pelo painel de debug
   */
  private setupCamera(): void {
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setZoom(this.debugSettings.cameraZoom);
  }

  /**
   * Cenário Expandido (3000 x 2000):
   * - Chão com grid visual em grande escala.
   * - Paredes perimetrais estáticas delimitando todo o mapa.
   * - 5 Zonas distintas com dezenas de obstáculos (galpão, laboratório, usina de força, bunker e postos táticos).
   */
  private createEnvironment(): void {
    // 1. Chão com grid quadriculado escuro cobrindo todo o mundo 3000x2000
    const grid = this.add.grid(
      WORLD_WIDTH / 2,
      WORLD_HEIGHT / 2,
      WORLD_WIDTH,
      WORLD_HEIGHT,
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
      WORLD_WIDTH / 2,
      WORLD_HEIGHT / 2,
      WORLD_WIDTH,
      WORLD_HEIGHT,
      256,
      256,
      0x000000,
      0,
      0x34394c,
      0.6
    );
    majorGrid.setDepth(0);

    // 2. Paredes perimetrais estáticas
    this.walls = this.physics.add.staticGroup();
    const wallThickness = 28;

    // Paredes externas
    this.buildWall(WORLD_WIDTH / 2, wallThickness / 2, WORLD_WIDTH, wallThickness);
    this.buildWall(WORLD_WIDTH / 2, WORLD_HEIGHT - wallThickness / 2, WORLD_WIDTH, wallThickness);
    this.buildWall(wallThickness / 2, WORLD_HEIGHT / 2, wallThickness, WORLD_HEIGHT);
    this.buildWall(WORLD_WIDTH - wallThickness / 2, WORLD_HEIGHT / 2, wallThickness, WORLD_HEIGHT);

    // 3. Obstáculos estruturados distribuídos pelo mapa
    this.obstacles = this.physics.add.staticGroup();

    // ----------------------------------------------------
    // ZONA CENTRAL (Spawn & Hub Inicial: ~1500, 1000)
    // ----------------------------------------------------
    this.buildBarricade(1300, 1000, 36, 180, 'Barricada Oeste');
    this.buildBarricade(1700, 1000, 36, 180, 'Barricada Leste');
    this.buildCrate(1380, 880, 75, 75, 'Munição');
    this.buildCrate(1620, 880, 80, 65, 'Suprimentos');
    this.buildCrate(1380, 1120, 80, 65, 'Equipamento');
    this.buildCrate(1620, 1120, 75, 75, 'Médico');

    // ----------------------------------------------------
    // ZONA NORTE: Galpão Logístico & Pátio de Carga (Y: 100..700)
    // ----------------------------------------------------
    // Paredes estruturais externas com vão aberto central
    this.buildStructure(1150, 660, 440, 28, 'Muralha Galpão W');
    this.buildStructure(1850, 660, 440, 28, 'Muralha Galpão E');
    this.buildStructure(1500, 360, 28, 380, 'Divisória Interna');

    // Containers de transporte naval
    this.buildContainer(1150, 280, 250, 95, 'Container A-01', 0x1e3a5f);
    this.buildContainer(1150, 450, 250, 95, 'Container A-02', 0x5a2323);
    this.buildContainer(1850, 250, 95, 230, 'Container B-01', 0x24422e);
    this.buildContainer(1850, 520, 95, 170, 'Container B-02', 0x544026);

    // Pilhas de paletes no galpão
    this.buildCrate(1320, 220, 80, 80, 'Palete 01');
    this.buildCrate(1680, 220, 80, 80, 'Palete 02');

    // ----------------------------------------------------
    // ZONA OESTE: Complexo Laboratorial & Corredores em L (X: 100..950, Y: 550..1550)
    // ----------------------------------------------------
    this.buildStructure(580, 820, 28, 480, 'Parede Blindada W');
    this.buildStructure(360, 1050, 420, 28, 'Corredor Central W');
    this.buildStructure(360, 600, 420, 28, 'Laboratório Químico');
    this.buildStructure(320, 820, 180, 140, 'Servidores Centrais', 0x222a38, 0x485874);
    this.buildStructure(320, 1300, 200, 150, 'Gerador Auxiliar W', 0x2c2621, 0x705c48);

    // Fileira de colunas para teste de slalom / desvio
    this.buildPillar(780, 700, 75, 'P1');
    this.buildPillar(780, 940, 75, 'P2');
    this.buildPillar(780, 1180, 75, 'P3');
    this.buildPillar(780, 1420, 75, 'P4');

    // ----------------------------------------------------
    // ZONA LESTE: Usina Termoelétrica & Sala dos Grandes Pilares (X: 2050..2900, Y: 550..1550)
    // ----------------------------------------------------
    // Unidade de turbina principal
    this.buildStructure(2520, 1050, 280, 160, 'Gerador Termoelétrico', 0x332822, 0x8a6245);

    // Grid monumental de pilares estruturais maciços
    this.buildPillar(2250, 750, 90, 'P-01');
    this.buildPillar(2520, 750, 90, 'P-02');
    this.buildPillar(2790, 750, 90, 'P-03');
    this.buildPillar(2250, 1350, 90, 'P-04');
    this.buildPillar(2520, 1350, 90, 'P-05');
    this.buildPillar(2790, 1350, 90, 'P-06');

    // Subestações de energia
    this.buildStructure(2250, 1050, 100, 150, 'Subestação Alpha', 0x252b36, 0x4f607d);
    this.buildStructure(2790, 1050, 100, 150, 'Subestação Beta', 0x252b36, 0x4f607d);
    this.buildBarricade(2520, 1220, 180, 26, 'ALTA TENSÃO');

    // ----------------------------------------------------
    // ZONA SUL: Posto Militar & Bloqueio Blindado (Y: 1400..1950)
    // ----------------------------------------------------
    // Barreiras com labirinto tático de aproximação (chicane)
    this.buildStructure(1120, 1500, 480, 32, 'Muralha Sul Oeste');
    this.buildStructure(1880, 1500, 480, 32, 'Muralha Sul Leste');
    this.buildStructure(1500, 1630, 280, 32, 'Bloqueio Balístico');

    // Trincheiras e sacos de areia
    this.buildBarricade(1280, 1750, 160, 45, 'Trincheira Alfa');
    this.buildBarricade(1720, 1750, 160, 45, 'Trincheira Bravo');
    this.buildBarricade(1500, 1870, 240, 45, 'Check-point Final');

    // Depósitos militares
    this.buildContainer(880, 1750, 220, 90, 'Armas & Munições', 0x3d3f27);
    this.buildContainer(2120, 1750, 220, 90, 'Suporte Tático', 0x332822);

    // ----------------------------------------------------
    // 4 CANTOS EXTERNOS (Marcos Territoriais)
    // ----------------------------------------------------
    // Noroeste
    this.buildStructure(350, 280, 200, 180, 'Silos Combustível', 0x2a2c35, 0x5a6073);
    this.buildCrate(200, 200, 70, 70, 'Barril #1');
    this.buildCrate(480, 390, 75, 75, 'Válvula');

    // Nordeste
    this.buildStructure(2680, 280, 220, 180, 'Torre de Radar', 0x272d38, 0x566885);
    this.buildBarricade(2680, 410, 180, 26, 'Acesso Restrito');

    // Sudoeste
    this.buildStructure(320, 1750, 190, 160, 'Quarentena', 0x2d2424, 0x6e4949);
    this.buildBarricade(320, 1630, 150, 24, 'Bio-Hazard');

    // Sudeste
    this.buildStructure(2680, 1750, 210, 160, 'Oficina Mecânica', 0x242830, 0x485266);
    this.buildCrate(2540, 1860, 80, 65, 'Peças');
    this.buildCrate(2820, 1860, 75, 65, 'Ferramentas');

    // Obstáculos adicionais nos corredores principais
    this.buildCrate(1050, 1000, 75, 75, 'Carga Aberta 1');
    this.buildCrate(1950, 1000, 75, 75, 'Carga Aberta 2');
    this.buildPillar(1500, 760, 80, 'Coluna Norte');
    this.buildPillar(1500, 1240, 80, 'Coluna Sul');
  }

  private buildWall(x: number, y: number, width: number, height: number): void {
    const rect = this.add.rectangle(x, y, width, height, 0x222631);
    rect.setStrokeStyle(2, 0x41475b);
    rect.setDepth(1);
    this.walls.add(rect);
  }

  private buildStructure(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    fillColor = 0x2b303e,
    strokeColor = 0x59627e
  ): void {
    const shadow = this.add.rectangle(x + 8, y + 8, width, height, 0x050608, 0.6);
    shadow.setDepth(1);

    const rect = this.add.rectangle(x, y, width, height, fillColor);
    rect.setStrokeStyle(3, strokeColor);
    rect.setDepth(2);

    const innerW = Math.max(width - 16, 4);
    const innerH = Math.max(height - 16, 4);
    const innerRect = this.add.rectangle(x, y, innerW, innerH, 0x1f232e);
    innerRect.setStrokeStyle(1, 0x3d4355);
    innerRect.setDepth(2);

    if (label) {
      this.add.text(x, y, label, {
        fontSize: '11px',
        color: '#8c95af',
        fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(3);
    }

    this.obstacles.add(rect);
  }

  private buildContainer(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    color = 0x1e3a5f
  ): void {
    const shadow = this.add.rectangle(x + 7, y + 7, width, height, 0x050608, 0.6);
    shadow.setDepth(1);

    const rect = this.add.rectangle(x, y, width, height, color);
    rect.setStrokeStyle(2, 0x4a6572);
    rect.setDepth(2);

    // Linhas estrias de relevo do container
    const isHorizontal = width > height;
    const step = 24;
    if (isHorizontal) {
      for (let lx = x - width / 2 + step; lx < x + width / 2; lx += step) {
        const line = this.add.rectangle(lx, y, 3, height - 10, 0x000000, 0.25);
        line.setDepth(2);
      }
    } else {
      for (let ly = y - height / 2 + step; ly < y + height / 2; ly += step) {
        const line = this.add.rectangle(x, ly, width - 10, 3, 0x000000, 0.25);
        line.setDepth(2);
      }
    }

    if (label) {
      this.add.text(x, y, label, {
        fontSize: '10px',
        color: '#e0e0e0',
        fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(3);
    }

    this.obstacles.add(rect);
  }

  private buildPillar(x: number, y: number, size = 80, label?: string): void {
    const shadow = this.add.rectangle(x + 5, y + 5, size, size, 0x050608, 0.6);
    shadow.setDepth(1);

    const rect = this.add.rectangle(x, y, size, size, 0x373e4d);
    rect.setStrokeStyle(3, 0x67748e);
    rect.setDepth(2);

    const cap = this.add.rectangle(x, y, size - 16, size - 16, 0x242833);
    cap.setStrokeStyle(1, 0x4a556b);
    cap.setDepth(2);

    if (label) {
      this.add.text(x, y, label, {
        fontSize: '9px',
        color: '#9aa0a6',
        fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(3);
    }

    this.obstacles.add(rect);
  }

  private buildCrate(x: number, y: number, width = 70, height = 70, label?: string): void {
    const shadow = this.add.rectangle(x + 4, y + 4, width, height, 0x050608, 0.5);
    shadow.setDepth(1);

    const rect = this.add.rectangle(x, y, width, height, 0x3f352b);
    rect.setStrokeStyle(2, 0x6e5d4a);
    rect.setDepth(2);

    const cross1 = this.add.rectangle(x, y, width - 8, 3, 0x2b241d);
    cross1.setDepth(2);
    const cross2 = this.add.rectangle(x, y, 3, height - 8, 0x2b241d);
    cross2.setDepth(2);

    if (label) {
      this.add.text(x, y, label, {
        fontSize: '9px',
        color: '#c9b79c',
        fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(3);
    }

    this.obstacles.add(rect);
  }

  private buildBarricade(x: number, y: number, width: number, height: number, label?: string): void {
    const shadow = this.add.rectangle(x + 4, y + 4, width, height, 0x050608, 0.5);
    shadow.setDepth(1);

    const rect = this.add.rectangle(x, y, width, height, 0x42382e);
    rect.setStrokeStyle(2, 0xa57e3f);
    rect.setDepth(2);

    if (label) {
      this.add.text(x, y, label, {
        fontSize: '9px',
        color: '#f0c674',
        fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(3);
    }

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
    this.player = this.physics.add.sprite(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'survivor', 0);
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

    this.updateKillerHitbox();
  }

  /**
   * Criação do Killer (Assassino):
   * - Variante do próprio asset do sobrevivente ('survivor.png')
   * - Tonalidade avermelhada e sombria via setTint(0xff3333)
   * - Escala 28% maior que o Player para presença imponente
   * - Hitbox proporcional e centralizada em (0.5, 0.5)
   */
  private createKiller(): void {
    this.killer = this.physics.add.sprite(1500, 480, 'survivor', 0);
    this.killer.setDepth(10);
    this.killer.setOrigin(0.5, 0.5);

    // Tonalidade avermelhada sombria (sangue)
    this.killer.setTint(0xff3333);

    this.updateKillerHitbox();
    this.killer.setCollideWorldBounds(true);

    // Gráfico de depuração de visão (área de detecção e perda)
    this.killerVisionGraphic = this.add.graphics();
    this.killerVisionGraphic.setDepth(5);
  }

  public updateKillerHitbox(): void {
    if (!this.killer || !this.killer.body) return;

    // Escala cerca de 28% maior que a do Player (ameaça imponente)
    const killerScale = this.debugSettings.playerScale * 1.28;
    this.killer.setScale(killerScale);

    const frameW = survivorMeta.frameWidth || 704;
    const frameH = survivorMeta.frameHeight || 768;
    const radius = this.debugSettings.hitboxRadius;

    const offsetX = (frameW * 0.5) - radius;
    const offsetY = (frameH * 0.5) - radius;

    const body = this.killer.body as Phaser.Physics.Arcade.Body;
    body.setCircle(radius, offsetX, offsetY);
  }

  /**
   * Interface de Aviso de Ataque (fixa na tela do jogador)
   */
  private createAttackUI(): void {
    this.attackAlertUI = this.add.container(640, 50);
    this.attackAlertUI.setScrollFactor(0);
    this.attackAlertUI.setDepth(200);
    this.attackAlertUI.setAlpha(0);

    const bg = this.add.rectangle(0, 0, 360, 44, 0x3d0b0b, 0.92);
    bg.setStrokeStyle(2, 0xff3333);

    const text = this.add.text(0, 0, '⚠️ VOCÊ FOI ATACADO PELO ASSASSINO!', {
      fontSize: '13px',
      color: '#ffdddd',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    this.attackAlertUI.add([bg, text]);
  }

  private handleKillerAttack(): void {
    const now = this.time.now;
    if (now - this.lastAttackTime < 1400) return; // Cooldown de 1.4s para evitar spam
    this.lastAttackTime = now;

    // Flash vermelho rápido na tela
    this.cameras.main.flash(260, 220, 20, 20);

    // Exibir aviso no topo
    this.showAttackToast();
  }

  private showAttackToast(): void {
    if (!this.attackAlertUI) return;

    this.attackAlertUI.setAlpha(1);
    this.tweens.killTweensOf(this.attackAlertUI);

    this.tweens.add({
      targets: this.attackAlertUI,
      alpha: 0,
      duration: 800,
      delay: 1400,
      ease: 'Power2'
    });
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

    if (this.killer) {
      this.physics.add.collider(this.killer, this.walls);
      this.physics.add.collider(this.killer, this.obstacles);
      this.physics.add.collider(this.killer, this.player, this.handleKillerAttack, undefined, this);
    }
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
      .add(this.debugSettings, 'cameraZoom', 0.4, 1.5, 0.05)
      .name('Camera Zoom')
      .onChange((val: number) => {
        this.debugSettings.cameraZoom = Number(val) || 1.0;
        this.cameras.main.setZoom(this.debugSettings.cameraZoom);
      });
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

    const killerFolder = this.gui.addFolder('Killer (IA)');
    killerFolder
      .add(this.debugSettings, 'killerSpeed', 80, 300, 5)
      .name('Killer Speed');
    killerFolder
      .add(this.debugSettings, 'detectionRadius', 100, 600, 10)
      .name('Detection Radius');
    killerFolder
      .add(this.debugSettings, 'showKillerVision')
      .name('Debug Visão');
    killerFolder
      .add(this.debugSettings, 'killerAiEnabled')
      .name('Ativar IA');
    killerFolder.open();

    const monitorFolder = this.gui.addFolder('Telemetria em Tempo Real');
    monitorFolder.add(this.monitorState, 'worldSize').name('Tamanho Mapa').listen().disable();
    monitorFolder.add(this.monitorState, 'killerState').name('Estado Killer').listen().disable();
    monitorFolder.add(this.monitorState, 'killerDist').name('Dist. Killer').listen().disable();
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
        if (typeof parsed.cameraZoom === 'number' && !isNaN(parsed.cameraZoom)) {
          this.debugSettings.cameraZoom = parsed.cameraZoom;
        }
        if (typeof parsed.killerSpeed === 'number' && !isNaN(parsed.killerSpeed)) {
          this.debugSettings.killerSpeed = parsed.killerSpeed;
        }
        if (typeof parsed.detectionRadius === 'number' && !isNaN(parsed.detectionRadius)) {
          this.debugSettings.detectionRadius = parsed.detectionRadius;
        }
        if (typeof parsed.showKillerVision === 'boolean') {
          this.debugSettings.showKillerVision = parsed.showKillerVision;
        }
        if (typeof parsed.killerAiEnabled === 'boolean') {
          this.debugSettings.killerAiEnabled = parsed.killerAiEnabled;
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

    if (this.cameras?.main) {
      this.cameras.main.setZoom(this.debugSettings.cameraZoom);
    }

    if (this.gui) {
      this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    }
  }

  update(_time: number, delta: number): void {
    this.handleMovement();
    this.handleRotation(delta);
    this.handleKillerAI(delta);
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

  /**
   * Inteligência Artificial do Killer (FSM):
   * - PATROL: caminha lentamente até waypoints predefinidos / aleatórios com animação 'walk'.
   * - CHASE: se distância até o Player < Detection Radius, corre perseguindo com animação 'run'.
   * - LOSE: se distância > 1.5x Detection Radius, desiste e retorna para PATROL.
   */
  private handleKillerAI(delta: number): void {
    if (!this.killer || !this.killer.body) return;

    // Se IA desativada pelo painel de debug, pausar completamente o Killer
    if (!this.debugSettings.killerAiEnabled) {
      this.killer.setVelocity(0, 0);
      if (this.killer.anims.isPlaying) {
        this.killer.anims.stop();
        this.killer.setFrame(0);
      }
      this.updateKillerVisionGraphic();
      return;
    }

    const distToPlayer = Phaser.Math.Distance.Between(
      this.killer.x,
      this.killer.y,
      this.player.x,
      this.player.y
    );

    this.monitorState.killerDist = `${Math.round(distToPlayer)}px`;

    const detectionRadius = this.debugSettings.detectionRadius;
    const loseRadius = detectionRadius * 1.5;

    // Transição de estados da FSM
    if (this.killerState === 'PATROL') {
      if (distToPlayer <= detectionRadius) {
        this.killerState = 'CHASE';
      }
    } else if (this.killerState === 'CHASE') {
      if (distToPlayer > loseRadius) {
        this.killerState = 'PATROL';
        this.patrolWaitTimer = 0;
        this.pickNewPatrolTarget();
      }
    }

    this.monitorState.killerState = this.killerState;

    if (this.killerState === 'CHASE') {
      // Estado CHASE: perseguir o Player em alta velocidade com animação 'run'
      const dx = this.player.x - this.killer.x;
      const dy = this.player.y - this.killer.y;
      const moveVec = new Phaser.Math.Vector2(dx, dy).normalize();
      const speed = this.debugSettings.killerSpeed;

      this.killer.setVelocity(moveVec.x * speed, moveVec.y * speed);

      if (!this.killer.anims.isPlaying || this.killer.anims.currentAnim?.key !== 'run') {
        this.killer.anims.play('run', true);
      }

      // Rotação suave apontando na direção do Player (- Math.PI / 2 porque os frames olham para sul)
      const targetAngle = Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - Math.PI / 2);
      this.rotateKillerTowards(targetAngle, delta, 14);
    } else {
      // Estado PATROL: patrulha lenta e cautelosa com animação 'walk'
      const dx = this.patrolTarget.x - this.killer.x;
      const dy = this.patrolTarget.y - this.killer.y;
      const distToTarget = Math.sqrt(dx * dx + dy * dy);

      if (distToTarget < 35) {
        // Chegou ao waypoint temporário: aguarda brevemente
        this.killer.setVelocity(0, 0);
        if (this.killer.anims.isPlaying) {
          this.killer.anims.stop();
          this.killer.setFrame(0);
        }

        this.patrolWaitTimer += delta;
        if (this.patrolWaitTimer >= 1800) {
          this.patrolWaitTimer = 0;
          this.pickNewPatrolTarget();
        }
      } else {
        const moveVec = new Phaser.Math.Vector2(dx, dy).normalize();
        const patrolSpeed = this.debugSettings.killerSpeed * 0.45; // Caminhada lenta de patrulha

        this.killer.setVelocity(moveVec.x * patrolSpeed, moveVec.y * patrolSpeed);

        if (!this.killer.anims.isPlaying || this.killer.anims.currentAnim?.key !== 'walk') {
          this.killer.anims.play('walk', true);
        }

        const targetAngle = Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - Math.PI / 2);
        this.rotateKillerTowards(targetAngle, delta, 5);
      }
    }

    this.updateKillerVisionGraphic();
  }

  private pickNewPatrolTarget(): void {
    const randomWp = Phaser.Utils.Array.GetRandom(this.patrolWaypoints);
    const offsetX = Phaser.Math.Between(-30, 30);
    const offsetY = Phaser.Math.Between(-30, 30);
    this.patrolTarget.set(randomWp.x + offsetX, randomWp.y + offsetY);
  }

  private rotateKillerTowards(targetAngle: number, delta: number, turnSpeed: number): void {
    let currentAngle = this.killer.rotation;
    if (typeof currentAngle !== 'number' || isNaN(currentAngle) || !isFinite(currentAngle)) {
      currentAngle = targetAngle;
      this.killer.rotation = targetAngle;
    }
    currentAngle = Phaser.Math.Angle.Wrap(currentAngle);

    const diff = Phaser.Math.Angle.Wrap(targetAngle - currentAngle);
    const deltaSec = Math.min(delta / 1000, 0.1);
    const maxStep = turnSpeed * deltaSec;

    if (Math.abs(diff) <= maxStep) {
      this.killer.rotation = targetAngle;
    } else {
      this.killer.rotation = Phaser.Math.Angle.Wrap(currentAngle + Math.sign(diff) * maxStep);
    }
  }

  /**
   * Renderização do Debug de Visão (Detection Radius e Lose Radius)
   */
  private updateKillerVisionGraphic(): void {
    if (!this.killerVisionGraphic) return;
    this.killerVisionGraphic.clear();

    if (!this.debugSettings.showKillerVision || !this.killer) return;

    const kx = this.killer.x;
    const ky = this.killer.y;
    const detectionRadius = this.debugSettings.detectionRadius;
    const loseRadius = detectionRadius * 1.5;

    // Círculo externo de perda de rastro (LOSE)
    this.killerVisionGraphic.lineStyle(1.5, 0xf0c674, 0.25);
    this.killerVisionGraphic.strokeCircle(kx, ky, loseRadius);

    if (this.killerState === 'CHASE') {
      // Círculo de Detecção em alerta vermelho sangue
      this.killerVisionGraphic.fillStyle(0xff3333, 0.1);
      this.killerVisionGraphic.fillCircle(kx, ky, detectionRadius);
      this.killerVisionGraphic.lineStyle(2, 0xff2222, 0.7);
      this.killerVisionGraphic.strokeCircle(kx, ky, detectionRadius);

      // Linha de mira / perseguição direta até o jogador
      this.killerVisionGraphic.lineStyle(2, 0xff2222, 0.6);
      this.killerVisionGraphic.lineBetween(kx, ky, this.player.x, this.player.y);
    } else {
      // Círculo de Detecção em patrulha (laranja/âmbar sutil)
      this.killerVisionGraphic.fillStyle(0xff8833, 0.05);
      this.killerVisionGraphic.fillCircle(kx, ky, detectionRadius);
      this.killerVisionGraphic.lineStyle(1.5, 0xff8833, 0.4);
      this.killerVisionGraphic.strokeCircle(kx, ky, detectionRadius);

      // Linha sutil até o ponto de patrulha
      this.killerVisionGraphic.lineStyle(1, 0x88bbff, 0.25);
      this.killerVisionGraphic.lineBetween(kx, ky, this.patrolTarget.x, this.patrolTarget.y);
    }
  }
}
