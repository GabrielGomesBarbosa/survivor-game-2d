/**
 * @file SkillCheckSystem.ts
 * @description Sistema de Quick Time Event (QTE / Skill Check) estilo Dead by Daylight.
 * Gerencia o widget circular com agulha giratória, zonas Great e Good, bipe de pré-aviso,
 * avaliação de entrada com a tecla [Espaço] e renderização do ping de ruído de explosão no mapa.
 */

import Phaser from 'phaser';
import { SoundFX } from './SoundFX';
import { evaluateSkillCheckHit } from '../utils/gameLogic';

export type SkillCheckResult = 'GREAT' | 'GOOD' | 'FAIL';

export class SkillCheckSystem {
  public isActive = false;
  public needleAngle = 0;
  public zoneStart = 120;
  public zoneSize = 44;
  public greatSize = 12;

  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private dialGraphic: Phaser.GameObjects.Graphics;
  private needleGraphic: Phaser.GameObjects.Graphics;
  private feedbackText: Phaser.GameObjects.Text;
  private nextTimer = 0;
  private isWarningPlayed = false;

  // Alerta de ruído no mapa (ping de explosão)
  private noiseAlertGraphic: Phaser.GameObjects.Graphics;
  private noiseAlertTimer = 0;
  private noiseAlertPos = { x: 0, y: 0 };

  /**
   * Avaliação matemática pura de acerto do Skill Check.
   * @param {number} angle - Ângulo atual da agulha (em graus).
   * @param {number} zoneStart - Ângulo de início da zona de acerto.
   * @param {number} zoneSize - Amplitude angular da zona total (Good Zone).
   * @param {number} greatSize - Amplitude angular da zona de perfeição (Great Zone).
   * @returns {SkillCheckResult} 'GREAT' (+5%), 'GOOD' (+1.5%) ou 'FAIL'.
   */
  public static evaluateHit(
    angle: number,
    zoneStart: number,
    zoneSize: number,
    greatSize: number
  ): SkillCheckResult {
    return evaluateSkillCheckHit(angle, zoneStart, zoneSize, greatSize);
  }

  /**
   * Inicializa o sistema de Skill Check e seus elementos de interface gráfica.
   * @param {Phaser.Scene} scene - A cena do Phaser.
   */
  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    // 1. Container centralizado do widget QTE
    this.container = scene.add.container(640, 360);
    this.container.setScrollFactor(0);
    this.container.setDepth(250);
    this.container.setVisible(false);

    this.dialGraphic = scene.add.graphics();
    this.needleGraphic = scene.add.graphics();

    this.feedbackText = scene.add.text(0, -82, '', {
      fontSize: '16px',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5);

    const promptHint = scene.add.text(0, 0, '[ESPAÇO]', {
      fontSize: '11px',
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5);

    this.container.add([
      this.dialGraphic,
      this.needleGraphic,
      promptHint,
      this.feedbackText
    ]);

    // 2. Gráfico para exibição de ping de ruído no mundo
    this.noiseAlertGraphic = scene.add.graphics();
    this.noiseAlertGraphic.setDepth(9);

    // 3. Listener da tecla Espaço com prioridade de captura
    window.addEventListener('keydown', this.onWindowKeyDown, true);
  }

  private onWindowKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space' && this.isActive) {
      e.preventDefault();
      this.handleInput();
    }
  };

  /**
   * Remove listeners globais.
   */
  public destroy(): void {
    window.removeEventListener('keydown', this.onWindowKeyDown, true);
    this.container.destroy();
    this.noiseAlertGraphic.destroy();
  }

  /**
   * Reinicia o temporizador de disparo para o próximo Skill Check.
   * @param {number} frequencySeconds - Intervalo base configurado no painel.
   */
  public resetTimer(frequencySeconds: number): void {
    const base = Math.max(1.5, frequencySeconds);
    this.nextTimer = Phaser.Math.Between(base * 800, base * 1300);
    this.isWarningPlayed = false;
  }

  /**
   * Inicia imediatamente um novo Skill Check na tela.
   */
  public startSkillCheck(onResolve?: (result: SkillCheckResult) => void): void {
    if (onResolve) {
      this.lastResolveCallback = onResolve;
    }
    this.isActive = true;
    this.isWarningPlayed = false;
    this.needleAngle = 0;

    // Sorteia posição da zona entre 110° e 260° para fornecer tempo hábil de reação
    this.zoneStart = Phaser.Math.Between(110, 260);
    this.zoneSize = 44;
    this.greatSize = 12;

    this.drawDial();
    this.drawNeedle();
    this.feedbackText.setText('');
    this.container.setVisible(true);
  }

  /**
   * Atualização por frame do Skill Check e do indicador de ruído.
   * @param {number} delta - Tempo delta em ms.
   * @param {boolean} isRepairing - True se o jogador estiver ativamente consertando.
   * @param {number} frequencySeconds - Frequência configurada de QTE.
   * @param {boolean} canTrigger - Se não há stagger de explosão impedindo o reparo.
   * @param {(result: SkillCheckResult) => void} onResolve - Callback ao finalizar o teste.
   */
  public update(
    delta: number,
    isRepairing: boolean,
    frequencySeconds: number,
    canTrigger: boolean,
    onResolve: (result: SkillCheckResult) => void
  ): void {
    this.lastResolveCallback = onResolve;

    // 1. Contagem regressiva para novo QTE durante reparo
    if (isRepairing && !this.isActive && canTrigger) {
      this.nextTimer -= delta;

      // Aviso sonoro 550ms antes
      if (this.nextTimer <= 550 && !this.isWarningPlayed) {
        this.isWarningPlayed = true;
        SoundFX.playWarningCue();
      }

      if (this.nextTimer <= 0) {
        this.startSkillCheck();
      }
    }

    // 2. Animação da agulha no teste ativo
    if (this.isActive) {
      const needleSpeed = 330; // Graus por segundo (~1.09s por volta)
      this.needleAngle += needleSpeed * (delta / 1000);
      this.drawNeedle();

      // Expiração do timing (passou da zona sem pressionar Espaço)
      if (this.needleAngle > this.zoneStart + this.zoneSize + 12) {
        this.resolve('FAIL', onResolve);
      }
    }

    // 3. Atualizar animação de onda do ping de ruído de explosão
    this.updateNoiseAlert(delta);
  }

  /**
   * Trata o aperto da tecla [Espaço].
   */
  public handleInput(onResolve?: (result: SkillCheckResult) => void): SkillCheckResult {
    if (!this.isActive) return 'FAIL';

    const result = SkillCheckSystem.evaluateHit(
      this.needleAngle,
      this.zoneStart,
      this.zoneSize,
      this.greatSize
    );

    if (onResolve) {
      this.resolve(result, onResolve);
    } else {
      // Usado pelo listener de teclado
      this.resolve(result, this.lastResolveCallback || (() => {}));
    }
    return result;
  }

  private lastResolveCallback?: (result: SkillCheckResult) => void;

  /**
   * Finaliza o Skill Check com feedback visual e sonoro.
   */
  public resolve(result: SkillCheckResult, callback: (result: SkillCheckResult) => void): void {
    this.isActive = false;
    this.needleGraphic.clear();
    this.lastResolveCallback = callback;

    if (result === 'GREAT') {
      SoundFX.playSuccess(true);
      this.showFeedback('⭐ PERFEITO! +5%', '#22c55e');
    } else if (result === 'GOOD') {
      SoundFX.playSuccess(false);
      this.showFeedback('👍 BOM! +1.5%', '#38bdf8');
    } else {
      this.showFeedback('💥 FALHA!', '#ef4444');
    }

    callback(result);

    this.scene.time.delayedCall(600, () => {
      if (!this.isActive) {
        this.container.setVisible(false);
        this.dialGraphic.clear();
      }
    });
  }

  /**
   * Cancela o Skill Check atual.
   * @param {boolean} triggerFailure - Se true, resolve como falha (ex: soltar a tecla de reparo).
   */
  public cancelSkillCheck(triggerFailure: boolean = true): void {
    if (!this.isActive) return;
    if (triggerFailure && this.lastResolveCallback) {
      this.resolve('FAIL', this.lastResolveCallback);
    } else {
      this.isActive = false;
      this.needleGraphic.clear();
      this.container.setVisible(false);
      this.dialGraphic.clear();
    }
  }

  private showFeedback(text: string, color: string): void {
    this.feedbackText.setText(text);
    this.feedbackText.setColor(color);
    this.feedbackText.setScale(1.4);
    this.scene.tweens.killTweensOf(this.feedbackText);
    this.scene.tweens.add({
      targets: this.feedbackText,
      scale: 1,
      duration: 300,
      ease: 'Back.Out'
    });
  }

  /**
   * Renderiza a base circular, zona Good e zona Great do widget QTE.
   */
  private drawDial(): void {
    this.dialGraphic.clear();

    const toRad = (deg: number) => Phaser.Math.DegToRad(deg - 90);

    // Fundo
    this.dialGraphic.fillStyle(0x0f172a, 0.8);
    this.dialGraphic.fillCircle(0, 0, 64);

    // Borda
    this.dialGraphic.lineStyle(2, 0x334155, 0.9);
    this.dialGraphic.strokeCircle(0, 0, 64);

    // Trilha da agulha
    this.dialGraphic.lineStyle(8, 0x1e293b, 0.85);
    this.dialGraphic.strokeCircle(0, 0, 50);

    // Zona Good (branca)
    const goodStartRad = toRad(this.zoneStart);
    const goodEndRad = toRad(this.zoneStart + this.zoneSize);
    this.dialGraphic.lineStyle(10, 0xe2e8f0, 0.9);
    this.dialGraphic.beginPath();
    this.dialGraphic.arc(0, 0, 50, goodStartRad, goodEndRad, false);
    this.dialGraphic.strokePath();

    // Zona Great (verde)
    const greatStartRad = toRad(this.zoneStart);
    const greatEndRad = toRad(this.zoneStart + this.greatSize);
    this.dialGraphic.lineStyle(12, 0x22c55e, 1);
    this.dialGraphic.beginPath();
    this.dialGraphic.arc(0, 0, 50, greatStartRad, greatEndRad, false);
    this.dialGraphic.strokePath();

    // Marcador delimitador de início
    this.dialGraphic.lineStyle(2, 0xef4444, 0.8);
    this.dialGraphic.lineBetween(
      Math.cos(greatStartRad) * 42,
      Math.sin(greatStartRad) * 42,
      Math.cos(greatStartRad) * 58,
      Math.sin(greatStartRad) * 58
    );
  }

  /**
   * Renderiza a agulha giratória apontando para o ângulo atual.
   */
  private drawNeedle(): void {
    this.needleGraphic.clear();

    const needleRad = Phaser.Math.DegToRad(this.needleAngle - 90);
    const nx = Math.cos(needleRad) * 58;
    const ny = Math.sin(needleRad) * 58;

    this.needleGraphic.lineStyle(3.5, 0xef4444, 1);
    this.needleGraphic.lineBetween(0, 0, nx, ny);

    this.needleGraphic.fillStyle(0xef4444, 1);
    this.needleGraphic.fillCircle(nx, ny, 3.5);
    this.needleGraphic.fillCircle(0, 0, 5);
  }

  /**
   * Aciona a exibição do ping concêntrico de ruído de explosão no mapa.
   * @param {number} x - Coordenada horizontal da fonte do ruído.
   * @param {number} y - Coordenada vertical da fonte do ruído.
   */
  public triggerNoiseAlert(x: number, y: number): void {
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

    this.noiseAlertGraphic.lineStyle(3, 0xffaa00, alpha * 0.9);
    this.noiseAlertGraphic.strokeCircle(this.noiseAlertPos.x, this.noiseAlertPos.y, radius);

    this.noiseAlertGraphic.fillStyle(0xff3300, alpha * 0.22);
    this.noiseAlertGraphic.fillCircle(this.noiseAlertPos.x, this.noiseAlertPos.y, 16);

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
}
