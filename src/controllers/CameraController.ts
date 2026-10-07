import Phaser from 'phaser';
import { evaluateCameraPanState } from '../gameplay/gameplayEvaluation';

export interface CameraControllerOptions {
  scene: Phaser.Scene;
  camera?: Phaser.Cameras.Scene2D.Camera;
  worldWidth: number;
  worldHeight: number;
  getFreeCam: () => boolean;
  setFreeCam: (enabled: boolean) => void;
  getPlacerActive: () => boolean;
  isSpaceDown: () => boolean;
  onPanActivated?: () => void;
  onZoomChanged?: (zoom: number) => void;
  onUiZoomScale?: (zoom: number) => void;
}

export interface PointerPanResult {
  handled: boolean;
  canPlaceGenerator: boolean;
  isLeftClick: boolean;
}

export function isMiddlePointerButton(pointer: Phaser.Input.Pointer): boolean {
  return Boolean(
    pointer.middleButtonDown() ||
    (pointer.buttons & 4) !== 0 ||
    (pointer.isDown && pointer.button === 1)
  );
}

export function isLeftPointerButton(pointer: Phaser.Input.Pointer): boolean {
  return Boolean(
    pointer.leftButtonDown() ||
    (pointer.buttons & 1) !== 0 ||
    (pointer.isDown && pointer.button === 0)
  );
}

/**
 * @class CameraController
 * @description Manages camera viewport bounds, smooth follow, free cam panning, and zoom scaling.
 */
export class CameraController {
  private scene: Phaser.Scene;
  private camera: Phaser.Cameras.Scene2D.Camera;
  private options: CameraControllerOptions;
  private isPanning = false;
  private followTarget: Phaser.GameObjects.GameObject | null = null;

  constructor(options: CameraControllerOptions) {
    this.scene = options.scene;
    this.camera = options.camera || options.scene.cameras.main;
    this.options = options;
  }

  public get isPanningCamera(): boolean {
    return this.isPanning;
  }

  public get currentZoom(): number {
    return this.camera.zoom || 1.0;
  }

  public setup(initialTarget?: Phaser.GameObjects.GameObject, initialZoom = 1.0): void {
    this.camera.setBounds(0, 0, this.options.worldWidth, this.options.worldHeight);
    this.followTarget = initialTarget || null;

    if (this.options.getFreeCam()) {
      this.camera.stopFollow();
    } else if (this.followTarget) {
      this.camera.startFollow(this.followTarget as any, true, 0.08, 0.08);
    }

    this.setZoom(initialZoom);
    this.registerInputListeners();
  }

  private preventMiddleScroll = (e: MouseEvent): void => {
    if (e.button === 1) e.preventDefault();
  };

  private registerInputListeners(): void {
    this.scene.input.on('pointermove', this.handlePointerMove, this);
    this.scene.input.on('pointerup', this.handlePointerUp, this);
    this.scene.input.on('wheel', this.handleWheel, this);
    if (typeof window !== 'undefined') {
      window.addEventListener('mousedown', this.preventMiddleScroll);
      window.addEventListener('auxclick', this.preventMiddleScroll);
    }
  }

  public setFreeCam(enabled: boolean, target?: Phaser.GameObjects.GameObject): void {
    this.options.setFreeCam(enabled);
    if (enabled) {
      this.camera.stopFollow();
    } else {
      const follow = target || this.followTarget;
      if (follow) {
        this.camera.startFollow(follow as any, true, 0.1, 0.1);
      }
    }
  }

  public startFollow(target: Phaser.GameObjects.GameObject, lerpX = 0.08, lerpY = 0.08): void {
    this.followTarget = target;
    if (!this.options.getFreeCam()) {
      this.camera.startFollow(target as any, true, lerpX, lerpY);
    }
  }

  public stopFollow(): void {
    this.camera.stopFollow();
  }

  public setZoom(zoom: number): void {
    this.camera.setZoom(zoom);
    this.options.onUiZoomScale?.(zoom);
  }

  public handlePointerDown(pointer: Phaser.Input.Pointer): PointerPanResult {
    const isSpace = this.options.isSpaceDown();
    const isMiddle = isMiddlePointerButton(pointer);
    const isLeft = isLeftPointerButton(pointer);

    const panState = evaluateCameraPanState(
      isMiddle,
      isSpace,
      isLeft,
      this.options.getFreeCam(),
      this.options.getPlacerActive()
    );

    if (panState.shouldPan) {
      this.isPanning = true;
      pointer.prevPosition.x = pointer.x;
      pointer.prevPosition.y = pointer.y;
      if (!this.options.getFreeCam()) {
        this.options.setFreeCam(true);
        this.camera.stopFollow();
        this.options.onPanActivated?.();
      }
      return { handled: true, canPlaceGenerator: false, isLeftClick: isLeft };
    }

    return {
      handled: false,
      canPlaceGenerator: panState.canPlaceGenerator,
      isLeftClick: isLeft
    };
  }

  public handlePointerMove(pointer: Phaser.Input.Pointer): void {
    const isSpace = this.options.isSpaceDown();
    const isMiddle = isMiddlePointerButton(pointer);
    const isLeft = isLeftPointerButton(pointer);

    const panState = evaluateCameraPanState(
      isMiddle,
      isSpace,
      isLeft,
      this.options.getFreeCam(),
      this.options.getPlacerActive()
    );

    if (panState.shouldPan || (this.isPanning && (isMiddle || (isSpace && isLeft)))) {
      this.executeCameraPan(pointer);
    }
  }

  public handlePointerUp(): void {
    this.isPanning = false;
  }

  private handleWheel = (
    _pointer: Phaser.Input.Pointer,
    _gameObjects: unknown[],
    _deltaX: number,
    deltaY: number
  ): void => {
    if (this.options.getFreeCam() || this.options.getPlacerActive()) {
      const step = deltaY > 0 ? -0.05 : 0.05;
      const newZoom = Phaser.Math.Clamp(this.camera.zoom + step, 0.3, 1.5);
      const roundedZoom = Number(newZoom.toFixed(2));
      this.setZoom(roundedZoom);
      this.options.onZoomChanged?.(roundedZoom);
    }
  };

  private executeCameraPan(pointer: Phaser.Input.Pointer): void {
    const zoom = this.camera.zoom || 1.0;
    const dx = (pointer.x - pointer.prevPosition.x) / zoom;
    const dy = (pointer.y - pointer.prevPosition.y) / zoom;
    this.camera.scrollX -= dx;
    this.camera.scrollY -= dy;
  }

  public destroy(): void {
    this.scene.input.off('pointermove', this.handlePointerMove, this);
    this.scene.input.off('pointerup', this.handlePointerUp, this);
    this.scene.input.off('wheel', this.handleWheel, this);
    if (typeof window !== 'undefined') {
      window.removeEventListener('mousedown', this.preventMiddleScroll);
      window.removeEventListener('auxclick', this.preventMiddleScroll);
    }
    this.camera.stopFollow();
  }
}
