/**
 * @file telemetryHUD.test.ts
 * @description Suíte de testes unitários do TelemetryHUD:
 * - Renderização vetorial do Coração de Terror e Vinheta
 * - Animação de pulso e cadência sincronizada ao AudioManager
 * - Modulação de escala (1.0 -> 1.25 -> 1.0) e opacidade (0.3 a 1.0)
 * - Vinheta avermelhada tênue ativada em distância crítica (< 200px)
 * - Desativação imediata em Modo Espectador ou toggle desligado
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelemetryHUD } from '../src/ui/TelemetryHUD';
import { calculateTerrorCadence } from '../src/audio/AudioManager';

describe('TelemetryHUD - Terror Radius Heartbeat Visual & Vignette', () => {
  let mockScene: any;
  let heartContainerMock: any;
  let vignetteMock: any;
  let alertContainerMock: any;
  let addedTweens: any[];
  let delayedCalls: any[];

  beforeEach(() => {
    addedTweens = [];
    delayedCalls = [];

    heartContainerMock = {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      alpha: 0,
      depth: 0,
      scrollFactorX: 0,
      scrollFactorY: 0,
      children: [] as any[],
      setScrollFactor: vi.fn(function(this: any) { return this; }),
      setDepth: vi.fn(function(this: any, d: number) { this.depth = d; return this; }),
      setAlpha: vi.fn(function(this: any, a: number) { this.alpha = a; return this; }),
      setScale: vi.fn(function(this: any, s: number) { this.scaleX = s; this.scaleY = s; return this; }),
      setPosition: vi.fn(function(this: any, x: number, y: number) { this.x = x; this.y = y; return this; }),
      add: vi.fn(function(this: any, items: any[]) { this.children.push(...items); return this; }),
      destroy: vi.fn()
    };

    vignetteMock = {
      alpha: 0,
      depth: 0,
      setScrollFactor: vi.fn(function(this: any) { return this; }),
      setDepth: vi.fn(function(this: any, d: number) { this.depth = d; return this; }),
      setAlpha: vi.fn(function(this: any, a: number) { this.alpha = a; return this; }),
      lineStyle: vi.fn(function(this: any) { return this; }),
      strokeRect: vi.fn(function(this: any) { return this; }),
      destroy: vi.fn()
    };

    alertContainerMock = {
      setScrollFactor: vi.fn().mockReturnThis(),
      setDepth: vi.fn().mockReturnThis(),
      setAlpha: vi.fn().mockReturnThis(),
      add: vi.fn().mockReturnThis(),
      destroy: vi.fn()
    };

    const genericGraphics = {
      fillStyle: vi.fn().mockReturnThis(),
      fillCircle: vi.fn().mockReturnThis(),
      lineStyle: vi.fn().mockReturnThis(),
      beginPath: vi.fn().mockReturnThis(),
      moveTo: vi.fn().mockReturnThis(),
      bezierCurveTo: vi.fn().mockReturnThis(),
      cubicBezierTo: vi.fn().mockReturnThis(),
      closePath: vi.fn().mockReturnThis(),
      fillPath: vi.fn().mockReturnThis(),
      strokePath: vi.fn().mockReturnThis(),
      fillPoints: vi.fn().mockReturnThis(),
      strokePoints: vi.fn().mockReturnThis(),
      setScrollFactor: vi.fn().mockReturnThis(),
      setDepth: vi.fn().mockReturnThis(),
      setAlpha: vi.fn().mockReturnThis(),
      strokeRect: vi.fn().mockReturnThis(),
      destroy: vi.fn()
    };

    let containerCount = 0;
    let graphicsCount = 0;

    mockScene = {
      add: {
        container: vi.fn((x: number, y: number) => {
          containerCount++;
          if (containerCount === 1) return alertContainerMock;
          heartContainerMock.x = x;
          heartContainerMock.y = y;
          return heartContainerMock;
        }),
        graphics: vi.fn(() => {
          graphicsCount++;
          if (graphicsCount === 1) return vignetteMock;
          return { ...genericGraphics };
        }),
        text: vi.fn(() => ({
          setText: vi.fn().mockReturnThis(),
          setOrigin: vi.fn().mockReturnThis()
        })),
        rectangle: vi.fn(() => ({
          setStrokeStyle: vi.fn().mockReturnThis(),
          setFillStyle: vi.fn().mockReturnThis()
        }))
      },
      tweens: {
        add: vi.fn((config: any) => {
          addedTweens.push(config);
          return config;
        }),
        killTweensOf: vi.fn((target: any) => {
          addedTweens = addedTweens.filter((t) => t.targets !== target);
        })
      },
      time: {
        delayedCall: vi.fn((delay: number, cb: Function) => {
          const callObj = { delay, cb, remove: vi.fn() };
          delayedCalls.push(callObj);
          return callObj;
        })
      }
    };
  });

  describe('1. Inicialização e Ancoragem Fixa no HUD', () => {
    it('creates heartContainer and vignette with setScrollFactor(0) and correct depths', () => {
      const hud = new TelemetryHUD(mockScene);

      expect(hud.heartbeatContainer).toBeDefined();
      expect(hud.screenVignette).toBeDefined();
      expect(hud.heartbeatContainer.setScrollFactor).toHaveBeenCalledWith(0);
      expect(hud.screenVignette.setScrollFactor).toHaveBeenCalledWith(0);
      expect(hud.heartbeatContainer.depth).toBe(180);
      expect(hud.screenVignette.depth).toBe(140);
      expect(hud.heartbeatContainer.alpha).toBe(0);
      expect(hud.screenVignette.alpha).toBe(0);
    });

    it('positions heart container horizontally centered at (640, 560)', () => {
      const hud = new TelemetryHUD(mockScene);
      expect(hud.heartbeatContainer.x).toBe(640);
      expect(hud.heartbeatContainer.y).toBe(560);
    });
  });

  describe('2. Visibilidade e Limiar de 500px', () => {
    it('remains hidden (alpha = 0) and not beating when distance > 500px', () => {
      const hud = new TelemetryHUD(mockScene);
      hud.updateHeartbeatVisual(600, false, true);

      expect(hud.heartbeatContainer.alpha).toBe(0);
      expect(hud.isHeartbeatBeating).toBe(false);
      expect(hud.screenVignette.alpha).toBe(0);
    });

    it('remains hidden at exact boundary distance = 500.1px', () => {
      const hud = new TelemetryHUD(mockScene);
      hud.updateHeartbeatVisual(500.1, false, true);

      expect(hud.heartbeatContainer.alpha).toBe(0);
      expect(hud.isHeartbeatBeating).toBe(false);
    });

    it('becomes visible when distance <= 500px', () => {
      const hud = new TelemetryHUD(mockScene);
      hud.updateHeartbeatVisual(450, false, true);

      expect(hud.heartbeatContainer.alpha).toBeGreaterThan(0);
      expect(hud.isHeartbeatBeating).toBe(true);
      expect(addedTweens.length).toBeGreaterThan(0);
    });
  });

  describe('3. Modulação de Opacidade e Escala', () => {
    it('calculates base alpha: 0.3 at 500px up to 1.0 at 0px', () => {
      const hud = new TelemetryHUD(mockScene);

      hud.updateHeartbeatVisual(500, false, true);
      expect(hud.heartbeatBaseAlpha).toBeCloseTo(0.3, 2);

      hud.updateHeartbeatVisual(250, false, true);
      // factor = 1 - (250/500) = 0.5 -> 0.3 + 0.7 * 0.5 = 0.65
      expect(hud.heartbeatBaseAlpha).toBeCloseTo(0.65, 2);

      hud.updateHeartbeatVisual(0, false, true);
      expect(hud.heartbeatBaseAlpha).toBeCloseTo(1.0, 2);
    });

    it('creates a tween scaling from 1.0 up to 1.25 on pulse trigger', () => {
      const hud = new TelemetryHUD(mockScene);
      hud.updateHeartbeatVisual(300, false, true);

      expect(addedTweens.length).toBe(1);
      const tween = addedTweens[0];
      expect(tween.targets).toBe(heartContainerMock);
      expect(tween.scaleX).toBe(1.25);
      expect(tween.scaleY).toBe(1.25);
      expect(tween.ease).toBe('Sine.easeOut');
    });

    it('returns scale to 1.0 on tween completion', () => {
      const hud = new TelemetryHUD(mockScene);
      hud.updateHeartbeatVisual(300, false, true);

      const upTween = addedTweens[0];
      // Dispara o callback onComplete da subida
      upTween.onComplete();

      expect(addedTweens.length).toBe(2);
      const downTween = addedTweens[1];
      expect(downTween.scaleX).toBe(1.0);
      expect(downTween.scaleY).toBe(1.0);
      expect(downTween.ease).toBe('Quad.easeIn');
    });
  });

  describe('4. Sincronização Matemática de Cadência com AudioManager', () => {
    it('matches terror cadence interval: ~1000ms at 500px, ~428.6ms at 200px', () => {
      const hud = new TelemetryHUD(mockScene);

      // A 450px
      hud.updateHeartbeatVisual(450, false, true);
      const cadence450 = calculateTerrorCadence(450);
      const tween450 = addedTweens[0];
      // upDuration é round(intervalMs * 0.28)
      expect(tween450.duration).toBe(Math.round(cadence450.intervalMs * 0.28));

      // Reset para testar a 200px
      hud.stopHeartbeatVisual();
      addedTweens = [];

      hud.updateHeartbeatVisual(200, false, true);
      const cadence200 = calculateTerrorCadence(200);
      const tween200 = addedTweens[0];
      expect(tween200.duration).toBe(Math.round(cadence200.intervalMs * 0.28));
    });
  });

  describe('5. Vinheta Avermelhada Crítica (< 200px)', () => {
    it('keeps screen vignette hidden when distance >= 200px', () => {
      const hud = new TelemetryHUD(mockScene);
      hud.updateHeartbeatVisual(250, false, true);

      expect(hud.screenVignette.alpha).toBe(0);
    });

    it('activates screen vignette proportionally when distance < 200px', () => {
      const hud = new TelemetryHUD(mockScene);

      // A 100px: critFactor = 1 - (100 / 200) = 0.5 -> alpha = 0.5 * 0.35 = 0.175
      hud.updateHeartbeatVisual(100, false, true);
      expect(hud.screenVignette.alpha).toBeCloseTo(0.175, 3);

      // A 0px: critFactor = 1.0 -> alpha = 0.35
      hud.updateHeartbeatVisual(0, false, true);
      expect(hud.screenVignette.alpha).toBeCloseTo(0.35, 3);
    });
  });

  describe('6. Modo Espectador e Toggle do lil-gui', () => {
    it('silences and hides heart immediately when isSpectator is true', () => {
      const hud = new TelemetryHUD(mockScene);
      hud.updateHeartbeatVisual(150, false, true);

      expect(hud.heartbeatContainer.alpha).toBeGreaterThan(0);
      expect(hud.isHeartbeatBeating).toBe(true);

      // Entra no modo espectador
      hud.updateHeartbeatVisual(150, true, true);

      expect(hud.heartbeatContainer.alpha).toBe(0);
      expect(hud.screenVignette.alpha).toBe(0);
      expect(hud.isHeartbeatBeating).toBe(false);
      expect(mockScene.tweens.killTweensOf).toHaveBeenCalledWith(heartContainerMock);
    });

    it('silences and hides heart immediately when enabled is false (toggle desligado)', () => {
      const hud = new TelemetryHUD(mockScene);
      hud.updateHeartbeatVisual(150, false, true);

      expect(hud.isHeartbeatBeating).toBe(true);

      // Desliga o toggle
      hud.updateHeartbeatVisual(150, false, false);

      expect(hud.heartbeatContainer.alpha).toBe(0);
      expect(hud.screenVignette.alpha).toBe(0);
      expect(hud.isHeartbeatBeating).toBe(false);
    });
  });

  describe('7. Compensação de Zoom e Destruição', () => {
    it('adjusts position and scale on updateZoomScale', () => {
      const hud = new TelemetryHUD(mockScene);
      hud.updateZoomScale(0.5);

      // Em zoom 0.5, scale compensatório é 2.0
      expect(heartContainerMock.y).toBe(360 + 200 * 2.0); // 760
    });

    it('cleans up all containers and cancels tweens on destroy', () => {
      const hud = new TelemetryHUD(mockScene);
      hud.updateHeartbeatVisual(100, false, true);
      hud.destroy();

      expect(mockScene.tweens.killTweensOf).toHaveBeenCalledWith(heartContainerMock);
      expect(heartContainerMock.destroy).toHaveBeenCalled();
      expect(vignetteMock.destroy).toHaveBeenCalled();
      expect(alertContainerMock.destroy).toHaveBeenCalled();
    });
  });
});
