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

    // 3. Montar malha lógica da planta baixa (40 colunas x 30 linhas)
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
    for (let c = 13; c <= 26; c++) {
      if (c < 18 || c > 21) {
        grid[9][c] = '#';
        grid[20][c] = '#';
      }
    }
    for (let r = 9; r <= 20; r++) {
      if (r < 14 || r > 16) {
        grid[r][13] = '#';
        grid[r][26] = '#';
      }
    }

    // 3.3 Ala Oeste - Enfermaria & Gerador B (Cols 1..9, Rows 9..20)
    for (let r = 9; r <= 20; r++) {
      if ((r >= 9 && r <= 10) || (r >= 14 && r <= 15) || (r >= 19 && r <= 20)) {
        grid[r][9] = '#';
      }
    }
    for (let c = 1; c <= 9; c++) {
      if (c < 4 || c > 6) {
        grid[9][c] = '#';
        grid[20][c] = '#';
      }
    }
    for (let r = 14; r <= 15; r++) {
      for (let c = 4; c <= 5; c++) {
        grid[r][c] = 'G';
      }
    }

    // 3.4 Ala Leste - Usina & Gerador A (Cols 30..38, Rows 9..20)
    for (let r = 9; r <= 20; r++) {
      if ((r >= 9 && r <= 10) || (r >= 14 && r <= 15) || (r >= 19 && r <= 20)) {
        grid[r][30] = '#';
      }
    }
    for (let c = 30; c <= 38; c++) {
      if (c < 33 || c > 35) {
        grid[9][c] = '#';
        grid[20][c] = '#';
      }
    }
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
    for (let c = 13; c <= 26; c++) {
      if (c < 18 || c > 21) {
        grid[5][c] = '#';
      }
    }
    for (let c = 1; c <= 9; c++) {
      if (c < 4 || c > 6) grid[5][c] = '#';
    }
    for (let c = 30; c <= 38; c++) {
      if (c < 33 || c > 35) grid[5][c] = '#';
    }

    // 3.6 Ala Sul - Manutenção & Depósito / Gerador C (Cols 13..26, Rows 24..28)
    for (let r = 24; r <= 28; r++) {
      grid[r][13] = '#';
      grid[r][26] = '#';
    }
    for (let c = 13; c <= 26; c++) {
      if (c < 18 || c > 21) {
        grid[24][c] = '#';
      }
    }
    for (let c = 1; c <= 9; c++) {
      if (c < 4 || c > 6) grid[24][c] = '#';
    }
    for (let c = 30; c <= 38; c++) {
      if (c < 33 || c > 35) grid[24][c] = '#';
    }
    for (let r = 25; r <= 26; r++) {
      for (let c = 19; c <= 20; c++) {
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
    // Linha amarela de advertência do Bloco de Contenção (Spawn Killer)
    const warningLine = scene.add.rectangle(1280, 368, 256, 12, 0xca8a04, 0.85);
    warningLine.setStrokeStyle(1, 0x18181b);
    warningLine.setDepth(0.5);

    // Tapete demarcatório da Recepção Central (8x6 tiles alinhados ao grid: 512x384px)
    const receptionCarpet = scene.add.rectangle(1280, 960, 512, 384, 0x0f172a, 0.6);
    receptionCarpet.setStrokeStyle(1.5, 0x334155, 0.5);
    receptionCarpet.setDepth(0.3);

    // Marca central de spawn do jogador
    const spawnRing = scene.add.circle(1280, 960, 36);
    spawnRing.setStrokeStyle(2, 0x38bdf8, 0.4);
    spawnRing.setDepth(0.4);
  }
}
