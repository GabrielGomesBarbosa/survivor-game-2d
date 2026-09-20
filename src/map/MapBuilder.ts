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

    // 3. Montar malha lógica da planta baixa (60 colunas x 45 linhas)
    const grid: string[][] = [];
    for (let r = 0; r < ROWS; r++) {
      grid[r] = new Array(COLS).fill('.');
    }

    // 3.1 Perímetro externo contínuo da instalação (Bordas sólidas)
    for (let c = 0; c < COLS; c++) {
      grid[0][c] = '#';
      grid[ROWS - 1][c] = '#';
    }
    for (let r = 0; r < ROWS; r++) {
      grid[r][0] = '#';
      grid[r][COLS - 1] = '#';
    }

    // 3.2 Arquitetura Modular dos Setores e Alas (Grid 3x3 com Corredores e Anel Perimetral)
    // Bandas de colunas: Oeste (4..19), Centro (23..36), Leste (40..55)
    // Bandas de linhas: Norte (4..12), Centro (16..28), Sul (32..40)
    // Todas as passagens e portas possuem largura de 3 a 4 ladrilhos (192px a 256px >= 128px)
    // Corredores internos e anel perimetral de fuga possuem largura uniforme de 3 blocos (192px)
    const colBands = [
      { name: 'Oeste', min: 4, max: 19, doorMin: 10, doorMax: 13 },
      { name: 'Centro', min: 23, max: 36, doorMin: 28, doorMax: 31 },
      { name: 'Leste', min: 40, max: 55, doorMin: 46, doorMax: 49 }
    ];

    const rowBands = [
      { name: 'Norte', min: 4, max: 12, doorMin: 7, doorMax: 9 },
      { name: 'Centro', min: 16, max: 28, doorMin: 21, doorMax: 23 },
      { name: 'Sul', min: 32, max: 40, doorMin: 35, doorMax: 37 }
    ];

    for (const rBand of rowBands) {
      for (const cBand of colBands) {
        // Parede Norte da sala (com porta cardeal centralizada)
        for (let c = cBand.min; c <= cBand.max; c++) {
          if (c < cBand.doorMin || c > cBand.doorMax) {
            grid[rBand.min][c] = '#';
          }
        }
        // Parede Sul da sala (com porta cardeal centralizada)
        for (let c = cBand.min; c <= cBand.max; c++) {
          if (c < cBand.doorMin || c > cBand.doorMax) {
            grid[rBand.max][c] = '#';
          }
        }
        // Parede Oeste da sala (com porta cardeal centralizada)
        for (let r = rBand.min; r <= rBand.max; r++) {
          if (r < rBand.doorMin || r > rBand.doorMax) {
            grid[r][cBand.min] = '#';
          }
        }
        // Parede Leste da sala (com porta cardeal centralizada)
        for (let r = rBand.min; r <= rBand.max; r++) {
          if (r < rBand.doorMin || r > rBand.doorMax) {
            grid[r][cBand.max] = '#';
          }
        }
      }
    }

    // 3.3 Alocação dos Geradores Provisórios (2x2 tiles)
    // Gerador A: Ala Nordeste (Laboratório) - centro (3072, 512)
    for (let r = 7; r <= 8; r++) {
      for (let c = 47; c <= 48; c++) {
        grid[r][c] = 'G';
      }
    }

    // Gerador B: Ala Sudoeste (Enfermaria) - centro (768, 2304)
    for (let r = 35; r <= 36; r++) {
      for (let c = 11; c <= 12; c++) {
        grid[r][c] = 'G';
      }
    }

    // Gerador C: Ala Sudeste (Sala de Máquinas) - centro (3072, 2304)
    for (let r = 35; r <= 36; r++) {
      for (let c = 47; c <= 48; c++) {
        grid[r][c] = 'G';
      }
    }

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
    // Os geradores têm colisão física gerenciada exclusivamente pelo grupo de obstáculos Arcade
    const navGrid: number[][] = [];
    for (let r = 0; r < ROWS; r++) {
      navGrid[r] = new Array(COLS);
      for (let c = 0; c < COLS; c++) {
        navGrid[r][c] = (grid[r][c] === '#') ? 1 : 0;
      }
    }

    const weightedGrid = buildAiWeightedGrid(navGrid);
    const easystar = new EasyStar.js();
    easystar.setGrid(weightedGrid);
    easystar.setAcceptableTiles([0, 2]);
    easystar.setTileCost(0, 1);
    easystar.setTileCost(2, 4);
    easystar.enableDiagonals();
    (easystar as any).disableCornerCutting?.();
    (easystar as any).enableSync?.();
    easystar.setIterationsPerCalculation(10000);

    // 6. Criar sinalização arquitetônica da instalação
    this.createFacilitySignage(scene);

    return {
      walls,
      obstacles,
      navGrid,
      easystar,
      grid
    };
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
    const warningLine = scene.add.rectangle(1920, 752, 256, 12, 0xca8a04, 0.85);
    warningLine.setStrokeStyle(1, 0x18181b);
    warningLine.setDepth(0.5);

    // Tapete demarcatório da Recepção Central (8x6 tiles alinhados ao grid: 512x384px centrado em 1920, 1408)
    const receptionCarpet = scene.add.rectangle(1920, 1408, 512, 384, 0x0f172a, 0.6);
    receptionCarpet.setStrokeStyle(1.5, 0x334155, 0.5);
    receptionCarpet.setDepth(0.3);

    // Marca central de spawn do jogador
    const spawnRing = scene.add.circle(1920, 1408, 36);
    spawnRing.setStrokeStyle(2, 0x38bdf8, 0.4);
    spawnRing.setDepth(0.4);
  }
}
