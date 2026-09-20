import Phaser from 'phaser';
import GUI from 'lil-gui';
import EasyStar from 'easystarjs';
import survivorMeta from '../assets/survivor.json';

export const WORLD_WIDTH = 2560;
export const WORLD_HEIGHT = 1920;

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
  killerAiEnabled: true
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

  // EasyStar.js A* Pathfinding
  private easystar!: EasyStar.js;
  private navGrid: number[][] = [];
  private currentChasePath: Array<{ x: number; y: number }> = [];
  private currentPathIndex = 0;
  private pathRecalcTimer = 0;
  private hasDirectLOS = false;
  private patrolPath: Array<{ x: number; y: number }> = [];
  private patrolPathIndex = 0;

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
    playerX: '1280',
    playerY: '960',
    worldSize: '2560 x 1920',
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

    // Gráficos de Debug para Rota A*
    this.aStarGraphic = this.add.graphics();
    this.aStarGraphic.setDepth(6);

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
    // Bancada médica / cabine de triagem central (Cols 4..5, Rows 14..15: 128x128 com 192px de folga em todas as direções)
    for (let r = 14; r <= 15; r++) {
      for (let c = 4; c <= 5; c++) {
        grid[r][c] = '#';
      }
    }

    // 3.4 Ala Leste - Gerador A (Cols 30..38, Rows 9..20)
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
    // Bloco do Gerador Principal A (Cols 34..35, Rows 14..15: 128x128 com 192px de folga ao redor)
    for (let r = 14; r <= 15; r++) {
      for (let c = 34; c <= 35; c++) {
        grid[r][c] = '#';
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

    // 5. Configurar grelha lógica para EasyStar.js (0 = livre, 1 = parede intransitável)
    this.navGrid = [];
    for (let r = 0; r < ROWS; r++) {
      this.navGrid[r] = new Array(COLS);
      for (let c = 0; c < COLS; c++) {
        this.navGrid[r][c] = grid[r][c] === '#' ? 1 : 0;
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

    // Detalhes no console central da Enfermaria (Cols 4..5, Rows 14..15 -> X: 320, Y: 960)
    this.add.text(320, 960, '✚ CABINE DE\nTRIAGEM', {
      fontSize: '11px',
      color: '#a7d5be',
      fontStyle: 'bold',
      align: 'center'
    }).setOrigin(0.5).setDepth(3);

    // ----------------------------------------------------
    // ALA LESTE (Gerador A: 2240, 960)
    // ----------------------------------------------------
    this.add.text(2240, 720, 'ALA LESTE // USINA GERADOR A', {
      fontSize: '13px',
      color: '#c99653',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(1);

    this.add.text(2240, 1200, '⚡ FORÇA AUXILIAR - 3 ACESSOS AO CORREDOR', {
      fontSize: '10px',
      color: '#8a6534'
    }).setOrigin(0.5).setDepth(1);

    // Detalhes no gerador central (Cols 34..35, Rows 14..15 -> X: 2240, Y: 960)
    const genWarningZone = this.add.rectangle(2240, 960, 160, 160, 0x000000, 0);
    genWarningZone.setStrokeStyle(2, 0xd49b3d, 0.4);
    genWarningZone.setDepth(1);

    this.add.text(2240, 960, '⚡ GERADOR A\nALTA TENSÃO', {
      fontSize: '11px',
      color: '#ffd073',
      fontStyle: 'bold',
      align: 'center'
    }).setOrigin(0.5).setDepth(3);

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
      .add(this.debugSettings, 'showAStarPath')
      .name('Mostrar Rota A*');
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
        if (typeof parsed.showAStarPath === 'boolean') {
          this.debugSettings.showAStarPath = parsed.showAStarPath;
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
      // 1. Verificar linha direta de visão (Line of Sight)
      this.hasDirectLOS = this.hasLineOfSight(
        this.killer.x,
        this.killer.y,
        this.player.x,
        this.player.y
      );

      const speed = this.debugSettings.killerSpeed;

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
    const randomWp = Phaser.Utils.Array.GetRandom(this.patrolWaypoints);
    const offsetX = Phaser.Math.Between(-25, 25);
    const offsetY = Phaser.Math.Between(-25, 25);
    this.patrolTarget.set(randomWp.x + offsetX, randomWp.y + offsetY);
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
}
