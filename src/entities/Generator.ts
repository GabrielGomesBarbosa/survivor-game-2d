/**
 * @file Generator.ts
 * @description Entidade de Gerador (estilo Dead by Daylight).
 * Gerencia colisão estática, zona de interação no piso, barra flutuante de progresso,
 * transição entre os 3 frames do spritesheet (inativo, faíscas/reparo e concluído) e efeitos de explosão.
 */

import Phaser from 'phaser';
import { SoundFX } from '../systems/SoundFX';
import { addGeneratorProgress, applyExplosionPenalty } from '../utils/gameLogic';

export interface GeneratorDef {
  id: string;
  name: string;
  roomName: string;
  x: number;
  y: number;
}

export class Generator {
  public id: string;
  public name: string;
  public roomName: string;
  public x: number;
  public y: number;

  public progress = 0; // 0 a 100
  public isCompleted = false;
  public interactionRadius = 95;

  public container: Phaser.GameObjects.Container;
  public sprite: Phaser.GameObjects.Sprite;
  public progressBarFill: Phaser.GameObjects.Rectangle;
  public progressText: Phaser.GameObjects.Text;
  public floorZone: Phaser.GameObjects.Arc;
  public solidBlock: Phaser.GameObjects.Rectangle;

  private scene: Phaser.Scene;

  /**
   * Instancia e inicializa o gerador no cenário com seus componentes gráficos e físicos.
   * @param {Phaser.Scene} scene - Cena do Phaser.
   * @param {GeneratorDef} def - Definição de identificação e coordenadas.
   * @param {Phaser.Physics.Arcade.StaticGroup} obstaclesGroup - Grupo de obstáculos sólidos para registro de colisão.
   */
  constructor(scene: Phaser.Scene, def: GeneratorDef, obstaclesGroup: Phaser.Physics.Arcade.StaticGroup) {
    this.scene = scene;
    this.id = def.id;
    this.name = def.name;
    this.roomName = def.roomName;
    this.x = def.x;
    this.y = def.y;

    // 1. Zona circular de interação no piso (95px)
    this.floorZone = scene.add.circle(def.x, def.y, this.interactionRadius);
    this.floorZone.setStrokeStyle(2, 0xffaa00, 0.4);
    this.floorZone.setFillStyle(0xffaa00, 0.04);
    this.floorZone.setDepth(1);

    // 2. Colisor físico estático sólido para Player e Killer (76x88px)
    this.solidBlock = scene.add.rectangle(def.x, def.y, 76, 88, 0x000000, 0);
    obstaclesGroup.add(this.solidBlock);
    const solidBody = this.solidBlock.body as Phaser.Physics.Arcade.StaticBody;
    if (solidBody) {
      solidBody.updateFromGameObject();
    }

    // 3. Container com o sprite do gerador e indicadores
    this.container = scene.add.container(def.x, def.y);
    this.container.setDepth(3);

    const shadow = scene.add.ellipse(0, 10, 80, 92, 0x06080e, 0.45);

    // Sprite do Gerador carregado a partir de generator.png (Frame 0: Inativo / Danificado com LED vermelho)
    this.sprite = scene.add.sprite(0, -4, 'generator', 0);
    this.sprite.setScale(0.095);
    this.sprite.setOrigin(0.5, 0.5);

    // Mini indicador de status flutuante sobre o gerador
    const labelText = scene.add.text(0, -78, `${def.name} • ${def.roomName}`, {
      fontSize: '11px',
      color: '#94a3b8',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5);

    const barBg = scene.add.rectangle(0, -64, 68, 8, 0x0f172a);
    barBg.setStrokeStyle(1, 0x334155);

    this.progressBarFill = scene.add.rectangle(-33, -64, 0, 6, 0xf59e0b);
    this.progressBarFill.setOrigin(0, 0.5);

    this.progressText = scene.add.text(0, -52, '0%', {
      fontSize: '10px',
      color: '#e2e8f0',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5);

    this.container.add([
      shadow,
      this.sprite,
      labelText,
      barBg,
      this.progressBarFill,
      this.progressText
    ]);
  }

  /**
   * Altera diretamente o frame visual do spritesheet do gerador.
   * @param {number} frame - 0: Inativo, 1: Em reparo/faíscas, 2: Concluído/energizado.
   */
  public setFrame(frame: 0 | 1 | 2): void {
    if (this.sprite && this.sprite.frame.name !== String(frame)) {
      this.sprite.setFrame(frame);
    }
  }

  /**
   * Atualiza a barra de progresso, cores de preenchimento e frame visual do gerador.
   * @param {boolean} isRepairingThisGen - True se o jogador estiver atualmente consertando este gerador específico.
   */
  public updateVisuals(isRepairingThisGen: boolean = false): void {
    const pct = Math.floor(this.progress);

    if (this.isCompleted) {
      this.setFrame(2);
      this.progressBarFill.width = 66;
      this.progressBarFill.setFillStyle(0x00ff88);
      this.progressText.setText('CONCLUÍDO');
      this.progressText.setColor('#00ff88');

      this.floorZone.setStrokeStyle(2, 0x00ff88, 0.5);
      this.floorZone.setFillStyle(0x00ff88, 0.06);
    } else {
      if (isRepairingThisGen) {
        this.setFrame(1);
      } else {
        this.setFrame(0);
      }

      this.progressBarFill.width = Math.max(0, Math.min(66, (pct / 100) * 66));
      const fillColor = pct > 75 ? 0x84cc16 : pct > 35 ? 0xf59e0b : 0xef4444;
      this.progressBarFill.setFillStyle(fillColor);
      this.progressText.setText(`${pct}%`);
      this.progressText.setColor('#e2e8f0');

      this.floorZone.setStrokeStyle(2, 0xffaa00, 0.4);
      this.floorZone.setFillStyle(0xffaa00, 0.04);
    }
  }

  /**
   * Acrescenta progresso ao gerador de forma segura, limitando a 100%.
   * @param {number} amount - Quantidade percentual a somar.
   * @returns {boolean} True se o gerador atingiu 100% com esta adição.
   */
  public addProgress(amount: number): boolean {
    if (this.isCompleted) return false;

    const result = addGeneratorProgress(this.progress, amount);
    this.progress = result.progress;
    this.updateVisuals(true);

    if (result.isCompleted) {
      this.complete();
      return true;
    }
    return false;
  }

  /**
   * Conclui permanentemente o gerador, tocando áudio harmônico e ativando luz verde e Frame 2.
   */
  public complete(): void {
    this.isCompleted = true;
    this.progress = 100;
    this.setFrame(2);
    SoundFX.playCompletion();
    this.updateVisuals(false);
  }

  /**
   * Dispara a explosão por falha no Skill Check:
   * - Reduz progresso em 10%
   * - Volta para Frame 0 danificado
   * - Emite faíscas físicas e som de detonação
   */
  public explode(): void {
    SoundFX.playExplosion();
    this.scene.cameras.main.shake(350, 0.014);
    this.scene.cameras.main.flash(200, 220, 60, 20);

    this.setFrame(0);
    this.progress = applyExplosionPenalty(this.progress, 10);
    this.updateVisuals(false);
    this.createExplosionBurst();
  }

  /**
   * Cria emissão radial de faíscas cintilantes ao explodir o gerador.
   */
  private createExplosionBurst(): void {
    const colors = [0xffdd44, 0xff8822, 0xff2200, 0xffffff];
    for (let i = 0; i < 22; i++) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const speed = Phaser.Math.Between(70, 240);
      const color = Phaser.Math.RND.pick(colors);
      const radius = Phaser.Math.Between(2, 5);
      const spark = this.scene.add.circle(this.x, this.y, radius, color);
      spark.setDepth(12);

      this.scene.tweens.add({
        targets: spark,
        x: this.x + Math.cos(angle) * speed,
        y: this.y + Math.sin(angle) * speed,
        alpha: 0,
        scale: 0.2,
        duration: Phaser.Math.Between(350, 650),
        ease: 'Cubic.Out',
        onComplete: () => spark.destroy()
      });
    }
  }

  /**
   * Reseta o gerador para o estado inativo (0% de progresso).
   */
  public reset(): void {
    this.progress = 0;
    this.isCompleted = false;
    this.setFrame(0);
    this.updateVisuals(false);
  }
}
