import Phaser from 'phaser';
import { formatGeneratorsHudText } from '../utils/gameLogic';

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
  }

  /**
   * Cache references to DOM telemetry elements in the header
   */
  private initDOMCache(): void {
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
      this.hudKillerDist.textContent = killerDist || '--';
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
   * Clean up any game objects or listeners
   */
  public destroy(): void {
    if (this.alertContainer) {
      this.alertContainer.destroy();
    }
  }
}
