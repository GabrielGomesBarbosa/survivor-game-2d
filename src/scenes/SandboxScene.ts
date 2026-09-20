import Phaser from 'phaser';
import GUI from 'lil-gui';
import EasyStar from 'easystarjs';
import survivorMeta from '../assets/survivor.json';
import generatorMeta from '../assets/generator.json';

export const WORLD_WIDTH = 2560;
export const WORLD_HEIGHT = 1920;

export interface GeneratorData {
  id: string;
  name: string;
  roomName: string;
  x: number;
  y: number;
  progress: number; // 0 a 100
  isCompleted: boolean;
  interactionRadius: number; // ~95px
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  progressBarFill: Phaser.GameObjects.Rectangle;
  progressText: Phaser.GameObjects.Text;
  floorZone: Phaser.GameObjects.Arc;
}

class SoundFX {
  private static ctx: AudioContext | null = null;

  private static getContext(): AudioContext | null {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  static playWarningCue(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.28);
    } catch (_) {}
  }

  static playSuccess(isGreat: boolean): void {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(isGreat ? 1174.66 : 987.77, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch (_) {}
  }

  static playExplosion(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(28, ctx.currentTime + 0.5);
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch (_) {}
  }

  static playCompletion(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.08);
        gain.gain.setValueAtTime(0.18, ctx.currentTime + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.08 + 0.65);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.08);
        osc.stop(ctx.currentTime + i * 0.08 + 0.65);
      });
    } catch (_) {}
  }
}

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
  showAStarPath: boolean;
  killerAiEnabled: boolean;
  // Generator & Skill Check Settings
  generatorRepairTime: number; // Tempo total para 0 a 100% em segundos (padrão: 12s)
  skillCheckFrequency: number; // 1 (raro) a 5 (frequente), padrão: 3
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
  showAStarPath: true,
  killerAiEnabled: true,
  generatorRepairTime: 12,
  skillCheckFrequency: 3
};

export class SandboxScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private killer!: Phaser.Physics.Arcade.Sprite;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private obstacles!: Phaser.Physics.Arcade.StaticGroup;

  // Killer AI (FSM) & Pathfinding
  private killerState: 'PATROL' | 'CHASE' = 'PATROL';
  private patrolTarget: Phaser.Math.Vector2 = new Phaser.Math.Vector2(1280, 480);
  private patrolWaitTimer = 0;
  private killerVisionGraphic!: Phaser.GameObjects.Graphics;
  private aStarGraphic!: Phaser.GameObjects.Graphics;
  private lastAttackTime = 0;
  private attackAlertUI!: Phaser.GameObjects.Container;
  private attackAlertText!: Phaser.GameObjects.Text;

  // EasyStar.js A* Pathfinding
  private easystar!: EasyStar.js;
  private navGrid: number[][] = [];
  private currentChasePath: Array<{ x: number; y: number }> = [];
  private currentPathIndex = 0;
  private pathRecalcTimer = 0;
  private hasDirectLOS = false;
  private patrolPath: Array<{ x: number; y: number }> = [];
  private patrolPathIndex = 0;

  // Trava de integridade contra tunelamento em paredes
  private lastSafePlayerX = 1280;
  private lastSafePlayerY = 960;

  // Pontos de patrulha navegáveis e desobstruídos pelo complexo (corredores de 192px/256px e salas amplas)
  private patrolWaypoints: Array<{ x: number; y: number }> = [
    { x: 1280, y: 480 },  // Corredor Norte Centro
    { x: 720, y: 480 },   // Corredor Norte / Oeste (cruzamento)
    { x: 1840, y: 480 },  // Corredor Norte / Leste (cruzamento)
    { x: 720, y: 720 },   // Anel Oeste Superior
    { x: 720, y: 960 },   // Corredor Oeste Centro
    { x: 720, y: 1200 },  // Anel Oeste Inferior
    { x: 1840, y: 720 },  // Anel Leste Superior
    { x: 1840, y: 960 },  // Corredor Leste Centro
    { x: 1840, y: 1200 }, // Anel Leste Inferior
    { x: 1280, y: 1440 }, // Corredor Sul Centro
    { x: 720, y: 1440 },  // Corredor Sul / Oeste (cruzamento)
    { x: 1840, y: 1440 }, // Corredor Sul / Leste (cruzamento)
    { x: 320, y: 960 },   // Enfermaria (Ala Oeste)
    { x: 2240, y: 960 },  // Gerador A (Ala Leste)
    { x: 1280, y: 960 },  // Recepção Central
    { x: 1280, y: 224 },  // Ala de Contenção (Norte)
    { x: 1280, y: 1680 }  // Setor de Manutenção (Sul)
  ];

  // Inputs
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private keyE!: Phaser.Input.Keyboard.Key;
  private keySpace!: Phaser.Input.Keyboard.Key;
  private keyShift!: Phaser.Input.Keyboard.Key;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  // Geradores & Interação (DBD Prototype)
  private generators: GeneratorData[] = [];
  private activeNearbyGen: GeneratorData | null = null;
  private isRepairing = false;
  private repairStaggerTimer = 0;
  private repairPromptUI!: Phaser.GameObjects.Container;
  private repairPromptText!: Phaser.GameObjects.Text;
  private repairProgressBarFill!: Phaser.GameObjects.Rectangle;
  private repairPercentText!: Phaser.GameObjects.Text;

  // Skill Check (QTE)
  private isSkillCheckActive = false;
  private skillCheckNeedleAngle = 0;
  private skillCheckZoneStart = 120;
  private skillCheckZoneSize = 42;
  private skillCheckGreatSize = 12;
  private skillCheckContainer!: Phaser.GameObjects.Container;
  private skillCheckDialGraphic!: Phaser.GameObjects.Graphics;
  private skillCheckNeedleGraphic!: Phaser.GameObjects.Graphics;
  private skillCheckFeedbackText!: Phaser.GameObjects.Text;
  private skillCheckNextTimer = 0;
  private isSkillCheckWarning = false;
  private noiseAlertGraphic!: Phaser.GameObjects.Graphics;
  private noiseAlertTimer = 0;
  private noiseAlertPos = { x: 0, y: 0 };
  private hudGensVal: HTMLElement | null = null;

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
    playerX: '1280',
    playerY: '960',
    worldSize: '2560 x 1920',
    killerState: 'PATROL',
    killerDist: '0px',
    fps: 0
  };

  private gui!: GUI;
  private hudFpsVal: HTMLElement | null = null;
  private hudKillerState: HTMLElement | null = null;
  private hudKillerDist: HTMLElement | null = null;
  private hudFpsDot: HTMLElement | null = null;

  private onWindowResize = (): void => {
    this.scale.refresh();
  };

  // Salvar última posição válida do ponteiro para evitar rotações espúrias
  private lastTargetAngle = 0;

  // Fallback de teclas globais para garantir movimentação ininterrupta mesmo ao interagir com o lil-gui
  private activeKeys: Set<string> = new Set();

  private onWindowKeyDown = (e: KeyboardEvent): void => {
    this.activeKeys.add(e.code);

    if (e.code === 'Space') {
      if (this.isSkillCheckActive) {
        e.preventDefault();
        this.onSkillCheckInput();
      }
    }

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

    // Carregar spritesheet do Gerador DBD (3 frames horizontais: 0: inativo, 1: reparando, 2: concluído)
    const genFrameWidth = generatorMeta.frameWidth || 960;
    const genFrameHeight = generatorMeta.frameHeight || 1536;

    this.load.spritesheet('generator', 'assets/generator.png', {
      frameWidth: genFrameWidth,
      frameHeight: genFrameHeight
    });
  }

  create(): void {
    this.createEnvironment();
    this.createGenerators();
    this.createAnimations();
    this.createPlayer();
    this.createKiller();
    this.createAttackUI();
    this.createRepairPromptUI();
    this.createSkillCheckUI();
    this.setupCamera();
    this.setupInput();
    this.setupCollisions();
    this.setupDebugPanel();

    // Gráficos de Debug para Rota A*
    this.aStarGraphic = this.add.graphics();
    this.aStarGraphic.setDepth(6);

    // Gráficos de Notificação de Ruído (Explosão de Geradores DBD)
    this.noiseAlertGraphic = this.add.graphics();
    this.noiseAlertGraphic.setDepth(9);

    // Configuração anti-tunelamento para física de alta precisão
    this.physics.world.OVERLAP_BIAS = 16;
    this.physics.world.TILE_BIAS = 32;

    // Monitoramento contínuo pós-física para garantir que o Player nunca atravesse paredes
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, () => {
      this.enforcePlayerWallBounds();
    });

    // Sincronizar visualização de física com a configuração carregada do localStorage
    this.physics.world.drawDebug = this.debugSettings.showPhysicsDebug;

    // Garantir foco direto e acessibilidade de teclado no canvas do jogo
    if (this.game.canvas) {
      this.game.canvas.setAttribute('tabindex', '0');
      this.game.canvas.style.outline = 'none';
      this.game.canvas.addEventListener('pointerdown', () => {
        this.game.canvas.focus();
      });
      const viewport = document.getElementById('game-viewport');
      if (viewport) {
        viewport.addEventListener('pointerdown', () => {
          this.game.canvas.focus();
        });
      }
    }

    window.addEventListener('resize', this.onWindowResize);

    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', this.onWindowKeyDown, true);
      window.removeEventListener('keyup', this.onWindowKeyUp, true);
      window.removeEventListener('blur', this.onWindowBlur);
      window.removeEventListener('resize', this.onWindowResize);
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
   * Cenário Estruturado - Instalação de Pesquisa / Asilo Abandonado:
   * - Malha lógica baseada em blocos de 64x64 pixels (40 colunas x 30 linhas = 2560x1920).
   * - Vão mínimo de passagem: NENHUM corredor ou porta com menos de 192px (3 blocos) a 256px (4 blocos),
   *   garantindo passagem 100% livre e fluida para Survivor (diâmetro ~133px) e Killer (diâmetro ~170px).
   * - Fusão retangular 2D gananciosa (Greedy 2D Rectangle Merging) que elimina quinas internas,
   *   arestas sobrepostas e costuras na física Arcade.
   * - Sala Central (Recepção: 768x640px) com 4 portas amplas (256px e 192px).
   * - Anel de Corredores de Looping contínuo ao redor do bloco central.
   * - Duas Salas Anexas ("Enfermaria" e "Gerador A") com múltiplos acessos cada (sem becos sem saída).
   * - Ala de Contenção (Spawn do Killer) ao norte com rota direta para o anel.
   */
  private createEnvironment(): void {
    // 1. Chão com grid quadriculado escuro cobrindo todo o mundo 2560x1920
    const gridBg = this.add.grid(
      WORLD_WIDTH / 2,
      WORLD_HEIGHT / 2,
      WORLD_WIDTH,
      WORLD_HEIGHT,
      64,
      64,
      0x12141a,
      1,
      0x1f232d,
      0.8
    );
    gridBg.setDepth(0);

    // Linhas mestras estruturais a cada 256px (4 blocos)
    const majorGrid = this.add.grid(
      WORLD_WIDTH / 2,
      WORLD_HEIGHT / 2,
      WORLD_WIDTH,
      WORLD_HEIGHT,
      256,
      256,
      0x000000,
      0,
      0x2c3342,
      0.5
    );
    majorGrid.setDepth(0);

    // 2. Inicializar grupos de física estática
    this.walls = this.physics.add.staticGroup();
    this.obstacles = this.physics.add.staticGroup();

    // 3. Montar malha lógica da planta baixa (40 colunas x 30 linhas)
    const COLS = 40;
    const ROWS = 30;
    const TILE_SIZE = 64;

    const grid: string[][] = [];
    for (let r = 0; r < ROWS; r++) {
      grid[r] = new Array(COLS).fill('.');
    }

    // 3.1 Perímetro externo da instalação
    for (let c = 0; c < COLS; c++) {
      grid[0][c] = '#';
      grid[ROWS - 1][c] = '#';
    }
    for (let r = 0; r < ROWS; r++) {
      grid[r][0] = '#';
      grid[r][COLS - 1] = '#';
    }

    // 3.2 Bloco Central (Recepção - Cols 13..26, Rows 9..20)
    // Paredes Norte e Sul com portas amplas de 256px (Cols 18..21)
    for (let c = 13; c <= 26; c++) {
      if (c < 18 || c > 21) {
        grid[9][c] = '#';
        grid[20][c] = '#';
      }
    }
    // Paredes Oeste e Leste com portas amplas de 192px (Rows 14..16)
    for (let r = 9; r <= 20; r++) {
      if (r < 14 || r > 16) {
        grid[r][13] = '#';
        grid[r][26] = '#';
      }
    }

    // 3.3 Ala Oeste - Enfermaria (Cols 1..9, Rows 9..20)
    // Divisória com o Corredor Oeste (Col 9) com duas portas amplas de 192px (Rows 11..13 e Rows 16..18)
    for (let r = 9; r <= 20; r++) {
      if ((r >= 9 && r <= 10) || (r >= 14 && r <= 15) || (r >= 19 && r <= 20)) {
        grid[r][9] = '#';
      }
    }
    // Paredes Norte e Sul da Enfermaria com portas de 192px (Cols 4..6) para o anel de circulação
    for (let c = 1; c <= 9; c++) {
      if (c < 4 || c > 6) {
        grid[9][c] = '#';
        grid[20][c] = '#';
      }
    }
    // 3.3 Ala Oeste - Enfermaria & Gerador #2 (Cols 4..5, Rows 14..15: 128x128)
    for (let r = 14; r <= 15; r++) {
      for (let c = 4; c <= 5; c++) {
        grid[r][c] = 'G';
      }
    }

    // 3.4 Ala Leste - Usina & Gerador #1 (Cols 30..38, Rows 9..20)
    // Divisória com o Corredor Leste (Col 30) com duas portas amplas de 192px (Rows 11..13 e Rows 16..18)
    for (let r = 9; r <= 20; r++) {
      if ((r >= 9 && r <= 10) || (r >= 14 && r <= 15) || (r >= 19 && r <= 20)) {
        grid[r][30] = '#';
      }
    }
    // Paredes Norte e Sul do Gerador com portas de 192px (Cols 33..35) para o anel de circulação
    for (let c = 30; c <= 38; c++) {
      if (c < 33 || c > 35) {
        grid[9][c] = '#';
        grid[20][c] = '#';
      }
    }
    // Bloco do Gerador Principal #1 (Cols 34..35, Rows 14..15: 128x128 com 192px de folga ao redor)
    for (let r = 14; r <= 15; r++) {
      for (let c = 34; c <= 35; c++) {
        grid[r][c] = 'G';
      }
    }

    // 3.5 Ala Norte - Contenção (Spawn do Killer: Cols 13..26, Rows 1..5)
    for (let r = 1; r <= 5; r++) {
      grid[r][13] = '#';
      grid[r][26] = '#';
    }
    // Portão de saída aberto de 256px diretamente para o Corredor Norte (Cols 18..21)
    for (let c = 13; c <= 26; c++) {
      if (c < 18 || c > 21) {
        grid[5][c] = '#';
      }
    }
    // Divisórias dos setores Noroeste e Nordeste com portas amplas (Cols 4..6 e Cols 33..35)
    for (let c = 1; c <= 9; c++) {
      if (c < 4 || c > 6) grid[5][c] = '#';
    }
    for (let c = 30; c <= 38; c++) {
      if (c < 33 || c > 35) grid[5][c] = '#';
    }

    // 3.6 Ala Sul - Manutenção & Depósito (Cols 13..26, Rows 24..28)
    for (let r = 24; r <= 28; r++) {
      grid[r][13] = '#';
      grid[r][26] = '#';
    }
    // Portão de acesso de 256px diretamente para o Corredor Sul (Cols 18..21)
    for (let c = 13; c <= 26; c++) {
      if (c < 18 || c > 21) {
        grid[24][c] = '#';
      }
    }
    // Divisórias dos setores Sudoeste e Sudeste com portas amplas
    for (let c = 1; c <= 9; c++) {
      if (c < 4 || c > 6) grid[24][c] = '#';
    }
    for (let c = 30; c <= 38; c++) {
      if (c < 33 || c > 35) grid[24][c] = '#';
    }
    // Bloco do Gerador #3 (Cols 19..20, Rows 25..26: 128x128 com ampla folga)
    for (let r = 25; r <= 26; r++) {
      for (let c = 19; c <= 20; c++) {
        grid[r][c] = 'G';
      }
    }

    // 4. Algoritmo Ganancioso de Fusão Retangular 2D (Greedy 2D Rect Merger)
    // Reduz centenas de blocos em retângulos contíguos sem costuras internas nem quinas sobrepostas
    const visited: boolean[][] = [];
    for (let r = 0; r < ROWS; r++) {
      visited[r] = new Array(COLS).fill(false);
    }

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] === '#' && !visited[r][c]) {
          // Encontra a largura máxima contígua
          let w = 0;
          while (c + w < COLS && grid[r][c + w] === '#' && !visited[r][c + w]) {
            w++;
          }

          // Encontra a altura máxima com essa largura
          let h = 1;
          while (r + h < ROWS) {
            let fullRow = true;
            for (let k = 0; k < w; k++) {
              if (grid[r + h][c + k] !== '#' || visited[r + h][c + k]) {
                fullRow = false;
                break;
              }
            }
            if (!fullRow) break;
            h++;
          }

          // Marca como visitado
          for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
              visited[r + dy][c + dx] = true;
            }
          }

          const pixelW = w * TILE_SIZE;
          const pixelH = h * TILE_SIZE;
          const pixelX = c * TILE_SIZE + pixelW / 2;
          const pixelY = r * TILE_SIZE + pixelH / 2;

          this.createMergedWall(pixelX, pixelY, pixelW, pixelH);
        }
      }
    }

    // 5. Configurar grelha lógica para EasyStar.js (0 = livre, 1 = parede/gerador intransitável)
    this.navGrid = [];
    for (let r = 0; r < ROWS; r++) {
      this.navGrid[r] = new Array(COLS);
      for (let c = 0; c < COLS; c++) {
        this.navGrid[r][c] = (grid[r][c] === '#' || grid[r][c] === 'G') ? 1 : 0;
      }
    }

    this.easystar = new EasyStar.js();
    this.easystar.setGrid(this.navGrid);
    this.easystar.setAcceptableTiles([0]);
    this.easystar.enableDiagonals();
    (this.easystar as any).disableCornerCutting?.();
    (this.easystar as any).enableSync?.();
    this.easystar.setIterationsPerCalculation(10000);

    // 6. Ambientação Visual, Sinalização Tática e Elementos de Orientação
    this.createFacilitySignage();
  }

  private createMergedWall(x: number, y: number, width: number, height: number): void {
    // Sombra projetada
    const shadow = this.add.rectangle(x + 5, y + 5, width, height, 0x07090e, 0.45);
    shadow.setDepth(1);

    // Parede estrutural sólida
    const wall = this.add.rectangle(x, y, width, height, 0x222633);
    wall.setStrokeStyle(2, 0x4f586f);
    wall.setDepth(2);
    this.walls.add(wall);

    const body = wall.body as Phaser.Physics.Arcade.StaticBody;
    if (body) {
      body.updateFromGameObject();
    }

    // Chanfro superior / relevo arquitetônico
    if (width > 12 && height > 12) {
      const capW = Math.max(width - 4, 4);
      const capH = Math.max(height - 4, 4);
      const cap = this.add.rectangle(x, y - 2, capW, capH, 0x292f3e);
      cap.setStrokeStyle(1, 0x3d4559);
      cap.setDepth(2);
    }
  }

  private createFacilitySignage(): void {
    // ----------------------------------------------------
    // SALA CENTRAL (Recepção - Spawn do Survivor: 1280, 960)
    // ----------------------------------------------------
    const centerDecal = this.add.circle(1280, 960, 110, 0x191c25, 0.6);
    centerDecal.setStrokeStyle(2, 0x3d465c, 0.5);
    centerDecal.setDepth(1);

    this.add.text(1280, 720, 'SALA CENTRAL // RECEPÇÃO', {
      fontSize: '14px',
      color: '#8c9bb7',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(1);

    this.add.text(1280, 960, '⊕ PONTO DE SPAWN SEGURO\n4 SAÍDAS AMPLAS PARA O LOOPING', {
      fontSize: '11px',
      color: '#5c6982',
      align: 'center'
    }).setOrigin(0.5).setDepth(1);

    // ----------------------------------------------------
    // ALA OESTE (Enfermaria & Triagem: 320, 960)
    // ----------------------------------------------------
    this.add.text(320, 720, 'ALA OESTE // ENFERMARIA & TRIAGEM', {
      fontSize: '13px',
      color: '#709d87',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(1);

    this.add.text(320, 1200, '✚ SETOR MÉDICO - 3 ACESSOS AO CORREDOR', {
      fontSize: '10px',
      color: '#496b5c'
    }).setOrigin(0.5).setDepth(1);

    // ----------------------------------------------------
    // ALA LESTE (Usina de Energia: 2240, 960)
    // ----------------------------------------------------
    this.add.text(2240, 720, 'ALA LESTE // USINA ELÉTRICA', {
      fontSize: '13px',
      color: '#c99653',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(1);

    this.add.text(2240, 1200, '⚡ FORÇA AUXILIAR - 3 ACESSOS AO CORREDOR', {
      fontSize: '10px',
      color: '#8a6534'
    }).setOrigin(0.5).setDepth(1);

    // ----------------------------------------------------
    // ALA NORTE (Ala de Contenção - Spawn do Killer: 1280, 224)
    // ----------------------------------------------------
    this.add.text(1280, 100, 'ALA NORTE // CÂMARA DE CONTENÇÃO BIOLÓGICA', {
      fontSize: '13px',
      color: '#cc5555',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(1);

    this.add.text(1280, 224, '⚠️ ÁREA DE CONTENÇÃO - NÍVEL 4 // SPAWN DO ASSASSINO', {
      fontSize: '10px',
      color: '#8f3b3b',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(1);

    // Listras de advertência no portão de saída da contenção para o corredor (Y: 352)
    const gateStripe = this.add.rectangle(1280, 352, 256, 8, 0xcc3333, 0.5);
    gateStripe.setDepth(1);

    // ----------------------------------------------------
    // ALA SUL (Manutenção & Depósito: 1280, 1680)
    // ----------------------------------------------------
    this.add.text(1280, 1820, 'ALA SUL // SETOR DE MANUTENÇÃO & ENGENHARIA', {
      fontSize: '13px',
      color: '#8b949e',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(1);

    // ----------------------------------------------------
    // SINALIZAÇÃO DO ANEL DE CORREDORES (LOOPING DE FUGA)
    // ----------------------------------------------------
    this.add.text(1280, 480, '◀◀ CORREDOR NORTE (LOOPING) ▶▶', {
      fontSize: '11px',
      color: '#495267',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(1);

    this.add.text(1280, 1440, '◀◀ CORREDOR SUL (LOOPING) ▶▶', {
      fontSize: '11px',
      color: '#495267',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(1);

    this.add.text(720, 960, '▲\nC\nO\nR\nR\nE\nD\nO\nR\n\nO\nE\nS\nT\nE\n▼', {
      fontSize: '9px',
      color: '#424a5c',
      fontStyle: 'bold',
      align: 'center'
    }).setOrigin(0.5).setDepth(1);

    this.add.text(1840, 960, '▲\nC\nO\nR\nR\nE\nD\nO\nR\n\nL\nE\nS\nT\nE\n▼', {
      fontSize: '9px',
      color: '#424a5c',
      fontStyle: 'bold',
      align: 'center'
    }).setOrigin(0.5).setDepth(1);
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
    this.player.setBounce(0, 0);
    this.player.setPushable(false);

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
    // Spawn na Ala de Contenção (Norte) em área ampla e desobstruída
    this.killer = this.physics.add.sprite(1280, 224, 'survivor', 0);
    this.killer.setDepth(10);
    this.killer.setOrigin(0.5, 0.5);

    // Tonalidade avermelhada sombria (sangue)
    this.killer.setTint(0xff3333);

    this.updateKillerHitbox();
    this.killer.setCollideWorldBounds(true);
    this.killer.setBounce(0, 0);

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

    const bg = this.add.rectangle(0, 0, 420, 44, 0x3d0b0b, 0.92);
    bg.setStrokeStyle(2, 0xff3333);

    this.attackAlertText = this.add.text(0, 0, '⚠️ VOCÊ FOI ATACADO PELO ASSASSINO!', {
      fontSize: '13px',
      color: '#ffdddd',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    this.attackAlertUI.add([bg, this.attackAlertText]);
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

  public showNotificationToast(message: string, isDanger: boolean = true): void {
    if (!this.attackAlertUI || !this.attackAlertText) return;

    this.attackAlertText.setText(message);
    const bg = this.attackAlertUI.getAt(0) as Phaser.GameObjects.Rectangle;
    if (bg) {
      if (isDanger) {
        bg.setFillStyle(0x3d0b0b, 0.92);
        bg.setStrokeStyle(2, 0xff3333);
      } else {
        bg.setFillStyle(0x064e3b, 0.92);
        bg.setStrokeStyle(2, 0x10b981);
      }
    }

    this.attackAlertUI.setAlpha(1);
    this.tweens.killTweensOf(this.attackAlertUI);

    this.tweens.add({
      targets: this.attackAlertUI,
      alpha: 0,
      duration: 800,
      delay: 1600,
      ease: 'Power2'
    });
  }

  private showAttackToast(): void {
    this.showNotificationToast('⚠️ VOCÊ FOI ATACADO PELO ASSASSINO!', true);
  }

  /**
   * Tratamento de Colisão Sólida e Não-Elástica entre Killer e Player:
   * - Registra ataque com cooldown e aviso visual na tela.
   * - Elimina empurrão físico contínuo/elástico do Arcade Physics contra o cenário.
   * - O Player NUNCA é empurrado em direção às paredes pelo Killer.
   * - Anula velocidade frontal de aproximação de ambos, bloqueando a passagem sem tunelamento.
   */
  private handleKillerPlayerCollision(): void {
    if (!this.player || !this.killer || !this.player.body || !this.killer.body) return;

    this.handleKillerAttack();

    const playerRadius = this.debugSettings.hitboxRadius * this.debugSettings.playerScale;
    const killerRadius = this.debugSettings.hitboxRadius * this.debugSettings.playerScale * 1.28;
    const minDistance = playerRadius + killerRadius;

    const dx = this.killer.x - this.player.x;
    const dy = this.killer.y - this.player.y;
    const dist = Math.hypot(dx, dy);

    if (dist < minDistance) {
      const overlap = minDistance - dist;
      const nx = dist > 0.001 ? dx / dist : 0;
      const ny = dist > 0.001 ? dy / dist : -1;

      // Desloca o Killer suavemente para fora do Player sem empurrá-lo para dentro de paredes
      const targetKillerX = this.killer.x + nx * overlap;
      const targetKillerY = this.killer.y + ny * overlap;
      const kCol = Math.floor(targetKillerX / 64);
      const kRow = Math.floor(targetKillerY / 64);

      if (kRow >= 0 && kRow < 30 && kCol >= 0 && kCol < 40 && this.navGrid[kRow]?.[kCol] === 0) {
        this.killer.x = targetKillerX;
        this.killer.y = targetKillerY;
      }
      (this.killer.body as Phaser.Physics.Arcade.Body).updateCenter();

      // Anula componente de velocidade do Killer que aponta contra o Player
      const kBody = this.killer.body as Phaser.Physics.Arcade.Body;
      const kVel = kBody.velocity;
      const kSpeedTowards = kVel.x * (-nx) + kVel.y * (-ny);
      if (kSpeedTowards > 0) {
        kVel.x -= (-nx) * kSpeedTowards;
        kVel.y -= (-ny) * kSpeedTowards;
      }

      // Bloqueia avanço do Player contra o Killer (sólido intransponível)
      const pBody = this.player.body as Phaser.Physics.Arcade.Body;
      const pVel = pBody.velocity;
      const pSpeedTowards = pVel.x * nx + pVel.y * ny;
      if (pSpeedTowards > 0) {
        pVel.x -= nx * pSpeedTowards;
        pVel.y -= ny * pSpeedTowards;
      }
    }
  }

  /**
   * Guarda de Integridade Física do Jogador:
   * - Executada a cada frame no evento POST_UPDATE (após todo o processamento de física).
   * - Verifica a posição central do jogador na matriz de navegação (navGrid).
   * - Se o jogador estiver em uma célula livre, atualiza a última posição segura conhecida.
   * - Se detectar penetração em célula de parede ou fora dos limites do mapa, restaura instantaneamente
   *   a posição do jogador para a última posição segura com velocidade zerada, impedindo 100% o tunelamento.
   */
  private enforcePlayerWallBounds(): void {
    if (!this.player || !this.player.body || this.navGrid.length === 0) return;

    const col = Math.floor(this.player.x / 64);
    const row = Math.floor(this.player.y / 64);

    if (row >= 0 && row < 30 && col >= 0 && col < 40 && this.navGrid[row]?.[col] === 0) {
      this.lastSafePlayerX = this.player.x;
      this.lastSafePlayerY = this.player.y;
    } else {
      this.player.setPosition(this.lastSafePlayerX, this.lastSafePlayerY);
      this.player.setVelocity(0, 0);
      (this.player.body as Phaser.Physics.Arcade.Body).updateCenter();
    }
  }

  private setupInput(): void {
    if (this.input.keyboard) {
      this.keyW = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
      this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
      this.keyS = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
      this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
      this.keyE = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
      this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
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
      this.physics.add.overlap(
        this.killer,
        this.player,
        this.handleKillerPlayerCollision,
        undefined,
        this
      );
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
    const container = document.getElementById('debug-gui-container');
    this.gui = new GUI({
      container: container || undefined,
      title: '⚙️ Sandbox Debug',
      width: 350
    });

    const speedsFolder = this.gui.addFolder('Velocidades & Movimento');
    this.attachTooltip(
      speedsFolder.add(this.debugSettings, 'walkSpeed', 50, 400, 5).name('Walk Speed'),
      'Velocidade base de caminhada do Player em pixels/segundo (WASD normal).'
    );
    this.attachTooltip(
      speedsFolder.add(this.debugSettings, 'runSpeed', 100, 600, 5).name('Run Speed'),
      'Velocidade máxima de corrida ao pressionar a tecla Shift em pixels/segundo.'
    );
    this.attachTooltip(
      speedsFolder
        .add(this.debugSettings, 'turnSpeed', 1, 60, 1)
        .name('Turn Speed')
        .onChange((val: number) => {
          this.debugSettings.turnSpeed = Number(val) || 18;
        }),
      'Suavidade e velocidade de rotação do corpo em direção ao mouse.'
    );
    this.attachTooltip(
      speedsFolder
        .add(this.debugSettings, 'playerScale', 0.05, 1.0, 0.01)
        .name('Player Scale')
        .onChange((val: number) => {
          this.debugSettings.playerScale = Number(val) || 0.25;
          this.updatePlayerHitbox();
        }),
      'Fator multiplicador da escala gráfica e física do Player (0.25 calibrado para os corredores).'
    );
    this.attachTooltip(
      speedsFolder
        .add(this.debugSettings, 'instantTurn')
        .name('Giro Instantâneo')
        .onChange((val: boolean) => {
          this.debugSettings.instantTurn = Boolean(val);
        }),
      'Desativa o amortecimento angular, virando o corpo do Player instantaneamente para a mira.'
    );

    const animFolder = this.gui.addFolder('Taxa de Animações (FPS)');
    this.attachTooltip(
      animFolder
        .add(this.debugSettings, 'walkAnimFrameRate', 2, 24, 1)
        .name('Walk Anim FPS')
        .onChange((val: number) => {
          const anim = this.anims.get('walk');
          if (anim) anim.frameRate = val;
        }),
      'Taxa de quadros por segundo da animação de caminhada ("walk").'
    );
    this.attachTooltip(
      animFolder
        .add(this.debugSettings, 'runAnimFrameRate', 2, 30, 1)
        .name('Run Anim FPS')
        .onChange((val: number) => {
          const anim = this.anims.get('run');
          if (anim) anim.frameRate = val;
        }),
      'Taxa de quadros por segundo da animação de corrida rápida ("run").'
    );

    const displayFolder = this.gui.addFolder('Física & Renderização');
    this.attachTooltip(
      displayFolder
        .add(this.debugSettings, 'cameraZoom', 0.4, 1.5, 0.05)
        .name('Camera Zoom')
        .onChange((val: number) => {
          this.debugSettings.cameraZoom = Number(val) || 1.0;
          this.cameras.main.setZoom(this.debugSettings.cameraZoom);
        }),
      'Nível de aproximação/afastamento da câmera virtual centrada no sobrevivente.'
    );
    this.attachTooltip(
      displayFolder
        .add(this.debugSettings, 'hitboxRadius', 150, 350, 5)
        .name('Raio Base Hitbox')
        .onChange((val: number) => {
          this.debugSettings.hitboxRadius = Number(val) || 265;
          this.updatePlayerHitbox();
        }),
      'Raio base do círculo de colisão em pixels da textura original antes do scaling.'
    );
    this.attachTooltip(
      displayFolder
        .add(this.debugSettings, 'showPhysicsDebug')
        .name('Visualizar Colisão')
        .onChange((enabled: boolean) => {
          this.physics.world.drawDebug = enabled;
          if (!enabled && this.physics.world.debugGraphic) {
            this.physics.world.debugGraphic.clear();
          }
        }),
      'Desenha os contornos de colisão Arcade (hitbox circular do Player/Killer e quinas).'
    );

    const killerFolder = this.gui.addFolder('Killer (IA)');
    this.attachTooltip(
      killerFolder
        .add(this.debugSettings, 'killerSpeed', 80, 300, 5)
        .name('Killer Speed'),
      'Velocidade de corrida do Assassino no estado de perseguição (CHASE) em px/s.'
    );
    this.attachTooltip(
      killerFolder
        .add(this.debugSettings, 'detectionRadius', 100, 600, 10)
        .name('Detection Radius'),
      'Distância máxima de percepção na qual o Killer avista o Player e inicia perseguição.'
    );
    this.attachTooltip(
      killerFolder
        .add(this.debugSettings, 'showKillerVision')
        .name('Debug Visão'),
      'Renderiza círculos de detecção (laranja em patrulha, vermelho em perseguição) e linha de mira.'
    );
    this.attachTooltip(
      killerFolder
        .add(this.debugSettings, 'showAStarPath')
        .name('Mostrar Rota A*'),
      'Traça no mapa a linha ciano e balizas da rota contornando paredes calculada pelo A* (EasyStar).'
    );
    this.attachTooltip(
      killerFolder
        .add(this.debugSettings, 'killerAiEnabled')
        .name('Ativar IA'),
      'Habilita ou congela completamente a inteligência artificial e locomoção do Assassino.'
    );
    killerFolder.open();

    const monitorFolder = this.gui.addFolder('Telemetria em Tempo Real');
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'worldSize').name('Tamanho Mapa').listen().disable(),
      'Dimensões totais da instalação em pixels (largura x altura).'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'killerState').name('Estado Killer').listen().disable(),
      'Estado da máquina FSM do Killer: PATROL (patrulha cautelosa) ou CHASE (perseguição ativa).'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'killerDist').name('Dist. Killer').listen().disable(),
      'Distância linear euclidiana direta entre o Player e o Killer em pixels.'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'currentSpeed').name('Vel. Atual').listen().disable(),
      'Velocidade vetorial instantânea do Player em pixels por segundo.'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'isMoving').name('Movendo').listen().disable(),
      'Indica se o jogador está se deslocando no momento via WASD.'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'isSprinting').name('Sprint (Shift)').listen().disable(),
      'Indica se o jogador está correndo com a tecla Shift pressionada.'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'rotationDeg').name('Ângulo').listen().disable(),
      'Orientação angular do personagem em graus (0° a 360°) apontando para o cursor.'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'playerScale').name('Escala Atual').listen().disable(),
      'Multiplicador de escala atual do Player (definido no slider de escala).'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'hitboxPixels').name('Hitbox Diâmetro').listen().disable(),
      'Diâmetro real calibrado do círculo de colisão física Arcade em pixels.'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'playerX').name('Pos X').listen().disable(),
      'Coordenada horizontal X do centro do Player no cenário.'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'playerY').name('Pos Y').listen().disable(),
      'Coordenada vertical Y do centro do Player no cenário.'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'fps').name('Game FPS').listen().disable(),
      'Taxa real de quadros por segundo gerada pelo loop do Phaser.'
    );

    const genFolder = this.gui.addFolder('Geradores (DBD)');

    this.attachTooltip(
      genFolder
        .add(this.debugSettings, 'generatorRepairTime', 4, 30, 1)
        .name('Tempo Reparo (s)')
        .onChange(() => this.saveSettingsToStorage()),
      'Tempo necessário em segundos segurando [E] para concluir 100% do reparo de um gerador.'
    );

    this.attachTooltip(
      genFolder
        .add(this.debugSettings, 'skillCheckFrequency', 2, 12, 0.5)
        .name('Frequência QTE (s)')
        .onChange(() => this.saveSettingsToStorage()),
      'Intervalo médio em segundos entre os testes de reação (Skill Checks) durante o conserto.'
    );

    const genActions = {
      testSkillCheck: () => this.forceTestSkillCheck(),
      completeAll: () => this.completeAllGenerators(),
      resetAll: () => this.resetAllGenerators()
    };

    this.attachTooltip(
      genFolder.add(genActions, 'testSkillCheck').name('🎯 Disparar Skill Check'),
      'Dispara imediatamente um evento de Skill Check (QTE com barra giratória e [Espaço]) para testes.'
    );

    this.attachTooltip(
      genFolder.add(genActions, 'completeAll').name('⚡ Concluir Todos'),
      'Define todos os 3 geradores para 100% concluídos imediatamente.'
    );

    this.attachTooltip(
      genFolder.add(genActions, 'resetAll').name('🔄 Resetar Geradores'),
      'Reseta o progresso de todos os geradores para 0% e reativa o estado incompleto.'
    );

    genFolder.open();
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
    this.attachTooltip(
      this.gui.add(actions, 'resetDefaults').name('🔄 Restaurar Padrões'),
      'Restaura todas as opções de velocidade, zoom, hitbox e IA para os valores padrão.'
    );
  }

  /**
   * Vincula tooltip informativo e ícone de ajuda [?] ao controlador do lil-gui
   */
  private attachTooltip(controller: any, description: string): any {
    if (!controller || !controller.domElement) return controller;

    controller.domElement.setAttribute('data-tooltip', description);
    controller.domElement.setAttribute('title', description);

    if (controller.$name) {
      const help = document.createElement('span');
      help.className = 'debug-help-icon';
      help.textContent = '?';
      help.setAttribute('aria-label', description);
      controller.$name.appendChild(help);
    }

    controller.domElement.addEventListener('mouseenter', (e: MouseEvent) => {
      const title = controller._name || controller.property || 'Configuração';
      this.showTooltip(e, title, description);
    });

    controller.domElement.addEventListener('mouseleave', () => {
      this.hideTooltip();
    });

    return controller;
  }

  private showTooltip(e: MouseEvent, title: string, text: string): void {
    const tooltip = document.getElementById('debug-tooltip');
    if (!tooltip) return;

    tooltip.innerHTML = `<strong>${title}</strong><span>${text}</span>`;
    tooltip.classList.add('visible');

    const target = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    let top = target.top + (target.height - tooltipRect.height) / 2;
    let left = target.left - tooltipRect.width - 12;

    if (top < 12) top = 12;
    if (top + tooltipRect.height > window.innerHeight - 12) {
      top = window.innerHeight - tooltipRect.height - 12;
    }
    if (left < 12) {
      left = target.right + 12;
    }

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  private hideTooltip(): void {
    const tooltip = document.getElementById('debug-tooltip');
    if (tooltip) {
      tooltip.classList.remove('visible');
    }
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
        if (typeof parsed.showAStarPath === 'boolean') {
          this.debugSettings.showAStarPath = parsed.showAStarPath;
        }
        if (typeof parsed.killerAiEnabled === 'boolean') {
          this.debugSettings.killerAiEnabled = parsed.killerAiEnabled;
        }
        if (typeof parsed.generatorRepairTime === 'number' && !isNaN(parsed.generatorRepairTime)) {
          this.debugSettings.generatorRepairTime = parsed.generatorRepairTime;
        }
        if (typeof parsed.skillCheckFrequency === 'number' && !isNaN(parsed.skillCheckFrequency)) {
          this.debugSettings.skillCheckFrequency = parsed.skillCheckFrequency;
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
    if (!this.debugSettings.showAStarPath && this.aStarGraphic) {
      this.aStarGraphic.clear();
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
    this.handleGeneratorInteraction(delta);
    this.updateSkillCheck(delta);
    this.updateNoiseAlert(delta);
    this.updateTelemetry();
  }

  /**
   * Movimentação:
   * - Teclas WASD com movimento omnidirecional normalizado
   * - Sprint com tecla Shift (ativa runSpeed e animação run)
   * - Imobilidade obrigatória durante o reparo de geradores
   */
  private handleMovement(): void {
    if (this.isRepairing) {
      this.player.setVelocity(0, 0);
      this.monitorState.isMoving = false;
      this.monitorState.isSprinting = false;
      this.monitorState.currentSpeed = 0;
      if (this.player.anims.isPlaying && this.player.anims.currentAnim?.key !== 'walk') {
        this.player.anims.stop();
        this.player.setFrame(0);
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
    const fps = Math.round(this.game.loop.actualFps);
    this.monitorState.playerX = this.player.x.toFixed(1);
    this.monitorState.playerY = this.player.y.toFixed(1);
    this.monitorState.fps = fps;

    const deg = Math.round(Phaser.Math.RadToDeg(this.player.rotation));
    this.monitorState.rotationDeg = `${deg}°`;

    this.monitorState.playerScale = `${this.debugSettings.playerScale.toFixed(2)}x`;
    this.monitorState.hitboxPixels = `${Math.round(this.debugSettings.hitboxRadius * 2 * this.debugSettings.playerScale)}px`;

    // Atualização em tempo real do card HUD na tela do jogo
    if (!this.hudFpsVal) {
      this.hudFpsVal = document.getElementById('hud-fps-val');
      this.hudKillerState = document.getElementById('hud-killer-state');
      this.hudKillerDist = document.getElementById('hud-killer-dist');
      this.hudFpsDot = document.getElementById('hud-fps-dot');
    }

    if (this.hudFpsVal) {
      this.hudFpsVal.textContent = `${fps}`;
    }
    if (this.hudFpsDot) {
      if (fps >= 55) {
        this.hudFpsDot.className = 'hud-indicator-dot dot-good';
      } else if (fps >= 30) {
        this.hudFpsDot.className = 'hud-indicator-dot dot-warn';
      } else {
        this.hudFpsDot.className = 'hud-indicator-dot dot-bad';
      }
    }
    if (this.hudKillerState) {
      this.hudKillerState.textContent = this.killerState;
      this.hudKillerState.className =
        this.killerState === 'CHASE' ? 'hud-val state-chase' : 'hud-val state-patrol';
    }
    if (this.hudKillerDist) {
      this.hudKillerDist.textContent = this.monitorState.killerDist || '--';
    }

    if (!this.hudGensVal) {
      this.hudGensVal = document.getElementById('hud-gens-val');
    }
    if (this.hudGensVal) {
      const completedCount = this.generators.filter((g) => g.isCompleted).length;
      this.hudGensVal.textContent = `${completedCount}/3`;
      if (completedCount === 3) {
        this.hudGensVal.style.color = '#38bdf8';
      } else if (completedCount > 0) {
        this.hudGensVal.style.color = '#4ade80';
      } else {
        this.hudGensVal.style.color = '#f59e0b';
      }
    }
  }

  /**
   * Verifica se há linha de visão direta desobstruída (Line of Sight - LOS)
   * entre dois pontos do mapa, testando tanto o raio central quanto bordas
   * laterais para evitar contorno de quinas raspando na parede.
   */
  private hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 2) return true;

    const TILE_SIZE = 64;
    const steps = Math.ceil(dist / 20);

    // Margem lateral perpendicular para considerar a largura física do personagem
    const perpX = (-dy / dist) * 20;
    const perpY = (dx / dist) * 20;

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = x1 + dx * t;
      const py = y1 + dy * t;

      // Raio central
      const c = Math.floor(px / TILE_SIZE);
      const r = Math.floor(py / TILE_SIZE);
      if (r < 0 || r >= 30 || c < 0 || c >= 40 || this.navGrid[r][c] === 1) {
        return false;
      }

      // Raio lateral esquerdo
      const cLeft = Math.floor((px + perpX) / TILE_SIZE);
      const rLeft = Math.floor((py + perpY) / TILE_SIZE);
      if (rLeft < 0 || rLeft >= 30 || cLeft < 0 || cLeft >= 40 || this.navGrid[rLeft][cLeft] === 1) {
        return false;
      }

      // Raio lateral direito
      const cRight = Math.floor((px - perpX) / TILE_SIZE);
      const rRight = Math.floor((py - perpY) / TILE_SIZE);
      if (rRight < 0 || rRight >= 30 || cRight < 0 || cRight >= 40 || this.navGrid[rRight][cRight] === 1) {
        return false;
      }
    }

    return true;
  }

  private getNearestWalkableTile(col: number, row: number): { x: number; y: number } | null {
    const COLS = 40;
    const ROWS = 30;

    if (row >= 0 && row < ROWS && col >= 0 && col < COLS && this.navGrid[row][col] === 0) {
      return { x: col, y: row };
    }

    // Busca em anéis concêntricos (raio de 1 a 3 blocos) pela célula transitável mais próxima
    for (let radius = 1; radius <= 3; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          const nr = row + dr;
          const nc = col + dc;
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && this.navGrid[nr][nc] === 0) {
            return { x: nc, y: nr };
          }
        }
      }
    }

    return null;
  }

  private calculateAStarPath(fromX: number, fromY: number, toX: number, toY: number): void {
    if (!this.easystar || this.navGrid.length === 0) return;

    const COLS = 40;
    const ROWS = 30;
    const TILE_SIZE = 64;

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
    if (!this.easystar || this.navGrid.length === 0) return;

    const COLS = 40;
    const ROWS = 30;
    const TILE_SIZE = 64;

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

  /**
   * Inteligência Artificial do Killer (FSM + A* Pathfinding):
   * - PATROL: navega lentamente pelos waypoints do complexo com animação 'walk'.
   * - CHASE:
   *   1. Traça raio (Line of Sight) até o Player. Se livre, corre em linha reta.
   *   2. Se houver paredes/obstáculos bloqueando a linha reta, utiliza A* (EasyStar.js)
   *      para calcular a rota mais curta e contornar os blocos inteligentemente.
   *   3. Recalcula a rota periodicamente (a cada 250ms) conforme o Player se desloca.
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
      if (this.aStarGraphic) this.aStarGraphic.clear();
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
        this.pathRecalcTimer = 250; // Força cálculo imediato do caminho A* no primeiro frame se necessário
        this.currentChasePath = [];
      }
    } else if (this.killerState === 'CHASE') {
      if (distToPlayer > loseRadius) {
        this.killerState = 'PATROL';
        this.patrolWaitTimer = 0;
        this.currentChasePath = [];
        this.pickNewPatrolTarget();
      }
    }

    this.monitorState.killerState = this.killerState;

    if (this.killerState === 'CHASE') {
      const speed = this.debugSettings.killerSpeed;
      const playerRadius = this.debugSettings.hitboxRadius * this.debugSettings.playerScale;
      const killerRadius = this.debugSettings.hitboxRadius * this.debugSettings.playerScale * 1.28;
      const contactDist = playerRadius + killerRadius + 6;
      const isRecoveringFromAttack = this.time.now - this.lastAttackTime < 450;

      if (distToPlayer <= contactDist || isRecoveringFromAttack) {
        // Ao alcançar o Player ou durante a recuperação do golpe, cessa a propulsão frontal
        // para não empurrar o jogador contra quinas/paredes
        this.hasDirectLOS = true;
        this.killer.setVelocity(0, 0);
        if (this.killer.anims.isPlaying) {
          this.killer.anims.stop();
          this.killer.setFrame(0);
        }

        const dx = this.player.x - this.killer.x;
        const dy = this.player.y - this.killer.y;
        const targetAngle = Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - Math.PI / 2);
        this.rotateKillerTowards(targetAngle, delta, 14);
      } else {
        // 1. Verificar linha direta de visão (Line of Sight)
        this.hasDirectLOS = this.hasLineOfSight(
          this.killer.x,
          this.killer.y,
          this.player.x,
          this.player.y
        );

        if (this.hasDirectLOS) {
          // Linha reta desobstruída: perseguição direta em alta velocidade
          this.currentChasePath = [];
          const dx = this.player.x - this.killer.x;
          const dy = this.player.y - this.killer.y;
          const moveVec = new Phaser.Math.Vector2(dx, dy).normalize();

          this.killer.setVelocity(moveVec.x * speed, moveVec.y * speed);

          if (!this.killer.anims.isPlaying || this.killer.anims.currentAnim?.key !== 'run') {
            this.killer.anims.play('run', true);
          }

          const targetAngle = Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - Math.PI / 2);
          this.rotateKillerTowards(targetAngle, delta, 14);
        } else {
        // Linha de visão bloqueada por paredes: Perseguição inteligente via A*
        this.pathRecalcTimer += delta;

        // Recalcular rota a cada 250ms ou se ainda não tiver rota
        if (this.pathRecalcTimer >= 250 || this.currentChasePath.length === 0) {
          this.pathRecalcTimer = 0;
          this.calculateAStarPath(this.killer.x, this.killer.y, this.player.x, this.player.y);
        }

        // Seguir os nós da rota calculada
        if (this.currentChasePath.length > 0) {
          // Avançar nó se já estiver próximo (< 36px)
          const targetNode = this.currentChasePath[this.currentPathIndex];
          const distToNode = Phaser.Math.Distance.Between(
            this.killer.x,
            this.killer.y,
            targetNode.x,
            targetNode.y
          );

          if (distToNode < 36 && this.currentPathIndex < this.currentChasePath.length - 1) {
            this.currentPathIndex++;
          }

          // Atalho suave (string pulling): se já houver linha de visão direta para o próximo nó, avançar
          if (this.currentPathIndex + 1 < this.currentChasePath.length) {
            const nextNode = this.currentChasePath[this.currentPathIndex + 1];
            if (this.hasLineOfSight(this.killer.x, this.killer.y, nextNode.x, nextNode.y)) {
              this.currentPathIndex++;
            }
          }

          const activeNode = this.currentChasePath[this.currentPathIndex];
          const dx = activeNode.x - this.killer.x;
          const dy = activeNode.y - this.killer.y;
          const moveVec = new Phaser.Math.Vector2(dx, dy).normalize();

          this.killer.setVelocity(moveVec.x * speed, moveVec.y * speed);

          if (!this.killer.anims.isPlaying || this.killer.anims.currentAnim?.key !== 'run') {
            this.killer.anims.play('run', true);
          }

          const targetAngle = Phaser.Math.Angle.Wrap(Math.atan2(moveVec.y, moveVec.x) - Math.PI / 2);
          this.rotateKillerTowards(targetAngle, delta, 12);
        } else {
          // Fallback temporário enquanto o path é gerado
          const dx = this.player.x - this.killer.x;
          const dy = this.player.y - this.killer.y;
          const moveVec = new Phaser.Math.Vector2(dx, dy).normalize();
          this.killer.setVelocity(moveVec.x * speed * 0.5, moveVec.y * speed * 0.5);
        }
      }
    }
  } else {
      // Estado PATROL: patrulha cautelosa
      const distToTarget = Phaser.Math.Distance.Between(
        this.killer.x,
        this.killer.y,
        this.patrolTarget.x,
        this.patrolTarget.y
      );

      if (distToTarget < 38) {
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
        const patrolSpeed = this.debugSettings.killerSpeed * 0.45;

        // Se houver linha de visão direta até o alvo de patrulha, caminhar direto
        if (this.hasLineOfSight(this.killer.x, this.killer.y, this.patrolTarget.x, this.patrolTarget.y)) {
          this.patrolPath = [];
          const dx = this.patrolTarget.x - this.killer.x;
          const dy = this.patrolTarget.y - this.killer.y;
          const moveVec = new Phaser.Math.Vector2(dx, dy).normalize();

          this.killer.setVelocity(moveVec.x * patrolSpeed, moveVec.y * patrolSpeed);

          if (!this.killer.anims.isPlaying || this.killer.anims.currentAnim?.key !== 'walk') {
            this.killer.anims.play('walk', true);
          }

          const targetAngle = Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - Math.PI / 2);
          this.rotateKillerTowards(targetAngle, delta, 5);
        } else {
          // Contornar via A* para patrulha se houver paredes intermediárias
          if (this.patrolPath.length > 0) {
            const targetNode = this.patrolPath[this.patrolPathIndex];
            const distToNode = Phaser.Math.Distance.Between(
              this.killer.x,
              this.killer.y,
              targetNode.x,
              targetNode.y
            );

            if (distToNode < 36 && this.patrolPathIndex < this.patrolPath.length - 1) {
              this.patrolPathIndex++;
            }

            const activeNode = this.patrolPath[this.patrolPathIndex];
            const dx = activeNode.x - this.killer.x;
            const dy = activeNode.y - this.killer.y;
            const moveVec = new Phaser.Math.Vector2(dx, dy).normalize();

            this.killer.setVelocity(moveVec.x * patrolSpeed, moveVec.y * patrolSpeed);

            if (!this.killer.anims.isPlaying || this.killer.anims.currentAnim?.key !== 'walk') {
              this.killer.anims.play('walk', true);
            }

            const targetAngle = Phaser.Math.Angle.Wrap(Math.atan2(moveVec.y, moveVec.x) - Math.PI / 2);
            this.rotateKillerTowards(targetAngle, delta, 6);
          } else {
            this.calculatePatrolPath(this.killer.x, this.killer.y, this.patrolTarget.x, this.patrolTarget.y);
          }
        }
      }
    }

    this.updateKillerVisionGraphic();
    this.updateAStarGraphic();
  }

  private pickNewPatrolTarget(): void {
    const incompleteGens = this.generators.filter((g) => !g.isCompleted);

    // 50% de chance de patrulhar a ronda de um gerador incompleto
    if (incompleteGens.length > 0 && Math.random() < 0.5) {
      const targetGen = Phaser.Utils.Array.GetRandom(incompleteGens);
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
    this.calculatePatrolPath(this.killer.x, this.killer.y, this.patrolTarget.x, this.patrolTarget.y);
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

      // Linha de mira direta até o jogador
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

  /**
   * Renderização do Debug da Rota A*
   * - Traçado verde direto quando há Line of Sight (visão livre)
   * - Rota contornando quinas com balizas/nós ciano e destino ativo dourado quando bloqueado
   */
  private updateAStarGraphic(): void {
    if (!this.aStarGraphic) return;
    this.aStarGraphic.clear();

    if (!this.debugSettings.showAStarPath || !this.killer || !this.debugSettings.killerAiEnabled) return;

    if (this.killerState === 'CHASE') {
      if (this.hasDirectLOS) {
        // Linha de Visão Direta (LOS) - verde neon
        this.aStarGraphic.lineStyle(2.5, 0x00ff88, 0.7);
        this.aStarGraphic.lineBetween(this.killer.x, this.killer.y, this.player.x, this.player.y);

        this.aStarGraphic.fillStyle(0x00ff88, 0.4);
        this.aStarGraphic.fillCircle(this.player.x, this.player.y, 8);
      } else if (this.currentChasePath && this.currentChasePath.length > 0) {
        // Linha da rota contornando paredes (A*) - ciano vibrante
        this.aStarGraphic.lineStyle(3, 0x00d4ff, 0.85);

        // Do Killer ao primeiro nó ativo
        const currentNode = this.currentChasePath[this.currentPathIndex];
        if (currentNode) {
          this.aStarGraphic.lineBetween(this.killer.x, this.killer.y, currentNode.x, currentNode.y);
        }

        // Conectar todos os nós da rota calculada
        for (let i = this.currentPathIndex; i < this.currentChasePath.length - 1; i++) {
          const n1 = this.currentChasePath[i];
          const n2 = this.currentChasePath[i + 1];
          this.aStarGraphic.lineBetween(n1.x, n1.y, n2.x, n2.y);
        }

        // Do último nó até o Player
        const lastNode = this.currentChasePath[this.currentChasePath.length - 1];
        if (lastNode) {
          this.aStarGraphic.lineStyle(2, 0xffaa00, 0.8);
          this.aStarGraphic.lineBetween(lastNode.x, lastNode.y, this.player.x, this.player.y);
        }

        // Desenhar os nós da rota como balizas
        for (let i = 0; i < this.currentChasePath.length; i++) {
          const node = this.currentChasePath[i];
          const isTargetNode = i === this.currentPathIndex;

          if (isTargetNode) {
            // Nó ativo / destino imediato (dourado/âmbar)
            this.aStarGraphic.fillStyle(0xffbb00, 0.9);
            this.aStarGraphic.fillCircle(node.x, node.y, 7);
            this.aStarGraphic.lineStyle(2, 0xffffff, 1);
            this.aStarGraphic.strokeCircle(node.x, node.y, 10);
          } else if (i > this.currentPathIndex) {
            // Nós futuros (ciano)
            this.aStarGraphic.fillStyle(0x00d4ff, 0.7);
            this.aStarGraphic.fillCircle(node.x, node.y, 5);
            this.aStarGraphic.lineStyle(1.5, 0x0088cc, 0.5);
            this.aStarGraphic.strokeCircle(node.x, node.y, 7);
          }
        }
      }
    } else if (this.patrolPath && this.patrolPath.length > 0) {
      // Rota de patrulha A* sutil
      this.aStarGraphic.lineStyle(1.5, 0x88bbff, 0.4);
      const currentNode = this.patrolPath[this.patrolPathIndex];
      if (currentNode) {
        this.aStarGraphic.lineBetween(this.killer.x, this.killer.y, currentNode.x, currentNode.y);
      }
      for (let i = this.patrolPathIndex; i < this.patrolPath.length - 1; i++) {
        const n1 = this.patrolPath[i];
        const n2 = this.patrolPath[i + 1];
        this.aStarGraphic.lineBetween(n1.x, n1.y, n2.x, n2.y);
      }
    }
  }

  // =========================================================================
  // SISTEMA DE GERADORES & INTERAÇÃO (PROTÓTIPO ESTILO DEAD BY DAYLIGHT)
  // =========================================================================

  /**
   * Cria os 3 geradores distribuídos em setores estratégicos da instalação:
   * 1. Ala Leste (Usina) - Coord (2240, 960)
   * 2. Ala Oeste (Enfermaria) - Coord (320, 960)
   * 3. Ala Sul (Manutenção) - Coord (1280, 1664)
   * Cada gerador conta com colisão física estática, sinalização luminosa âmbar
   * pulsante, zona circular de reparo e indicador visual de progresso.
   */
  private createGenerators(): void {
    this.generators = [];

    const defs = [
      {
        id: 'gen-1',
        name: 'Gerador A',
        roomName: 'Ala Leste (Usina)',
        x: 2240,
        y: 960
      },
      {
        id: 'gen-2',
        name: 'Gerador B',
        roomName: 'Ala Oeste (Enfermaria)',
        x: 320,
        y: 960
      },
      {
        id: 'gen-3',
        name: 'Gerador C',
        roomName: 'Ala Sul (Manutenção)',
        x: 1280,
        y: 1664
      }
    ];

    defs.forEach((def) => {
      // 1. Zona circular de interação no piso (estilo Dead by Daylight)
      const floorZone = this.add.circle(def.x, def.y, 95);
      floorZone.setStrokeStyle(2, 0xffaa00, 0.4);
      floorZone.setFillStyle(0xffaa00, 0.04);
      floorZone.setDepth(1);

      // 2. Colisor físico estático sólido para Player e Killer (76x88px)
      const solidBlock = this.add.rectangle(def.x, def.y, 76, 88, 0x000000, 0);
      this.obstacles.add(solidBlock);
      const solidBody = solidBlock.body as Phaser.Physics.Arcade.StaticBody;
      if (solidBody) {
        solidBody.updateFromGameObject();
      }

      // 3. Container da máquina industrial do gerador
      const container = this.add.container(def.x, def.y);
      container.setDepth(3);

      // Sombra suave sob o gerador
      const shadow = this.add.ellipse(0, 10, 80, 92, 0x06080e, 0.45);

      // Sprite do Gerador carregado a partir de generator.png
      // Frame 0: Inativo / Danificado (LED vermelho)
      // Frame 1: Em reparação / Faíscas
      // Frame 2: Concluído / Energizado (visor verde)
      const sprite = this.add.sprite(0, -4, 'generator', 0);
      sprite.setScale(0.095);
      sprite.setOrigin(0.5, 0.5);

      // Mini indicador de status sobre o gerador
      const labelText = this.add.text(0, -78, `${def.name} • ${def.roomName}`, {
        fontSize: '11px',
        color: '#94a3b8',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 2
      }).setOrigin(0.5);

      const barBg = this.add.rectangle(0, -64, 68, 8, 0x0f172a);
      barBg.setStrokeStyle(1, 0x334155);

      const progressBarFill = this.add.rectangle(-33, -64, 0, 6, 0xf59e0b);
      progressBarFill.setOrigin(0, 0.5);

      const progressText = this.add.text(0, -52, '0%', {
        fontSize: '10px',
        color: '#e2e8f0',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 2
      }).setOrigin(0.5);

      container.add([
        shadow,
        sprite,
        labelText,
        barBg,
        progressBarFill,
        progressText
      ]);

      const genData: GeneratorData = {
        id: def.id,
        name: def.name,
        roomName: def.roomName,
        x: def.x,
        y: def.y,
        progress: 0,
        isCompleted: false,
        interactionRadius: 95,
        container,
        sprite,
        progressBarFill,
        progressText,
        floorZone
      };

      this.generators.push(genData);
    });
  }

  /**
   * Atualiza a representação visual do gerador no mundo de acordo com o progresso atual.
   * - Quando incompleto: exibe o Frame 0 (LED vermelho)
   * - Enquanto em reparo ativo: exibe o Frame 1 (Faíscas elétricas)
   * - Ao concluir (100%): fixa permanentemente no Frame 2 (Visor verde)
   */
  private updateGeneratorVisuals(gen: GeneratorData): void {
    const pct = Math.floor(gen.progress);

    if (gen.isCompleted) {
      gen.sprite.setFrame(2); // Frame 2: Concluído / Energizado (visor verde)
      gen.progressBarFill.width = 66;
      gen.progressBarFill.setFillStyle(0x00ff88);
      gen.progressText.setText('CONCLUÍDO');
      gen.progressText.setColor('#00ff88');

      gen.floorZone.setStrokeStyle(2, 0x00ff88, 0.5);
      gen.floorZone.setFillStyle(0x00ff88, 0.06);
    } else {
      if (this.isRepairing && this.activeNearbyGen === gen) {
        gen.sprite.setFrame(1); // Frame 1: Em reparação / Faíscas
      } else {
        gen.sprite.setFrame(0); // Frame 0: Inativo / Danificado (LED vermelho)
      }

      gen.progressBarFill.width = Math.max(0, Math.min(66, (pct / 100) * 66));
      const fillColor = pct > 75 ? 0x84cc16 : pct > 35 ? 0xf59e0b : 0xef4444;
      gen.progressBarFill.setFillStyle(fillColor);
      gen.progressText.setText(`${pct}%`);
      gen.progressText.setColor('#e2e8f0');

      gen.floorZone.setStrokeStyle(2, 0xffaa00, 0.4);
      gen.floorZone.setFillStyle(0xffaa00, 0.04);
    }

    if (this.hudGensVal) {
      const completedCount = this.generators.filter((g) => g.isCompleted).length;
      this.hudGensVal.textContent = `${completedCount}/3`;
      if (completedCount === 3) {
        this.hudGensVal.style.color = '#38bdf8';
      } else if (completedCount > 0) {
        this.hudGensVal.style.color = '#4ade80';
      } else {
        this.hudGensVal.style.color = '#f59e0b';
      }
    }
  }

  /**
   * Cria o prompt interativo na tela '[E] Reparar Gerador' com barra de progresso em tempo real.
   */
  private createRepairPromptUI(): void {
    this.repairPromptUI = this.add.container(640, 640);
    this.repairPromptUI.setScrollFactor(0);
    this.repairPromptUI.setDepth(150);
    this.repairPromptUI.setVisible(false);

    const bg = this.add.rectangle(0, 0, 360, 52, 0x090d16, 0.88);
    bg.setStrokeStyle(1.5, 0x3b82f6);

    this.repairPromptText = this.add.text(0, -10, '[E] Reparar Gerador', {
      fontSize: '13px',
      color: '#ffffff',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    const barBg = this.add.rectangle(0, 14, 260, 8, 0x1e293b).setStrokeStyle(1, 0x334155);

    this.repairProgressBarFill = this.add.rectangle(-130, 14, 0, 6, 0x38bdf8).setOrigin(0, 0.5);

    this.repairPercentText = this.add.text(148, 14, '0%', {
      fontSize: '11px',
      color: '#94a3b8',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    this.repairPromptUI.add([
      bg,
      this.repairPromptText,
      barBg,
      this.repairProgressBarFill,
      this.repairPercentText
    ]);
  }

  /**
   * Cria o widget circular de Skill Check (QTE) posicionado no centro da tela.
   */
  private createSkillCheckUI(): void {
    this.skillCheckContainer = this.add.container(640, 360);
    this.skillCheckContainer.setScrollFactor(0);
    this.skillCheckContainer.setDepth(250);
    this.skillCheckContainer.setVisible(false);

    this.skillCheckDialGraphic = this.add.graphics();
    this.skillCheckNeedleGraphic = this.add.graphics();

    this.skillCheckFeedbackText = this.add.text(0, -82, '', {
      fontSize: '16px',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5);

    const promptHint = this.add.text(0, 0, '[ESPAÇO]', {
      fontSize: '11px',
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5);

    this.skillCheckContainer.add([
      this.skillCheckDialGraphic,
      this.skillCheckNeedleGraphic,
      promptHint,
      this.skillCheckFeedbackText
    ]);
  }

  /**
   * Renderiza a base e as zonas de acerto (Good Zone e Great Zone) do Skill Check.
   */
  private drawSkillCheckDial(): void {
    this.skillCheckDialGraphic.clear();

    const toRad = (deg: number) => Phaser.Math.DegToRad(deg - 90);

    // Fundo do círculo
    this.skillCheckDialGraphic.fillStyle(0x0f172a, 0.8);
    this.skillCheckDialGraphic.fillCircle(0, 0, 64);

    // Borda externa
    this.skillCheckDialGraphic.lineStyle(2, 0x334155, 0.9);
    this.skillCheckDialGraphic.strokeCircle(0, 0, 64);

    // Trilha da agulha (trilho circular escuro)
    this.skillCheckDialGraphic.lineStyle(8, 0x1e293b, 0.85);
    this.skillCheckDialGraphic.strokeCircle(0, 0, 50);

    // Zona Good (branca, estilo DBD)
    const goodStartRad = toRad(this.skillCheckZoneStart);
    const goodEndRad = toRad(this.skillCheckZoneStart + this.skillCheckZoneSize);
    this.skillCheckDialGraphic.lineStyle(10, 0xe2e8f0, 0.9);
    this.skillCheckDialGraphic.beginPath();
    this.skillCheckDialGraphic.arc(0, 0, 50, goodStartRad, goodEndRad, false);
    this.skillCheckDialGraphic.strokePath();

    // Zona Great (verde brilhante no início da zona de acerto)
    const greatStartRad = toRad(this.skillCheckZoneStart);
    const greatEndRad = toRad(this.skillCheckZoneStart + this.skillCheckGreatSize);
    this.skillCheckDialGraphic.lineStyle(12, 0x22c55e, 1);
    this.skillCheckDialGraphic.beginPath();
    this.skillCheckDialGraphic.arc(0, 0, 50, greatStartRad, greatEndRad, false);
    this.skillCheckDialGraphic.strokePath();

    // Marcador delimitador de início
    this.skillCheckDialGraphic.lineStyle(2, 0xef4444, 0.8);
    this.skillCheckDialGraphic.lineBetween(
      Math.cos(greatStartRad) * 42,
      Math.sin(greatStartRad) * 42,
      Math.cos(greatStartRad) * 58,
      Math.sin(greatStartRad) * 58
    );
  }

  /**
   * Renderiza a agulha vermelha giratória do Skill Check apontando para o ângulo atual.
   */
  private drawSkillCheckNeedle(): void {
    this.skillCheckNeedleGraphic.clear();

    const needleRad = Phaser.Math.DegToRad(this.skillCheckNeedleAngle - 90);
    const nx = Math.cos(needleRad) * 58;
    const ny = Math.sin(needleRad) * 58;

    // Agulha vermelha vibrante
    this.skillCheckNeedleGraphic.lineStyle(3.5, 0xef4444, 1);
    this.skillCheckNeedleGraphic.lineBetween(0, 0, nx, ny);

    // Ponta e pivô da agulha
    this.skillCheckNeedleGraphic.fillStyle(0xef4444, 1);
    this.skillCheckNeedleGraphic.fillCircle(nx, ny, 3.5);
    this.skillCheckNeedleGraphic.fillCircle(0, 0, 5);
  }

  /**
   * Gerencia a interação do Player com geradores próximos:
   * - Identifica gerador incompleto no raio de 95px
   * - Monitora tecla [E] segurada para progredir no conserto
   * - Pausa e preserva o progresso se a tecla for liberada
   */
  private handleGeneratorInteraction(delta: number): void {
    // Se o jogador estiver atordoado por explosão recente de gerador, decrementar cooldown
    if (this.repairStaggerTimer > 0) {
      this.repairStaggerTimer -= delta;
      if (this.repairPromptUI) {
        this.repairPromptUI.setVisible(true);
        this.repairPromptText.setText('💥 SISTEMA EM CURTO-CIRCUITO...');
        this.repairProgressBarFill.setFillStyle(0xef4444);
      }
      return;
    }

    // Encontrar o gerador mais próximo dentro do raio de interação
    let closestGen: GeneratorData | null = null;
    let closestDist = Infinity;

    for (const gen of this.generators) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, gen.x, gen.y);
      if (dist <= gen.interactionRadius && dist < closestDist) {
        closestDist = dist;
        closestGen = gen;
      }
    }

    this.activeNearbyGen = closestGen;

    if (!closestGen || closestGen.isCompleted) {
      if (this.isRepairing) {
        this.stopRepairing();
      }
      if (this.repairPromptUI) {
        this.repairPromptUI.setVisible(false);
      }
      return;
    }

    // Exibir prompt de reparo
    this.repairPromptUI.setVisible(true);
    const isPressingE = Boolean(
      this.keyE?.isDown ||
      this.activeKeys.has('KeyE')
    );

    if (isPressingE) {
      if (!this.isRepairing) {
        this.startRepairing(closestGen);
      } else if (!closestGen.isCompleted) {
        closestGen.sprite.setFrame(1);
      }

      // Progresso contínuo de conserto
      const repairRate = 100 / Math.max(1, this.debugSettings.generatorRepairTime); // % por segundo
      closestGen.progress = Math.min(100, closestGen.progress + repairRate * (delta / 1000));
      this.updateGeneratorVisuals(closestGen);

      // Atualizar UI do prompt
      this.repairPromptText.setText(`🔧 REPARANDO... [E] Manter Pressionado (${closestGen.roomName})`);
      this.repairProgressBarFill.setFillStyle(0x10b981);
      this.repairProgressBarFill.width = Math.max(0, Math.min(260, (closestGen.progress / 100) * 260));
      this.repairPercentText.setText(`${Math.floor(closestGen.progress)}%`);

      if (closestGen.progress >= 100) {
        this.completeGenerator(closestGen);
      }
    } else {
      if (this.isRepairing) {
        this.stopRepairing();
      } else if (!closestGen.isCompleted) {
        closestGen.sprite.setFrame(0);
      }

      this.repairPromptText.setText(`[E] Reparar ${closestGen.name} (${closestGen.roomName})`);
      this.repairProgressBarFill.setFillStyle(0x38bdf8);
      this.repairProgressBarFill.width = Math.max(0, Math.min(260, (closestGen.progress / 100) * 260));
      this.repairPercentText.setText(`${Math.floor(closestGen.progress)}%`);
    }
  }

  private startRepairing(gen: GeneratorData): void {
    this.isRepairing = true;
    if (!gen.isCompleted) {
      gen.sprite.setFrame(1); // Frame 1: Em reparação / Faíscas
    }
    this.resetSkillCheckTimer();
  }

  private stopRepairing(): void {
    this.isRepairing = false;
    if (this.activeNearbyGen && !this.activeNearbyGen.isCompleted) {
      this.activeNearbyGen.sprite.setFrame(0); // Volta ao Frame 0: Inativo
    }
    if (this.isSkillCheckActive) {
      // Soltar o gerador no meio de um Skill Check provoca falha
      this.resolveSkillCheck(false, false);
    }
    this.isSkillCheckWarning = false;
  }

  private resetSkillCheckTimer(): void {
    const baseSeconds = Math.max(1.5, this.debugSettings.skillCheckFrequency);
    // Variação orgânica entre 80% e 130% do tempo base configurado
    this.skillCheckNextTimer = Phaser.Math.Between(baseSeconds * 800, baseSeconds * 1300);
    this.isSkillCheckWarning = false;
  }

  private completeGenerator(gen: GeneratorData): void {
    gen.isCompleted = true;
    gen.progress = 100;
    gen.sprite.setFrame(2); // Frame 2: Concluído / Energizado (visor verde)
    SoundFX.playCompletion();
    this.updateGeneratorVisuals(gen);
    this.stopRepairing();

    const completedCount = this.generators.filter((g) => g.isCompleted).length;
    if (completedCount === this.generators.length) {
      this.showNotificationToast('🏆 TODOS OS 3 GERADORES FORAM RESTAURADOS!', false);
    } else {
      this.showNotificationToast(`⚡ ${gen.name} restaurado com sucesso! (${completedCount}/3)`, false);
    }
  }

  /**
   * Dispara um novo evento de Skill Check.
   */
  private startSkillCheck(): void {
    this.isSkillCheckActive = true;
    this.isSkillCheckWarning = false;
    this.skillCheckNeedleAngle = 0;

    // A zona de acerto surge entre 110° e 260° para dar tempo de reação enquanto a agulha viaja
    this.skillCheckZoneStart = Phaser.Math.Between(110, 260);
    this.skillCheckZoneSize = 44;
    this.skillCheckGreatSize = 12;

    this.drawSkillCheckDial();
    this.drawSkillCheckNeedle();
    this.skillCheckFeedbackText.setText('');
    this.skillCheckContainer.setVisible(true);
  }

  /**
   * Atualização contínua do Skill Check (aviso sonoro prévio, rotação da agulha e timeout).
   */
  private updateSkillCheck(delta: number): void {
    // 1. Temporizador de disparo de Skill Check enquanto estiver reparando
    if (this.isRepairing && !this.isSkillCheckActive && this.repairStaggerTimer <= 0) {
      this.skillCheckNextTimer -= delta;

      // Aviso sonoro prévio 550ms antes da agulha começar a girar
      if (this.skillCheckNextTimer <= 550 && !this.isSkillCheckWarning) {
        this.isSkillCheckWarning = true;
        SoundFX.playWarningCue();
      }

      if (this.skillCheckNextTimer <= 0) {
        this.startSkillCheck();
      }
    }

    // 2. Animação da agulha giratória do QTE
    if (this.isSkillCheckActive) {
      // Velocidade de rotação da agulha (~330 graus por segundo, completa 360° em aprox 1.09s)
      const needleSpeed = 330;
      this.skillCheckNeedleAngle += needleSpeed * (delta / 1000);
      this.drawSkillCheckNeedle();

      // Passou do limite da zona de acerto sem apertar Espaço -> Falha por expiração
      if (this.skillCheckNeedleAngle > this.skillCheckZoneStart + this.skillCheckZoneSize + 12) {
        this.resolveSkillCheck(false, false);
      }
    }
  }

  /**
   * Trata o input da tecla [Espaço] durante o Skill Check ativo.
   */
  private onSkillCheckInput(): void {
    if (!this.isSkillCheckActive) return;

    const angle = this.skillCheckNeedleAngle;
    const greatEnd = this.skillCheckZoneStart + this.skillCheckGreatSize;
    const goodEnd = this.skillCheckZoneStart + this.skillCheckZoneSize;

    if (angle >= this.skillCheckZoneStart && angle <= greatEnd) {
      // Great Skill Check (+5% bônus)
      this.resolveSkillCheck(true, true);
    } else if (angle > greatEnd && angle <= goodEnd) {
      // Good Skill Check (+1.5% bônus)
      this.resolveSkillCheck(true, false);
    } else {
      // Erro de timing (adiantado ou atrasado)
      this.resolveSkillCheck(false, false);
    }
  }

  /**
   * Conclui o Skill Check aplicando recompensas ou penalidades.
   */
  private resolveSkillCheck(success: boolean, isGreat: boolean): void {
    this.isSkillCheckActive = false;
    this.skillCheckNeedleGraphic.clear();

    if (success) {
      SoundFX.playSuccess(isGreat);
      const bonus = isGreat ? 5 : 1.5;
      const label = isGreat ? '⭐ PERFEITO! +5%' : '👍 BOM! +1.5%';
      const color = isGreat ? '#22c55e' : '#38bdf8';
      this.showSkillCheckFeedback(label, color);

      if (this.activeNearbyGen && !this.activeNearbyGen.isCompleted) {
        this.activeNearbyGen.progress = Math.min(100, this.activeNearbyGen.progress + bonus);
        this.updateGeneratorVisuals(this.activeNearbyGen);
        if (this.activeNearbyGen.progress >= 100) {
          this.completeGenerator(this.activeNearbyGen);
        }
      }
    } else {
      this.showSkillCheckFeedback('💥 FALHA!', '#ef4444');
      if (this.activeNearbyGen && !this.activeNearbyGen.isCompleted) {
        this.triggerGeneratorExplosion(this.activeNearbyGen);
      } else {
        // Teste avulso sem gerador associado
        SoundFX.playExplosion();
        this.cameras.main.shake(300, 0.01);
      }
    }

    this.time.delayedCall(600, () => {
      if (!this.isSkillCheckActive) {
        this.skillCheckContainer.setVisible(false);
        this.skillCheckDialGraphic.clear();
      }
    });

    this.resetSkillCheckTimer();
  }

  private showSkillCheckFeedback(text: string, color: string): void {
    this.skillCheckFeedbackText.setText(text);
    this.skillCheckFeedbackText.setColor(color);
    this.skillCheckFeedbackText.setScale(1.4);
    this.tweens.killTweensOf(this.skillCheckFeedbackText);
    this.tweens.add({
      targets: this.skillCheckFeedbackText,
      scale: 1,
      duration: 300,
      ease: 'Back.Out'
    });
  }

  /**
   * Trata a explosão do gerador em caso de falha no Skill Check:
   * - Som estrondoso de explosão
   * - Screen shake e flash vermelho
   * - Penalidade de 10% no progresso
   * - Partículas de faíscas espalhadas
   * - Marcador visual de som no mapa
   * - Alerta e redireciona o Assassino para investigar o local
   */
  private triggerGeneratorExplosion(gen: GeneratorData): void {
    SoundFX.playExplosion();
    this.cameras.main.shake(350, 0.014);
    this.cameras.main.flash(200, 220, 60, 20);

    // Penalidade de progresso (-10%)
    gen.progress = Math.max(0, gen.progress - 10);
    this.updateGeneratorVisuals(gen);

    // Interrompe reparo e trava por 1.4s (stagger)
    this.isRepairing = false;
    this.repairStaggerTimer = 1400;

    // Efeitos de faíscas e ping de barulho no mapa
    this.createExplosionBurst(gen.x, gen.y);
    this.triggerNoiseAlert(gen.x, gen.y);

    // Alerta o assassino
    this.alertKillerToNoise(gen.x, gen.y);
  }

  private createExplosionBurst(x: number, y: number): void {
    const colors = [0xffdd44, 0xff8822, 0xff2200, 0xffffff];
    for (let i = 0; i < 22; i++) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const speed = Phaser.Math.Between(70, 240);
      const color = Phaser.Math.RND.pick(colors);
      const radius = Phaser.Math.Between(2, 5);
      const spark = this.add.circle(x, y, radius, color);
      spark.setDepth(12);

      this.tweens.add({
        targets: spark,
        x: x + Math.cos(angle) * speed,
        y: y + Math.sin(angle) * speed,
        alpha: 0,
        scale: 0.2,
        duration: Phaser.Math.Between(350, 650),
        ease: 'Cubic.Out',
        onComplete: () => spark.destroy()
      });
    }
  }

  private triggerNoiseAlert(x: number, y: number): void {
    this.noiseAlertPos = { x, y };
    this.noiseAlertTimer = 2200;
  }

  private updateNoiseAlert(delta: number): void {
    if (!this.noiseAlertGraphic) return;
    this.noiseAlertGraphic.clear();

    if (this.noiseAlertTimer <= 0) return;
    this.noiseAlertTimer -= delta;

    const progress = (2200 - this.noiseAlertTimer) / 2200;
    const radius = 28 + progress * 140;
    const alpha = Math.max(0, 1 - progress);

    // Onda concêntrica de alerta sonoro
    this.noiseAlertGraphic.lineStyle(3, 0xffaa00, alpha * 0.9);
    this.noiseAlertGraphic.strokeCircle(this.noiseAlertPos.x, this.noiseAlertPos.y, radius);

    this.noiseAlertGraphic.fillStyle(0xff3300, alpha * 0.22);
    this.noiseAlertGraphic.fillCircle(this.noiseAlertPos.x, this.noiseAlertPos.y, 16);

    // Ícone tático de mira / explosão
    this.noiseAlertGraphic.lineStyle(2, 0xffdd44, alpha);
    this.noiseAlertGraphic.lineBetween(
      this.noiseAlertPos.x - 20,
      this.noiseAlertPos.y,
      this.noiseAlertPos.x + 20,
      this.noiseAlertPos.y
    );
    this.noiseAlertGraphic.lineBetween(
      this.noiseAlertPos.x,
      this.noiseAlertPos.y - 20,
      this.noiseAlertPos.x,
      this.noiseAlertPos.y + 20
    );
  }

  /**
   * Alerta a inteligência artificial do Assassino quanto ao ruído de explosão.
   */
  private alertKillerToNoise(x: number, y: number): void {
    if (!this.killer || !this.debugSettings.killerAiEnabled) return;

    if (this.killerState === 'PATROL') {
      this.patrolTarget.set(x, y);
      this.patrolPath = [];
      this.patrolPathIndex = 0;
      this.patrolWaitTimer = 0;
      this.calculatePatrolPath(this.killer.x, this.killer.y, x, y);
    }

    this.showNotificationToast('💥 O Assassino foi alertado da explosão do gerador!', true);
  }

  public forceTestSkillCheck(): void {
    this.startSkillCheck();
  }

  public completeAllGenerators(): void {
    this.generators.forEach((gen) => {
      gen.progress = 100;
      gen.isCompleted = true;
      this.updateGeneratorVisuals(gen);
    });
    SoundFX.playCompletion();
    this.showNotificationToast('⚡ TODOS OS GERADORES RESTAURADOS (DEBUG)!', false);
  }

  public resetAllGenerators(): void {
    this.generators.forEach((gen) => {
      gen.progress = 0;
      gen.isCompleted = false;
      this.updateGeneratorVisuals(gen);
    });
    this.showNotificationToast('🔄 Progresso de todos os geradores resetado!', false);
  }
}
