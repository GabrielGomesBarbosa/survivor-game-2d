import Phaser from 'phaser';
import { formatGeneratorsHudText, calculateZoomCompensationScale, pixelsToMeters } from '../utils/gameLogic';
import { calculateTerrorCadence } from '../audio/AudioManager';
import { TERROR_RADIUS_MAX } from '../config/constants';

/**
 * @class TelemetryHUD
 * @description Manages top telemetry status indicators (FPS, Killer State, Killer Distance,
 * Generator Completion) in the DOM, as well as the in-game notification toast alerts.
 */
export class TelemetryHUD {
  private scene: Phaser.Scene;
  private alertContainer!: Phaser.GameObjects.Container;
  private alertText!: Phaser.GameObjects.Text;
  private alertBg!: Phaser.GameObjects.Rectangle;

  // Heartbeat Visual & Screen Vignette
  private heartContainer!: Phaser.GameObjects.Container;
  private heartGraphics!: Phaser.GameObjects.Graphics;
  private heartGlowGraphics!: Phaser.GameObjects.Graphics;
  private vignetteGraphics!: Phaser.GameObjects.Graphics;
  private isBeating: boolean = false;
  private currentIntervalMs: number = 1000;
  private currentBaseAlpha: number = 0;
  private heartZoomScale: number = 1.0;
  private pulseDelayTimer: Phaser.Time.TimerEvent | null = null;

  // DOM elements cache
  private hudFpsVal: HTMLElement | null = null;
  private hudFpsDot: HTMLElement | null = null;
  private hudKillerState: HTMLElement | null = null;
  private hudKillerDist: HTMLElement | null = null;
  private hudGensVal: HTMLElement | null = null;

  /**
   * @param scene Phaser scene hosting the HUD container
   */
  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.initDOMCache();
    this.createAlertContainer();
    this.createHeartbeatVisual();
  }

  /**
   * Cache references to DOM telemetry elements in the header
   */
  private initDOMCache(): void {
    if (typeof document === 'undefined') return;
    this.hudFpsVal = document.getElementById('hud-fps-val');
    this.hudFpsDot = document.getElementById('hud-fps-dot');
    this.hudKillerState = document.getElementById('hud-killer-state');
    this.hudKillerDist = document.getElementById('hud-killer-dist');
    this.hudGensVal = document.getElementById('hud-gens-val');
  }

  /**
   * Creates the fixed on-screen notification alert banner
   */
  private createAlertContainer(): void {
    this.alertContainer = this.scene.add.container(640, 50);
    this.alertContainer.setScrollFactor(0);
    this.alertContainer.setDepth(200);
    this.alertContainer.setAlpha(0);

    this.alertBg = this.scene.add.rectangle(0, 0, 420, 44, 0x3d0b0b, 0.92);
    this.alertBg.setStrokeStyle(2, 0xff3333);

    this.alertText = this.scene.add.text(0, 0, '⚠️ VOCÊ FOI ATACADO PELO ASSASSINO!', {
      fontSize: '13px',
      color: '#ffdddd',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    this.alertContainer.add([this.alertBg, this.alertText]);
  }

  /**
   * Displays an animated notification toast banner at the top of the canvas
   * @param message Message to display
   * @param isDanger Whether to style as warning/danger (red) or success (green)
   */
  public showNotification(message: string, isDanger: boolean = true): void {
    if (!this.alertContainer || !this.alertText || !this.alertBg) return;

    this.alertText.setText(message);
    if (isDanger) {
      this.alertBg.setFillStyle(0x3d0b0b, 0.92);
      this.alertBg.setStrokeStyle(2, 0xff3333);
    } else {
      this.alertBg.setFillStyle(0x064e3b, 0.92);
      this.alertBg.setStrokeStyle(2, 0x10b981);
    }

    this.alertContainer.setAlpha(1);
    this.scene.tweens.killTweensOf(this.alertContainer);

    this.scene.tweens.add({
      targets: this.alertContainer,
      alpha: 0,
      duration: 800,
      delay: 1600,
      ease: 'Power2'
    });
  }

  /**
   * Shortcut to trigger the Killer attack alert notification
   */
  public showAttackAlert(): void {
    this.showNotification('⚠️ VOCÊ FOI ATACADO PELO ASSASSINO!', true);
  }

  /**
   * Dispara a notificação de vitória da partida quando a meta de geradores é concluída.
   */
  public showVictoryAlert(completed: number, target: number): void {
    this.showNotification(`🏆 VITÓRIA DOS SOBREVIVENTES! Meta de geradores atingida (${completed}/${target})!`, false);
  }

  /**
   * Updates real-time values in the top telemetry bar
   * @param fps Current actual frames per second
   * @param killerState Current AI state (PATROL | CHASE | STANDBY | DESATIVADO)
   * @param killerDist Formatted distance string (e.g. "240px")
   * @param completedGens Count of fully repaired generators
   * @param totalGens Total number of generators in map
   * @param requiredGens Meta de geradores necessários para a vitória da partida
   */
  public update(
    fps: number,
    killerState: string,
    killerDist: string,
    completedGens: number,
    totalGens: number,
    requiredGens?: number
  ): void {
    // Re-verify DOM elements if not yet found
    if (!this.hudFpsVal) this.initDOMCache();

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
      this.hudKillerState.textContent = killerState;
      if (killerState === 'CHASE') {
        this.hudKillerState.className = 'hud-val state-chase';
      } else if (killerState === 'DESATIVADO' || killerState === 'OFFLINE' || killerState === 'STANDBY') {
        this.hudKillerState.className = 'hud-val state-disabled';
      } else {
        this.hudKillerState.className = 'hud-val state-patrol';
      }
    }

    if (this.hudKillerDist) {
      let formattedDist = killerDist || '--';
      if (typeof formattedDist === 'string' && formattedDist.endsWith('px')) {
        const px = parseFloat(formattedDist);
        if (!Number.isNaN(px)) {
          formattedDist = `${pixelsToMeters(px).toFixed(1)}m`;
        }
      }
      this.hudKillerDist.textContent = formattedDist;
    }

    if (this.hudGensVal) {
      const target = requiredGens !== undefined ? requiredGens : totalGens;
      this.hudGensVal.textContent = formatGeneratorsHudText(completedGens, totalGens, requiredGens);

      if (totalGens === 0) {
        this.hudGensVal.style.color = '#94a3b8';

      } else if (completedGens >= target && target > 0) {
        this.hudGensVal.style.color = '#38bdf8';
      } else if (completedGens > 0) {
        this.hudGensVal.style.color = '#4ade80';
      } else {
        this.hudGensVal.style.color = '#f59e0b';
      }
    }
  }

  /**
   * Creates the heartbeat visual container and vignette graphic for terror radius feedback
   */
  private createHeartbeatVisual(): void {
    if (!this.scene?.add) return;

    // 1. Vinheta avermelhada em tela cheia para distância crítica (< 200px)
    this.createVignetteGraphics();

    // 2. Container do coração posicionado no canto inferior central (640, 560)
    this.heartContainer = this.scene.add.container(640, 560);
    this.heartContainer.setScrollFactor(0);
    this.heartContainer.setDepth(180);
    this.heartContainer.setAlpha(0);

    // Aura/brilho suave ao redor do coração
    this.heartGlowGraphics = this.scene.add.graphics();
    this.heartGlowGraphics.fillStyle(0xef4444, 0.22);
    this.heartGlowGraphics.fillCircle(0, -4, 34);

    // Desenho vetorial do coração estilizado (vermelho escuro com contorno vivo)
    this.heartGraphics = this.scene.add.graphics();
    this.heartGraphics.fillStyle(0x7f1d1d, 0.95);
    this.heartGraphics.lineStyle(2.5, 0xef4444, 1.0);

    // Curva paramétrica simétrica de coração vetorial
    const heartPoints: { x: number; y: number }[] = [];
    const steps = 36;
    const curveScale = 1.35;
    const yOffset = -2;
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const sinT = Math.sin(t);
      const px = (16 * Math.pow(sinT, 3)) * curveScale;
      const py = (-(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * curveScale) + yOffset;
      heartPoints.push({ x: px, y: py });
    }

    this.heartGraphics.fillPoints(heartPoints, true);
    this.heartGraphics.strokePoints(heartPoints, true);

    // Destaque de relevo / brilho interno no lobo superior esquerdo
    this.heartGraphics.fillStyle(0xfca5a5, 0.45);
    this.heartGraphics.fillCircle(-10, -16, 4.5);

    this.heartContainer.add([this.heartGlowGraphics, this.heartGraphics]);
  }

  /**
   * Cria a vinheta avermelhada periférica com camadas de gradiente suave
   */
  private createVignetteGraphics(): void {
    if (!this.scene?.add) return;

    this.vignetteGraphics = this.scene.add.graphics();
    this.vignetteGraphics.setScrollFactor(0);
    this.vignetteGraphics.setDepth(140);
    this.vignetteGraphics.setAlpha(0);

    const w = 1280;
    const h = 720;
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const inset = i * 16;
      const alpha = 0.24 - i * 0.035;
      this.vignetteGraphics.lineStyle(18, 0x880000, alpha);
      this.vignetteGraphics.strokeRect(inset + 9, inset + 9, w - (inset + 9) * 2, h - (inset + 9) * 2);
    }
  }

  /**
   * Atualiza o indicador visual de batimento cardíaco (coração pulsante) e vinheta da tela
   * sincronizado matematicamente à cadência do Raio de Terror do AudioManager.
   * @param distanceToKiller Distância euclidiana em pixels até o Assassino
   * @param isSpectator Indica se o modo espectador está ativo (Survivor desativado)
   * @param enabled Toggle geral do efeito visual (padrão: true)
   */
  public updateHeartbeatVisual(
    distanceToKiller: number,
    isSpectator: boolean,
    enabled: boolean = true
  ): void {
    if (!this.heartContainer || !this.vignetteGraphics) return;

    if (isSpectator || distanceToKiller >= TERROR_RADIUS_MAX || !enabled || Number.isNaN(distanceToKiller)) {
      this.stopHeartbeatVisual();
      return;
    }

    // Intensidade normalizada (0 no limiar de TERROR_RADIUS_MAX até 1 no contato imediato a 0px)
    const factor = Math.max(0, Math.min(1, 1 - (distanceToKiller / TERROR_RADIUS_MAX)));

    // Opacidade base varia suavemente de 0.25 no limiar de 800px até 1.0 a 0px
    this.currentBaseAlpha = 0.25 + 0.75 * factor;

    // Frequência do pulso matematicamente sincronizada ao AudioManager (~55 BPM a 800px até ~150 BPM a <=100px)
    const cadence = calculateTerrorCadence(distanceToKiller);
    this.currentIntervalMs = cadence.intervalMs;

    // Se o pulso não estiver em animação no momento, dispara o próximo ciclo
    if (!this.isBeating) {
      this.startHeartbeatPulse();
    }

    // Vinheta avermelhada tênue na tela quando a distância for crítica (< 200px)
    if (distanceToKiller < 200) {
      const critFactor = Math.max(0, Math.min(1, 1 - (distanceToKiller / 200)));
      this.vignetteGraphics.setAlpha(critFactor * 0.35);
    } else {
      this.vignetteGraphics.setAlpha(0);
    }
  }

  /**
   * Dispara o ciclo de pulso (expansão de 1.0 para 1.25 e retorno a 1.0)
   */
  private startHeartbeatPulse(): void {
    if (!this.heartContainer || this.isBeating) return;
    if (!this.scene?.tweens || !this.scene?.time) {
      this.isBeating = false;
      return;
    }

    this.isBeating = true;
    const interval = this.currentIntervalMs;
    const upDuration = Math.max(50, Math.round(interval * 0.28));
    const downDuration = Math.max(60, Math.round(interval * 0.32));
    const baseScale = this.heartZoomScale;

    this.heartContainer.setAlpha(this.currentBaseAlpha);

    this.scene.tweens.add({
      targets: this.heartContainer,
      scaleX: baseScale * 1.25,
      scaleY: baseScale * 1.25,
      alpha: Math.min(1.0, this.currentBaseAlpha + 0.15),
      duration: upDuration,
      ease: 'Sine.easeOut',
      onComplete: () => {
        if (!this.heartContainer || !this.isBeating) {
          this.isBeating = false;
          return;
        }

        this.scene.tweens.add({
          targets: this.heartContainer,
          scaleX: baseScale * 1.0,
          scaleY: baseScale * 1.0,
          alpha: this.currentBaseAlpha,
          duration: downDuration,
          ease: 'Quad.easeIn',
          onComplete: () => {
            if (!this.heartContainer || !this.isBeating) {
              this.isBeating = false;
              return;
            }

            const remainingDelay = Math.max(10, interval - upDuration - downDuration);
            this.pulseDelayTimer = this.scene.time.delayedCall(remainingDelay, () => {
              this.isBeating = false;
            });
          }
        });
      }
    });
  }

  /**
   * Interrompe imediatamente qualquer pulso ativo e oculta os elementos visuais de terror
   */
  public stopHeartbeatVisual(): void {
    this.isBeating = false;

    if (this.pulseDelayTimer) {
      this.pulseDelayTimer.remove(false);
      this.pulseDelayTimer = null;
    }

    if (this.heartContainer) {
      if (this.scene?.tweens) {
        this.scene.tweens.killTweensOf(this.heartContainer);
      }
      this.heartContainer.setScale(this.heartZoomScale);
      this.heartContainer.setAlpha(0);
    }

    if (this.vignetteGraphics) {
      this.vignetteGraphics.setAlpha(0);
    }
  }

  /**
   * Compensa o zoom da câmera para manter o tamanho e posição do coração consistentes no HUD
   * @param zoom Zoom atual da câmera
   */
  public updateZoomScale(zoom: number): void {
    const scale = calculateZoomCompensationScale(zoom);
    this.heartZoomScale = scale;
    if (this.heartContainer) {
      const dy = 200; // Offset relativo a partir do centro (360 + 200 = 560 em zoom 1.0)
      this.heartContainer.setPosition(640, 360 + dy * scale);
      if (!this.isBeating) {
        this.heartContainer.setScale(scale);
      }
    }
  }

  public get isHeartbeatBeating(): boolean {
    return this.isBeating;
  }

  public get heartbeatContainer(): Phaser.GameObjects.Container {
    return this.heartContainer;
  }

  public get screenVignette(): Phaser.GameObjects.Graphics {
    return this.vignetteGraphics;
  }

  public get heartbeatBaseAlpha(): number {
    return this.currentBaseAlpha;
  }

  /**
   * Clean up any game objects or listeners
   */
  public destroy(): void {
    this.stopHeartbeatVisual();
    if (this.alertContainer) {
      this.alertContainer.destroy();
    }
    if (this.heartContainer) {
      this.heartContainer.destroy();
    }
    if (this.vignetteGraphics) {
      this.vignetteGraphics.destroy();
    }
  }
}
