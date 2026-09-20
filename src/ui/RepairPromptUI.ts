import Phaser from 'phaser';

/**
 * @class RepairPromptUI
 * @description Fixed screen HUD element showing repair progress and key prompt [E]
 * when the player is inside the interaction zone of a generator.
 */
export class RepairPromptUI {
  private container: Phaser.GameObjects.Container;
  private promptText: Phaser.GameObjects.Text;
  private progressBarFill: Phaser.GameObjects.Rectangle;
  private percentText: Phaser.GameObjects.Text;

  /**
   * @param scene Phaser scene to host the repair prompt container
   */
  constructor(scene: Phaser.Scene) {
    this.container = scene.add.container(640, 640);
    this.container.setScrollFactor(0);
    this.container.setDepth(150);
    this.container.setVisible(false);

    const bg = scene.add.rectangle(0, 0, 360, 52, 0x090d16, 0.88);
    bg.setStrokeStyle(1.5, 0x3b82f6);

    this.promptText = scene.add.text(0, -10, '[E] Reparar Gerador', {
      fontSize: '13px',
      color: '#ffffff',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    const barBg = scene.add.rectangle(0, 14, 260, 8, 0x1e293b).setStrokeStyle(1, 0x334155);

    this.progressBarFill = scene.add.rectangle(-130, 14, 0, 6, 0x38bdf8).setOrigin(0, 0.5);

    this.percentText = scene.add.text(148, 14, '0%', {
      fontSize: '11px',
      color: '#94a3b8',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    this.container.add([
      bg,
      this.promptText,
      barBg,
      this.progressBarFill,
      this.percentText
    ]);
  }

  /**
   * Updates and displays the prompt UI
   * @param title Text displayed on prompt
   * @param progress Progress percentage (0 - 100)
   * @param isRepairing Whether repair is currently active
   * @param isStaggered Whether the generator is currently locked due to recent short-circuit/explosion
   */
  public show(title: string, progress: number, isRepairing: boolean, isStaggered: boolean = false): void {
    this.container.setVisible(true);
    this.promptText.setText(title);

    const pct = Math.floor(progress);
    this.percentText.setText(`${pct}%`);

    if (isStaggered) {
      this.progressBarFill.setFillStyle(0xef4444);
    } else if (isRepairing) {
      this.progressBarFill.setFillStyle(0x10b981);
    } else {
      this.progressBarFill.setFillStyle(0x38bdf8);
    }

    this.progressBarFill.width = Math.max(0, Math.min(260, (progress / 100) * 260));
  }

  /**
   * Hides the repair prompt
   */
  public hide(): void {
    this.container.setVisible(false);
  }

  /**
   * Destroys the prompt container
   */
  public destroy(): void {
    this.container.destroy();
  }
}
