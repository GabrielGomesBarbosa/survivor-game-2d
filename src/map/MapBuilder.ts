/**
 * @file MapBuilder.ts
 * @description Construtor da planta baixa estruturada da Sandbox (Instalação de Pesquisa / Asilo Abandonado).
 * Implementa a malha 40x30 (blocos de 64px), fusão retangular 2D gananciosa (Greedy 2D Merger)
 * para colisão física limpa, demarcação tática e matriz de navegação A* (EasyStar.js).
 */

import Phaser from 'phaser';
import EasyStar from 'easystarjs';
import { WORLD_WIDTH, WORLD_HEIGHT, TILE_SIZE, COLS, ROWS } from '../config/constants';
import { buildAiWeightedGrid } from '../utils/gameLogic';

export interface MapData {
  walls: Phaser.Physics.Arcade.StaticGroup;
  obstacles: Phaser.Physics.Arcade.StaticGroup;
  baseNavGrid: number[][];
  navGrid: number[][];
  easystar: EasyStar.js;
  grid: string[][];
}

export class MapBuilder {
  /**
   * Constrói o cenário completo com piso, paredes mescladas, sinalização e matriz A*.
   * @param {Phaser.Scene} scene - A cena do Phaser onde o mapa será instanciado.
   * @returns {MapData} Grupos de colisão estática, grelha lógica e instância configurada do EasyStar.js.
   */
  static build(scene: Phaser.Scene): MapData {
    // 1. Chão com grid quadriculado escuro cobrindo todo o mundo 2560x1920
    const gridBg = scene.add.grid(
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
    const majorGrid = scene.add.grid(
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
    const walls = scene.physics.add.staticGroup();
    const obstacles = scene.physics.add.staticGroup();

    // 3. Montar malha lógica da planta baixa orgânica e assimétrica (80 colunas x 60 linhas)
    const grid: string[][] = MapBuilder.buildOrganicFacilityGrid();


    // 4. Algoritmo Ganancioso de Fusão Retangular 2D (Greedy 2D Rect Merger)
    const visited: boolean[][] = [];
    for (let r = 0; r < ROWS; r++) {
      visited[r] = new Array(COLS).fill(false);
    }

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] === '#' && !visited[r][c]) {
          let w = 0;
          while (c + w < COLS && grid[r][c + w] === '#' && !visited[r][c + w]) {
            w++;
          }

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

          for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
              visited[r + dy][c + dx] = true;
            }
          }

          const pixelW = w * TILE_SIZE;
          const pixelH = h * TILE_SIZE;
          const pixelX = c * TILE_SIZE + pixelW / 2;
          const pixelY = r * TILE_SIZE + pixelH / 2;

          this.createMergedWall(scene, walls, pixelX, pixelY, pixelW, pixelH);
        }
      }
    }

    // 5. Configurar matriz de navegação e contenção (0 = transitável, 1 = parede arquitetônica)
    const baseNavGrid: number[][] = [];
    for (let r = 0; r < ROWS; r++) {
      baseNavGrid[r] = new Array(COLS);
      for (let c = 0; c < COLS; c++) {
        baseNavGrid[r][c] = (grid[r][c] === '#') ? 1 : 0;
      }
    }
    const navGrid: number[][] = baseNavGrid.map((row) => [...row]);

    const weightedGrid = buildAiWeightedGrid(navGrid);
    const easystar = new EasyStar.js();
    easystar.setGrid(weightedGrid);
    easystar.setAcceptableTiles([0, 2]);
    easystar.setTileCost(0, 1);
    easystar.setTileCost(2, 8); // Custo elevado (8) em células adjacentes a paredes e geradores para folga (clearance)
    easystar.enableDiagonals();
    (easystar as any).disableCornerCutting?.();
    (easystar as any).enableSync?.();
    easystar.setIterationsPerCalculation(10000);

    // 6. Criar sinalização arquitetônica da instalação
    MapBuilder.createFacilitySignage(scene);

    return {
      walls,
      obstacles,
      baseNavGrid,
      navGrid,
      easystar,
      grid
    };
  }

  /**
   * Constrói a planta baixa orgânica e assimétrica da instalação (80 colunas x 60 linhas).
   * Elimina cubículos repetitivos e cria alas temáticas autênticas com obstáculos para looping.
   */
  public static buildOrganicFacilityGrid(): string[][] {
    const grid: string[][] = Array.from({ length: ROWS }, () => new Array(COLS).fill('.'));

    // Helpers para traçado de paredes ortogonais e blocos estruturais
    const hWall = (r: number, c1: number, c2: number) => {
      const minC = Math.max(0, Math.min(c1, c2));
      const maxC = Math.min(COLS - 1, Math.max(c1, c2));
      if (r >= 0 && r < ROWS) {
        for (let c = minC; c <= maxC; c++) grid[r][c] = '#';
      }
    };

    const vWall = (c: number, r1: number, r2: number) => {
      const minR = Math.max(0, Math.min(r1, r2));
      const maxR = Math.min(ROWS - 1, Math.max(r1, r2));
      if (c >= 0 && c < COLS) {
        for (let r = minR; r <= maxR; r++) grid[r][c] = '#';
      }
    };

    const fillBox = (r1: number, r2: number, c1: number, c2: number) => {
      const minR = Math.max(0, Math.min(r1, r2));
      const maxR = Math.min(ROWS - 1, Math.max(r1, r2));
      const minC = Math.max(0, Math.min(c1, c2));
      const maxC = Math.min(COLS - 1, Math.max(c1, c2));
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          grid[r][c] = '#';
        }
      }
    };

    // 1. Perímetro Externo Sólido Contínuo da Instalação
    hWall(0, 0, COLS - 1);
    hWall(ROWS - 1, 0, COLS - 1);
    vWall(0, 0, ROWS - 1);
    vWall(COLS - 1, 0, ROWS - 1);

    // 2. Núcleo Central: Grande Recepção / Pátio Aberto (c in [30..49], r in [23..36])
    // Paredes de fechamento com acessos amplos (mínimo 3 a 4 tiles)
    hWall(23, 30, 31);
    hWall(23, 35, 37); // Porta c = 32..34 (conexão diagonal NW)
    hWall(23, 42, 49); // Porta cardeal c = 38..41 (corredor Norte)

    hWall(36, 30, 37); // Porta cardeal c = 38..41 (corredor Sul)
    hWall(36, 42, 45);
    hWall(36, 49, 49); // Porta c = 46..48 (conexão SE Caldeiras)

    vWall(30, 23, 27); // Porta oeste r = 28..31 (vão de 4 tiles)
    vWall(30, 32, 36);

    vWall(49, 23, 27); // Porta leste r = 28..31 (vão de 4 tiles)
    vWall(49, 32, 36);

    // Estruturas Internas de Looping da Recepção (Balcões e Colunas Táticas):
    fillBox(26, 28, 33, 34); // Balcão NW (2x3)
    fillBox(26, 28, 45, 46); // Balcão NE (2x3)
    fillBox(32, 33, 33, 34); // Guichê de Segurança SW (2x2)
    fillBox(32, 33, 45, 46); // Mesa de Informações SE (2x2)

    // 3. Ala Norte: Bloco de Contenção & Airlock (c in [31..48], r in [4..19])
    // Spawn do Killer em c = 40, r = 11
    hWall(4, 31, 37);
    hWall(4, 42, 48); // Saída norte para anel perimetral em c = 38..41

    hWall(19, 31, 37);
    hWall(19, 42, 48); // Saída sul com faixa de advertência em c = 38..41

    vWall(31, 4, 6);
    vWall(31, 10, 14); // Portas oeste em r = 7..9 e r = 15..17
    vWall(31, 18, 19);

    vWall(48, 4, 6);
    vWall(48, 10, 14); // Portas leste em r = 7..9 e r = 15..17
    vWall(48, 18, 19);

    // Divisórias laterais de câmaras de isolamento (deixando centro c=37..42 desobstruído)
    fillBox(9, 13, 35, 36);
    fillBox(9, 13, 43, 44);

    // 4. Ala Noroeste: Almoxarifado & Depósito Industrial (c in [4..26], r in [4..20])
    // Centro da sala em c = 16, r = 12
    hWall(4, 4, 9);
    hWall(4, 14, 26); // Porta norte em c = 10..13

    vWall(4, 4, 9);
    vWall(4, 14, 20); // Porta oeste em r = 10..13

    hWall(20, 4, 7);
    hWall(20, 11, 19); // Portas sul em c = 8..10 e c = 20..22
    hWall(20, 23, 26);

    vWall(26, 4, 9);
    vWall(26, 14, 20); // Porta leste em r = 10..13

    // Divisória assimétrica entre Almoxarifado Oeste e Racks Leste
    vWall(13, 4, 8);
    vWall(13, 14, 20); // Vão central em r = 9..13

    // Estante em formato de 'T' no Almoxarifado
    hWall(9, 7, 10);
    vWall(7, 8, 10);

    // Rack em formato de 'U' no Depósito
    hWall(15, 17, 22);
    vWall(17, 16, 17);
    vWall(22, 16, 17);

    // Palete maciço de estocagem elevada
    fillBox(7, 8, 18, 21);

    // Alcova Apertada em 'U' (Nicho Técnico para Gerador de 1 Único Slot Livre):
    // Parede direita em c = 7, r in [17..19] formando nicho estreito com parede esquerda c = 4 e fundo r = 20
    // Abertura frontal de 2 blocos para acesso pelo Norte (cols 5..6 = 128px)
    vWall(7, 17, 19);

    // 5. Ala Nordeste: Laboratório de Pesquisa & Sala de Controle (c in [53..75], r in [4..20])
    // Gerador A em c = 63..64, r = 11..12 | Centro da sala em c = 64, r = 12
    hWall(4, 53, 59);
    hWall(4, 64, 75); // Porta norte em c = 60..63

    vWall(75, 4, 9);
    vWall(75, 14, 20); // Porta leste em r = 10..13

    hWall(20, 53, 56);
    hWall(20, 61, 67); // Portas sul em c = 57..60 e c = 68..71
    hWall(20, 72, 75);

    vWall(53, 4, 9);
    vWall(53, 14, 20); // Porta oeste em r = 10..13

    // Anexo 1: Sala de Controle (c in [68..74], r in [5..9])
    vWall(67, 5, 5);
    vWall(67, 8, 9); // Porta em r = 6..7
    hWall(9, 68, 69);
    hWall(9, 72, 74); // Porta em c = 70..71

    // Anexo 2: Sala de Descontaminação Química (c in [54..59], r in [14..19])
    hWall(14, 54, 55);
    hWall(14, 58, 59); // Porta em c = 56..57
    vWall(59, 15, 16);
    vWall(59, 19, 19); // Porta em r = 17..18

    // Ilha central de looping no laboratório (Bancada de Pesquisa)
    fillBox(15, 16, 66, 67);

    // 6. Ala Sudoeste: Enfermaria & Bloco de Celas (c in [4..26], r in [40..55])
    // Gerador B em c = 15..16, r = 47..48 | Centro da sala em c = 16, r = 48
    hWall(40, 4, 7);
    hWall(40, 11, 19); // Portas norte em c = 8..10 e c = 20..22
    hWall(40, 23, 26);

    vWall(4, 40, 44);
    vWall(4, 49, 55); // Porta oeste em r = 45..48

    hWall(55, 4, 9);
    hWall(55, 13, 18); // Portas sul em c = 10..12 e c = 19..21
    hWall(55, 22, 26);

    vWall(26, 40, 45);
    vWall(26, 50, 55); // Porta leste em r = 46..49

    // Corredor das celas em r = 44 com passagens assimétricas
    vWall(11, 40, 41); // Passagem entre Celas 1 e 2 em r = 42..43
    vWall(18, 41, 43); // Passagem da Cela 3 em r = 40
    hWall(44, 4, 6);
    hWall(44, 9, 13);
    hWall(44, 16, 21);
    hWall(44, 24, 26);

    // Biombo de Cirurgia (Looping da Ala Hospitalar)
    fillBox(48, 51, 21, 22);

    // Divisória do cubículo de observação
    vWall(9, 47, 48);
    vWall(9, 51, 52); // Porta em r = 49..50

    // 7. Ala Sudeste: Sala de Caldeiras & Maquinário Pesado (c in [53..75], r in [40..55])
    // Gerador C em c = 63..64, r = 47..48 | Centro da sala em c = 64, r = 48
    hWall(40, 53, 56);
    hWall(40, 61, 67); // Portas norte em c = 57..60 e c = 68..70
    hWall(40, 71, 75);

    vWall(75, 40, 44);
    vWall(75, 49, 55); // Porta leste em r = 45..48

    hWall(55, 53, 61);
    hWall(55, 66, 75); // Porta sul em c = 62..65

    vWall(53, 40, 45);
    vWall(53, 50, 55); // Porta oeste em r = 46..49

    // Caldeiras Industriais Maciças (Obstáculos Sólidos para Looping)
    fillBox(44, 46, 56, 58); // Caldeira Primária A (3x3)
    fillBox(50, 52, 56, 58); // Caldeira Secundária B (3x3)

    // Divisória Solta / Baffle Wall (Quebra de Linha de Visão Direta)
    hWall(44, 69, 71);
    vWall(69, 45, 47);

    // Pilar Estrutural de Tubulações (Looping Sul)
    fillBox(51, 52, 68, 69);

    // 8. Ala Sul: Manutenção & Subestação Elétrica (c in [31..48], r in [40..55])
    // Centro da sala em c = 40, r = 48
    hWall(40, 31, 37);
    hWall(40, 42, 48); // Conexão norte com corredor de trânsito em c = 38..41

    hWall(55, 31, 37);
    hWall(55, 42, 48); // Saída sul para anel perimetral em c = 38..41

    vWall(31, 40, 45);
    vWall(31, 50, 55); // Acesso oeste para Enfermaria em r = 46..49

    vWall(48, 40, 45);
    vWall(48, 50, 55); // Acesso leste para Caldeiras em r = 46..49

    // Bancos de Transformadores Elétricos
    fillBox(44, 46, 34, 35); // Transformador Oeste (2x3)
    fillBox(44, 46, 44, 45); // Transformador Leste (2x3)
    fillBox(51, 52, 38, 41); // Barreira técnica de cabos (2x4)

    // 9. Pátio Intermediário Oeste: Quebra de Visão & Estruturas de Looping (c in [6..26], r in [22..38])
    // Elimina a zona morta à esquerda da Recepção Central
    // Estrutura em 'L' Noroeste (Contêineres de Carga / Divisória Técnica):
    hWall(25, 11, 16);
    vWall(11, 25, 29);

    // Pilar Central Maciço de Looping (Torre de Ventilação e Suporte Estrutural - 3x3 tiles = 192x192px):
    // Posicionado defronte à porta oeste da Recepção (r = 28..30, c = 18..20)
    fillBox(28, 30, 18, 20);

    // Estrutura em 'T' Sudoeste (Racks de Triagem & Divisórias de Carga):
    hWall(35, 10, 18);
    vWall(14, 32, 35);

    // Defletores de Linha de Visão Leste-Oeste:
    vWall(25, 24, 26);
    vWall(25, 32, 34);

    // 10. Ala Leste: Anexo de Quarentena & Nicho Apertado de 1 Slot (c in [56..72], r in [24..36])
    // Elimina a zona morta à direita da Recepção Central com sala técnica e alcova em 'U'
    // Parede Norte do Anexo com abertura em c = 59..62 (conexão com Ala Nordeste):
    hWall(24, 56, 58);
    hWall(24, 63, 72);

    // Parede Sul do Anexo com abertura em c = 59..62 (conexão com Ala Sudeste):
    hWall(36, 56, 58);
    hWall(36, 63, 72);

    // Parede Oeste com abertura em r = 28..31 (defronte à porta leste da Recepção):
    vWall(56, 24, 27);
    vWall(56, 32, 36);

    // Parede Leste com abertura em r = 29..32 (conexão com anel perimetral c = 76..78):
    vWall(72, 24, 28);
    vWall(72, 33, 36);

    // Divisória Interna e Bancada de Looping no Anexo Leste:
    hWall(30, 59, 62);
    vWall(62, 27, 30);

    // Alcova Estreita em 'U' (Nicho Técnico de 1 Único Slot Livre):
    // Parede esquerda (Oeste): c = 66, r in [28..31]
    // Parede direita (Leste): c = 69, r in [28..31]
    // Parede de fundo (Sul): r = 31, c in [66..69]
    // Interior livre: c in [67..68], r in [28..30] (128px de largura)
    // Acesso frontal aberto pelo Norte em r = 27 (cols 67..68 = 2 blocos de passagem)
    vWall(66, 28, 31);
    vWall(69, 28, 31);
    hWall(31, 66, 69);

    return grid;
  }

  /**
   * Instancia uma parede mesclada com sombra e relevo 2.5D.
   */
  private static createMergedWall(
    scene: Phaser.Scene,
    walls: Phaser.Physics.Arcade.StaticGroup,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    const shadow = scene.add.rectangle(x + 5, y + 5, width, height, 0x07090e, 0.45);
    shadow.setDepth(1);

    const wall = scene.add.rectangle(x, y, width, height, 0x222633);
    wall.setStrokeStyle(2, 0x4f586f);
    wall.setDepth(2);
    walls.add(wall);

    const body = wall.body as Phaser.Physics.Arcade.StaticBody;
    if (body) {
      body.updateFromGameObject();
    }

    if (width > 12 && height > 12) {
      const capW = Math.max(width - 4, 4);
      const capH = Math.max(height - 4, 4);
      const cap = scene.add.rectangle(x, y - 2, capW, capH, 0x292f3e);
      cap.setStrokeStyle(1, 0x3d4559);
      cap.setDepth(2);
    }
  }

  /**
   * Instancia a sinalização de solo, zonas de advertência e faixas táticas.
   */
  private static createFacilitySignage(scene: Phaser.Scene): void {
    // Linha amarela de advertência do Bloco de Contenção (Spawn Killer em Ala Norte)
    const warningLine = scene.add.rectangle(2560, 1200, 256, 12, 0xca8a04, 0.85);
    warningLine.setStrokeStyle(1, 0x18181b);
    warningLine.setDepth(0.5);

    // Tapete demarcatório da Recepção Central (8x6 tiles alinhados ao grid: 512x384px centrado em 2560, 1920)
    const receptionCarpet = scene.add.rectangle(2560, 1920, 512, 384, 0x0f172a, 0.6);
    receptionCarpet.setStrokeStyle(1.5, 0x334155, 0.5);
    receptionCarpet.setDepth(0.3);

    // Marca central de spawn do jogador
    const spawnRing = scene.add.circle(2560, 1920, 36);
    spawnRing.setStrokeStyle(2, 0x38bdf8, 0.4);
    spawnRing.setDepth(0.4);

    // Rótulos de Salas e Corredores (Blueprint Watermark Text - Estilo Planta Baixa Técnica)
    const roomLabels = [
      { text: 'RECEPÇÃO CENTRAL', x: 2560, y: 1920 },
      { text: 'ALA NOROESTE - ALMOXARIFADO', x: 1024, y: 768 },
      { text: 'ALA NORDESTE - LABORATÓRIO', x: 4096, y: 768 },
      { text: 'ALA SUDOESTE - ENFERMARIA', x: 1024, y: 3072 },
      { text: 'ALA SUDESTE - CALDEIRAS', x: 4096, y: 3072 },
      { text: 'CORREDOR NORTE / ANEL PERIMETRAL', x: 2560, y: 160 },
      { text: 'PÁTIO EXTERNO OESTE', x: 960, y: 1920 },
      { text: 'ALA SUL - MANUTENÇÃO', x: 2560, y: 3072 },
      { text: 'ALA LESTE - QUARENTENA', x: 4200, y: 1920 },
      { text: 'ALA NORTE - CONTENÇÃO', x: 2560, y: 736 }
    ];

    roomLabels.forEach((lbl) => {
      const txt = scene.add.text(lbl.x, lbl.y, lbl.text, {
        fontFamily: 'monospace',
        fontSize: '20px',
        fontStyle: 'bold',
        color: '#38bdf8',
        letterSpacing: 2
      });
      txt.setOrigin(0.5);
      txt.setAlpha(0.35);
      txt.setDepth(0.25);
    });
  }
}

