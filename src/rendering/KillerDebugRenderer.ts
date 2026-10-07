/**
 * @file KillerDebugRenderer.ts
 * @description Renders visual debug graphics for the Killer (terror radius, detection circles, line of sight, and A* route waypoints).
 */

import Phaser from 'phaser';
import { DebugSettings, TERROR_RADIUS_METERS } from '../config/constants';
import { metersToPixels } from '../utils/mathUtils';

export class KillerDebugRenderer {
  private visionGraphic: Phaser.GameObjects.Graphics;
  private aStarGraphic: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.visionGraphic = scene.add.graphics();
    this.visionGraphic.setDepth(5);

    this.aStarGraphic = scene.add.graphics();
    this.aStarGraphic.setDepth(6);
  }

  public renderVision(
    killerPos: { x: number; y: number },
    settings: DebugSettings,
    targetPos: { x: number; y: number },
    isChase: boolean
  ): void {
    if (!this.visionGraphic) return;
    this.visionGraphic.clear();

    if (!settings.showKillerVision || !settings.killerAiEnabled) return;

    const killerX = killerPos.x;
    const killerY = killerPos.y;
    const detectionRadius = metersToPixels(settings.detectionRadius);
    const loseRadius = detectionRadius * 1.5;

    // Terror radius of 32m (crimson translucent fill + stroke)
    const terrorRadiusPx = metersToPixels(TERROR_RADIUS_METERS);
    this.visionGraphic.fillStyle(0xdc2626, 0.08);
    this.visionGraphic.fillCircle(killerX, killerY, terrorRadiusPx);
    this.visionGraphic.lineStyle(2.5, 0xdc2626, 0.6);
    this.visionGraphic.strokeCircle(killerX, killerY, terrorRadiusPx);

    // Chase lose radius (gold/yellow stroke)
    this.visionGraphic.lineStyle(2.5, 0xf0c674, 0.4);
    this.visionGraphic.strokeCircle(killerX, killerY, loseRadius);

    if (isChase) {
      this.visionGraphic.fillStyle(0xff2222, 0.12);
      this.visionGraphic.fillCircle(killerX, killerY, detectionRadius);
      this.visionGraphic.lineStyle(2.5, 0xff2222, 0.85);
      this.visionGraphic.strokeCircle(killerX, killerY, detectionRadius);

      this.visionGraphic.lineStyle(2.5, 0xff2222, 0.7);
      this.visionGraphic.lineBetween(killerX, killerY, targetPos.x, targetPos.y);
    } else {
      this.visionGraphic.fillStyle(0xff8833, 0.10);
      this.visionGraphic.fillCircle(killerX, killerY, detectionRadius);
      this.visionGraphic.lineStyle(2.5, 0xff8833, 0.65);
      this.visionGraphic.strokeCircle(killerX, killerY, detectionRadius);

      this.visionGraphic.lineStyle(2.5, 0x88bbff, 0.45);
      this.visionGraphic.lineBetween(killerX, killerY, targetPos.x, targetPos.y);
    }
  }

  public renderRoute(
    killerPos: { x: number; y: number },
    settings: DebugSettings,
    path: Array<{ x: number; y: number }>,
    pathIndex: number,
    isChase: boolean,
    hasDirectLOS: boolean,
    targetPos: { x: number; y: number }
  ): void {
    if (!this.aStarGraphic) return;
    this.aStarGraphic.clear();

    if (!settings.showAStarPath || !settings.killerAiEnabled) return;

    const killerX = killerPos.x;
    const killerY = killerPos.y;

    if (isChase) {
      this.renderChaseRoute(killerX, killerY, path, pathIndex, hasDirectLOS, targetPos);
    } else if (path && path.length > 0) {
      this.renderPatrolRoute(killerX, killerY, path, pathIndex, targetPos);
    } else {
      this.renderDirectLine(killerX, killerY, targetPos);
    }
  }

  private renderChaseRoute(
    kx: number,
    ky: number,
    path: Array<{ x: number; y: number }>,
    pathIndex: number,
    hasDirectLOS: boolean,
    targetPos: { x: number; y: number }
  ): void {
    if (hasDirectLOS) {
      this.aStarGraphic.lineStyle(3.5, 0xff2222, 0.95);
      this.aStarGraphic.lineBetween(kx, ky, targetPos.x, targetPos.y);
      this.aStarGraphic.fillStyle(0xff2222, 0.7);
      this.aStarGraphic.fillCircle(targetPos.x, targetPos.y, 9);
      return;
    }

    if (!path || path.length === 0) return;

    this.aStarGraphic.lineStyle(3.5, 0xff2222, 0.95);
    const currentNode = path[pathIndex];
    if (currentNode) {
      this.aStarGraphic.lineBetween(kx, ky, currentNode.x, currentNode.y);
    }

    for (let i = pathIndex; i < path.length - 1; i++) {
      this.aStarGraphic.lineBetween(path[i].x, path[i].y, path[i + 1].x, path[i + 1].y);
    }

    const lastNode = path[path.length - 1];
    if (lastNode && (lastNode.x !== targetPos.x || lastNode.y !== targetPos.y)) {
      this.aStarGraphic.lineBetween(lastNode.x, lastNode.y, targetPos.x, targetPos.y);
    }

    for (let i = 0; i < path.length; i++) {
      const node = path[i];
      if (i === pathIndex) {
        this.aStarGraphic.fillStyle(0xffffff, 1);
        this.aStarGraphic.fillCircle(node.x, node.y, 6);
        this.aStarGraphic.lineStyle(2.5, 0xff2222, 1);
        this.aStarGraphic.strokeCircle(node.x, node.y, 10);
      } else if (i > pathIndex) {
        this.aStarGraphic.fillStyle(0xff3333, 0.85);
        this.aStarGraphic.fillCircle(node.x, node.y, 5);
        this.aStarGraphic.lineStyle(1.5, 0xff6666, 0.6);
        this.aStarGraphic.strokeCircle(node.x, node.y, 7);
      }
    }
  }

  private renderPatrolRoute(
    kx: number,
    ky: number,
    path: Array<{ x: number; y: number }>,
    pathIndex: number,
    targetPos: { x: number; y: number }
  ): void {
    this.aStarGraphic.lineStyle(3, 0xff3333, 0.9);
    const currentNode = path[pathIndex];
    if (currentNode) {
      this.aStarGraphic.lineBetween(kx, ky, currentNode.x, currentNode.y);
    }
    for (let i = pathIndex; i < path.length - 1; i++) {
      this.aStarGraphic.lineBetween(path[i].x, path[i].y, path[i + 1].x, path[i + 1].y);
    }
    const lastNode = path[path.length - 1];
    if (lastNode && (lastNode.x !== targetPos.x || lastNode.y !== targetPos.y)) {
      this.aStarGraphic.lineBetween(lastNode.x, lastNode.y, targetPos.x, targetPos.y);
    }

    for (let i = 0; i < path.length; i++) {
      const node = path[i];
      if (node.x !== targetPos.x || node.y !== targetPos.y) {
        this.aStarGraphic.fillStyle(0xffffff, 0.85);
        this.aStarGraphic.fillCircle(node.x, node.y, 4);
      }
    }

    this.aStarGraphic.fillStyle(0xff2222, 0.9);
    this.aStarGraphic.fillCircle(targetPos.x, targetPos.y, 7);
    this.aStarGraphic.lineStyle(2, 0xffffff, 0.95);
    this.aStarGraphic.strokeCircle(targetPos.x, targetPos.y, 11);
  }

  private renderDirectLine(kx: number, ky: number, targetPos: { x: number; y: number }): void {
    this.aStarGraphic.lineStyle(2.5, 0xff3333, 0.8);
    this.aStarGraphic.lineBetween(kx, ky, targetPos.x, targetPos.y);
    this.aStarGraphic.fillStyle(0xff2222, 0.85);
    this.aStarGraphic.fillCircle(targetPos.x, targetPos.y, 7);
    this.aStarGraphic.lineStyle(2, 0xffffff, 0.95);
    this.aStarGraphic.strokeCircle(targetPos.x, targetPos.y, 11);
  }

  public clear(): void {
    this.visionGraphic?.clear();
    this.aStarGraphic?.clear();
  }

  public destroy(): void {
    this.visionGraphic?.destroy();
    this.aStarGraphic?.destroy();
  }
}
