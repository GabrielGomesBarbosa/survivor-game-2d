/**
 * @file GeneratorPlacer.ts
 * @description Ferramenta interativa de editor de spawns de geradores para o Sandbox Debug.
 * Permite posicionar candidatos com holograma translúcido, girar com tecla [R],
 * validar slots acessíveis (estilo Dead by Daylight), e exportar/remover candidatos.
 */

import Phaser from 'phaser';
import {
  validateGeneratorPlacement,
  addSpawnCandidate,
  removeSpawnCandidate,
  findCandidateAtPosition,
  exportCandidatesToJson,
  loadCandidatesFromStorage,
  saveCandidatesToStorage,
  clearCandidatesFromStorage,
  GeneratorSpawnCandidate,
  GeneratorPlacementValidation
} from '../utils/gameLogic';
import { WORLD_WIDTH, WORLD_HEIGHT, TILE_SIZE } from '../config/constants';

export interface GeneratorPlacerConfig {
  scene: Phaser.Scene;
  navGrid: number[][];
  onNotify?: (message: string, isAlert?: boolean) => void;
}

export class GeneratorPlacer {
  private scene: Phaser.Scene;
  private navGrid: number[][];
  private onNotify?: (message: string, isAlert?: boolean) => void;

  public isActive: boolean = false;
  public currentRotation: number = 0; // 0°, 90°, 180°, 270°
  public snapToGrid: boolean = true; // Snap suave a 32px ou livre
  public candidates: GeneratorSpawnCandidate[] = [];

  // Elementos gráficos do Phaser
  private hologramGraphics: Phaser.GameObjects.Graphics;
  private hologramText: Phaser.GameObjects.Text;
  private candidatesGraphics: Phaser.GameObjects.Graphics;
  private candidateLabels: Phaser.GameObjects.Text[] = [];

  // Último resultado de validação do ponteiro
  private lastValidation: GeneratorPlacementValidation | null = null;
  private lastCursorPos: { x: number; y: number } = { x: 0, y: 0 };

  constructor(config: GeneratorPlacerConfig) {
    this.scene = config.scene;
    this.navGrid = config.navGrid;
    this.onNotify = config.onNotify;

    // Inicializar camadas gráficas dedicadas
    this.candidatesGraphics = this.scene.add.graphics();
    this.candidatesGraphics.setDepth(990);

    this.hologramGraphics = this.scene.add.graphics();
    this.hologramGraphics.setDepth(995);

    this.hologramText = this.scene.add.text(0, 0, '', {
      fontSize: '12px',
      color: '#ffffff',
      backgroundColor: '#090d16cc',
      padding: { x: 6, y: 3 },
      fontFamily: 'monospace'
    });
    this.hologramText.setOrigin(0.5, 1.2);
    this.hologramText.setDepth(996);
    this.loadFromStorage();
    this.setupInputListeners();
    this.redrawCandidates();
    if (this.candidates.length > 0) {
      this.onNotify?.(`📦 ${this.candidates.length} candidatos de geradores restaurados do armazenamento local.`, false);
    }
  }

  /**
   * Carrega os candidatos a partir do localStorage do navegador.
   */
  public loadFromStorage(): void {
    this.candidates = loadCandidatesFromStorage();
  }

  /**
   * Salva a lista atual de candidatos no localStorage do navegador.
   */
  public saveToStorage(): void {
    saveCandidatesToStorage(this.candidates);
  }

  /**
   * Configura listeners de teclado e ponteiro do mouse para o modo editor.
   */
  private setupInputListeners(): void {
    // Tecla [R] para alternar rotação
    this.scene.input.keyboard?.on('keydown-R', () => {
      if (this.isActive) {
        this.cycleRotation();
      }
    });

    // Desativar menu de contexto do navegador para uso nativo do RMB (botão direito)
    this.scene.game.canvas.addEventListener('contextmenu', (e) => {
      if (this.isActive) {
        e.preventDefault();
      }
    });
  }

  /**
   * Ativa ou desativa o modo de posicionamento de geradores.
   */
  public setActive(active: boolean): void {
    this.isActive = active;
    this.candidatesGraphics.setVisible(active);
    this.candidateLabels.forEach((label) => label.setVisible(active));
    if (!this.isActive) {
      this.hologramGraphics.clear();
      this.hologramText.setVisible(false);
    } else {
      this.hologramText.setVisible(true);
      this.onNotify?.('🛠️ Modo Posicionamento Ativo: Clique LMB para fixar, RMB para remover, [R] para girar.', false);
    }
  }

  /**
   * Alterna a rotação atual em passos de 90° (0° -> 90° -> 180° -> 270° -> 0°).
   */
  public cycleRotation(): void {
    this.currentRotation = (this.currentRotation + 90) % 360;
    this.onNotify?.(`🔄 Rotação do Gerador: ${this.currentRotation}°`, false);
  }

  /**
   * Atualiza a posição do holograma e a validação de slots a cada frame com base no mouse.
   */
  public update(pointer: Phaser.Input.Pointer): void {
    if (!this.isActive) return;

    // Calcular coordenadas no World Space
    let worldX = pointer.worldX;
    let worldY = pointer.worldY;

    if (this.snapToGrid) {
      // Snap suave para múltiplos de 32px (meio-tile / centro ou borda)
      worldX = Math.round(worldX / 32) * 32;
      worldY = Math.round(worldY / 32) * 32;
    } else {
      worldX = Math.round(worldX);
      worldY = Math.round(worldY);
    }

    this.lastCursorPos = { x: worldX, y: worldY };

    // Validar regras físicas e slots disponíveis
    const validation = validateGeneratorPlacement(
      worldX,
      worldY,
      this.currentRotation,
      this.navGrid,
      TILE_SIZE,
      WORLD_WIDTH,
      WORLD_HEIGHT
    );
    this.lastValidation = validation;

    this.renderHologram(worldX, worldY, validation);
  }

  /**
   * Trata cliques do mouse (LMB para fixar candidato, RMB para remover).
   * Retorna true se o evento foi consumido pelo editor.
   */
  public handlePointerDown(pointer: Phaser.Input.Pointer): boolean {
    if (!this.isActive) return false;

    const worldX = pointer.worldX;
    const worldY = pointer.worldY;

    // Clique com botão direito (RMB): Remover candidato sob o cursor
    if (pointer.rightButtonDown()) {
      const target = findCandidateAtPosition(this.candidates, worldX, worldY, 45);
      if (target) {
        this.candidates = removeSpawnCandidate(this.candidates, target.id);
        this.saveToStorage();
        this.redrawCandidates();
        this.onNotify?.(`🗑️ Candidato #${target.id} removido.`, false);
        return true;
      }
      return false;
    }

    // Clique com botão esquerdo (LMB): Inserir novo ponto candidato
    if (pointer.leftButtonDown()) {
      // Verificar se não está clicando para remover
      if (this.lastValidation && this.lastValidation.isValid) {
        const candidate = {
          x: this.lastCursorPos.x,
          y: this.lastCursorPos.y,
          rotation: this.currentRotation,
          maxSurvivors: this.lastValidation.maxSurvivors
        };

        this.candidates = addSpawnCandidate(this.candidates, candidate);
        this.saveToStorage();
        const added = this.candidates[this.candidates.length - 1];
        this.redrawCandidates();
        this.onNotify?.(
          `✅ Candidato #${added.id} fixado! (${added.maxSurvivors} ${added.maxSurvivors === 1 ? 'slot livre' : 'slots livres'})`,
          false
        );
        return true;
      } else {
        this.onNotify?.('⚠️ Posição inválida! Hitbox sobreposta a paredes ou sem slots acessíveis.', true);
        return true;
      }
    }

    return false;
  }

  /**
   * Renderiza o holograma translúcido do gerador com feedback visual imediato.
   */
  private renderHologram(x: number, y: number, val: GeneratorPlacementValidation): void {
    this.hologramGraphics.clear();

    const { left, top, width, height } = val.hitboxBounds;

    // Cores: Verde se for válido, Vermelho se houver colisão de parede ou borda
    const fillColor = val.isValid ? 0x22c55e : 0xef4444;
    const strokeColor = val.isValid ? 0x4ade80 : 0xf87171;
    const fillAlpha = val.isValid ? 0.35 : 0.55;

    // Corpo translúcido do gerador
    this.hologramGraphics.fillStyle(fillColor, fillAlpha);
    this.hologramGraphics.fillRect(left, top, width, height);

    this.hologramGraphics.lineStyle(2, strokeColor, 0.95);
    this.hologramGraphics.strokeRect(left, top, width, height);

    // Indicador central de orientação
    this.hologramGraphics.lineStyle(1.5, 0xffffff, 0.7);
    this.hologramGraphics.strokeCircle(x, y, 6);

    // Indicadores dos 4 lados cardeais (slots livres estilo DBD)
    const renderSlotPip = (px: number, py: number, isOpen: boolean) => {
      const pipColor = isOpen ? 0x22c55e : 0xef4444;
      this.hologramGraphics.fillStyle(pipColor, 0.9);
      this.hologramGraphics.fillCircle(px, py, 4);
      this.hologramGraphics.lineStyle(1, 0x000000, 0.8);
      this.hologramGraphics.strokeCircle(px, py, 4);
    };

    renderSlotPip(x, top - 12, val.accessibleSides.north);
    renderSlotPip(x, top + height + 12, val.accessibleSides.south);
    renderSlotPip(left + width + 12, y, val.accessibleSides.east);
    renderSlotPip(left - 12, y, val.accessibleSides.west);

    // Atualizar texto informativo flutuante
    let statusMsg = '';
    if (val.isOutOfBounds) {
      statusMsg = 'FORA DOS LIMITES DO MAPA';
    } else if (val.isCollidingWithWall) {
      statusMsg = 'COLISÃO COM PAREDE';
    } else {
      statusMsg = `${val.maxSurvivors} ${val.maxSurvivors === 1 ? 'SLOT LIVRE' : 'SLOTS LIVRES'}`;
    }

    this.hologramText.setPosition(x, top - 14);
    this.hologramText.setText(`[R] Girar (${this.currentRotation}°) | ${statusMsg}`);
    this.hologramText.setColor(val.isValid ? '#4ade80' : '#f87171');
    this.hologramText.setVisible(true);

    // Compensar escala para manter texto nítido independente do zoom
    const zoom = this.scene.cameras.main.zoom || 1.0;
    this.hologramText.setScale(1 / zoom);
  }

  /**
   * Redesenha todas as silhuetas e etiquetas dos candidatos fixados no mapa.
   */
  public redrawCandidates(): void {
    this.candidatesGraphics.clear();
    this.candidatesGraphics.setVisible(this.isActive);

    // Limpar etiquetas textuais anteriores
    this.candidateLabels.forEach((label) => label.destroy());
    this.candidateLabels = [];

    const zoom = this.scene.cameras.main.zoom || 1.0;

    for (const c of this.candidates) {
      const isHorizontal = c.rotation === 90 || c.rotation === 270;
      const w = isHorizontal ? 112 : 50;
      const h = isHorizontal ? 50 : 112;
      const left = c.x - w / 2;
      const top = c.y - h / 2;

      // Silhueta do candidato fixado (Estilo DBD blueprint)
      this.candidatesGraphics.fillStyle(0x0284c7, 0.4);
      this.candidatesGraphics.fillRect(left, top, w, h);

      this.candidatesGraphics.lineStyle(2, 0x38bdf8, 0.9);
      this.candidatesGraphics.strokeRect(left, top, w, h);

      // Marcação do centro e cantos
      this.candidatesGraphics.fillStyle(0x38bdf8, 0.8);
      this.candidatesGraphics.fillCircle(c.x, c.y, 4);

      // Etiqueta numerada sobre o marcador
      const badgeText = this.scene.add.text(
        c.x,
        top - 10,
        `#${c.id} (${c.maxSurvivors}s)`,
        {
          fontSize: '11px',
          color: '#e0f2fe',
          backgroundColor: '#0369a1dd',
          padding: { x: 4, y: 2 },
          fontFamily: 'monospace'
        }
      );
      badgeText.setOrigin(0.5, 1);
      badgeText.setDepth(991);
      badgeText.setScale(1 / zoom);
      badgeText.setVisible(this.isActive);
      this.candidateLabels.push(badgeText);
    }
  }

  /**
   * Atualiza a escala de zoom dos textos dos candidatos quando a câmera altera o zoom.
   */
  public updateZoomScale(zoom: number): void {
    const scale = 1 / Math.max(0.1, zoom);
    this.hologramText.setScale(scale);
    this.candidateLabels.forEach((label) => label.setScale(scale));
  }

  /**
   * Exporta a lista de candidatos para JSON estruturado e copia para a área de transferência.
   */
  public copyCandidatesJson(): void {
    if (this.candidates.length === 0) {
      this.onNotify?.('⚠️ Nenhum candidato foi marcado ainda para exportar.', true);
      return;
    }

    const json = exportCandidatesToJson(this.candidates);
    console.log('--- CANDIDATOS DE GERADORES EXPORTADOS (JSON) ---');
    console.log(json);

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard
        .writeText(json)
        .then(() => {
          this.onNotify?.(`📋 ${this.candidates.length} candidatos copiados para a área de transferência!`, false);
        })
        .catch(() => {
          this.onNotify?.(`📋 ${this.candidates.length} candidatos impressos no console do navegador!`, false);
        });
    } else {
      this.onNotify?.(`📋 ${this.candidates.length} candidatos impressos no console do navegador!`, false);
    }
  }

  /**
   * Limpa todos os candidatos marcados na sessão atual e no localStorage.
   */
  public clearCandidates(): void {
    const count = this.candidates.length;
    this.candidates = [];
    clearCandidatesFromStorage();
    this.redrawCandidates();
    this.onNotify?.(`🧹 ${count} candidatos marcados foram limpos e removidos do armazenamento.`, false);
  }

  /**
   * Destrói todos os elementos visuais do editor.
   */
  public destroy(): void {
    this.hologramGraphics.destroy();
    this.hologramText.destroy();
    this.candidatesGraphics.destroy();
    this.candidateLabels.forEach((l) => l.destroy());
    this.candidateLabels = [];
  }
}
