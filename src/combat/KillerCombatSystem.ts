/**
 * @file KillerCombatSystem.ts
 * @description Manages Killer M1 combat lifecycle, lunge dash dynamics, hit arcs, and recovery states.
 */

import { DebugSettings } from '../config/constants';
import { checkAttackHit, metersToPixels, wrapAngle } from '../utils/gameLogic';
import { AudioManager } from '../audio/AudioManager';
import type { Player } from '../entities/Player';

export type KillerAttackState = 'IDLE' | 'WINDUP' | 'LUNGE' | 'SUCCESS_RECOVERY' | 'MISS_RECOVERY';

export interface KillerAttackCallbacks {
  onAttackStart?: () => void;
  onAttackHit?: (survivor: Player) => void;
  onAttackMiss?: () => void;
  onRecoveryEnd?: () => void;
}

export interface ICombatPawn {
  x: number;
  y: number;
  rotation: number;
  setVelocity(vx: number, vy: number): void;
  rotateTowards(targetAngle: number, delta: number, turnSpeed: number): void;
  flashCamera?(duration?: number, red?: number, green?: number, blue?: number): void;
}

export class KillerCombatSystem {
  public isAttacking = false;
  public attackState: KillerAttackState = 'IDLE';
  public attackTimer = 0;
  public attackCallbacks: KillerAttackCallbacks = {};
  public targetSurvivor?: Player;

  private pawn: ICombatPawn;

  constructor(pawn: ICombatPawn) {
    this.pawn = pawn;
  }

  public getStateLabel(): string | null {
    if (!this.isAttacking) return null;
    if (this.attackState === 'LUNGE') return 'ATTACKING';
    if (this.attackState === 'SUCCESS_RECOVERY') return 'RECOVERY (HIT)';
    if (this.attackState === 'MISS_RECOVERY') return 'RECOVERY (MISS)';
    return null;
  }

  public performAttack(targetPlayer?: Player, settings?: DebugSettings): boolean {
    if (this.isAttacking) return false;

    this.isAttacking = true;
    this.attackState = 'LUNGE';
    this.attackTimer = 250;
    if (targetPlayer) {
      this.targetSurvivor = targetPlayer;
    }

    AudioManager.getInstance().playAttackSwingSound();
    this.attackCallbacks.onAttackStart?.();

    const headingAngle = this.pawn.rotation + Math.PI / 2;
    const dirX = Math.cos(headingAngle);
    const dirY = Math.sin(headingAngle);
    const lungeSpeed = metersToPixels((settings?.killerSpeed ?? 4.6) * 1.5);
    this.pawn.setVelocity(dirX * lungeSpeed, dirY * lungeSpeed);

    if (targetPlayer && this.checkSlashHit(targetPlayer, settings)) {
      this.onAttackHit(targetPlayer);
    }

    return true;
  }

  public updateAttack(delta: number, player?: Player, settings?: DebugSettings): void {
    if (this.attackState === 'LUNGE') {
      this.updateLungeState(delta, player, settings);
    } else if (this.attackState === 'SUCCESS_RECOVERY') {
      this.updateSuccessRecoveryState(delta, settings);
    } else if (this.attackState === 'MISS_RECOVERY') {
      this.updateMissRecoveryState(delta, settings);
    }
  }

  private updateLungeState(delta: number, player?: Player, settings?: DebugSettings): void {
    this.attackTimer -= delta;

    const headingAngle = this.pawn.rotation + Math.PI / 2;
    const dirX = Math.cos(headingAngle);
    const dirY = Math.sin(headingAngle);
    const lungeSpeed = metersToPixels((settings?.killerSpeed ?? 4.6) * 1.5);
    this.pawn.setVelocity(dirX * lungeSpeed, dirY * lungeSpeed);

    const target = player || this.targetSurvivor;
    if (target && target.isActive !== false && target.sprite?.visible) {
      const dx = target.x - this.pawn.x;
      const dy = target.y - this.pawn.y;
      const targetAngle = wrapAngle(Math.atan2(dy, dx) - Math.PI / 2);
      this.pawn.rotateTowards(targetAngle, delta, 8);

      if (this.checkSlashHit(target, settings)) {
        this.onAttackHit(target);
        return;
      }
    }

    if (this.attackTimer <= 0) {
      this.onAttackMiss();
    }
  }

  private updateSuccessRecoveryState(delta: number, settings?: DebugSettings): void {
    this.attackTimer -= delta;

    const baseSpeed = metersToPixels(settings?.killerSpeed ?? 4.6);
    const recoverySpeed = baseSpeed * 0.30;
    const headingAngle = this.pawn.rotation + Math.PI / 2;
    this.pawn.setVelocity(Math.cos(headingAngle) * recoverySpeed, Math.sin(headingAngle) * recoverySpeed);

    if (this.attackTimer <= 0) {
      this.attackState = 'IDLE';
      this.isAttacking = false;
      this.attackCallbacks.onRecoveryEnd?.();
    }
  }

  private updateMissRecoveryState(delta: number, settings?: DebugSettings): void {
    this.attackTimer -= delta;

    const baseSpeed = metersToPixels(settings?.killerSpeed ?? 4.6);
    const recoverySpeed = baseSpeed * 0.60;
    const headingAngle = this.pawn.rotation + Math.PI / 2;
    this.pawn.setVelocity(Math.cos(headingAngle) * recoverySpeed, Math.sin(headingAngle) * recoverySpeed);

    if (this.attackTimer <= 0) {
      this.attackState = 'IDLE';
      this.isAttacking = false;
      this.attackCallbacks.onRecoveryEnd?.();
    }
  }

  public onAttackHit(survivor?: Player): void {
    this.isAttacking = true;
    this.attackState = 'SUCCESS_RECOVERY';
    this.attackTimer = 2700;

    AudioManager.getInstance().playAttackHitSound();
    survivor?.takeDamage();

    if (survivor) {
      this.attackCallbacks.onAttackHit?.(survivor);
    }

    this.pawn.flashCamera?.(260, 220, 20, 20);
  }

  public onAttackMiss(): void {
    this.isAttacking = true;
    this.attackState = 'MISS_RECOVERY';
    this.attackTimer = 1500;
    this.attackCallbacks.onAttackMiss?.();
  }

  public checkSlashHit(player: Player, settings?: DebugSettings): boolean {
    if (!player || !player.sprite || player.isActive === false || !player.sprite.visible) {
      return false;
    }
    const playerRadius = (settings?.hitboxRadius ?? 65) * (settings?.playerScale ?? 0.25);
    const killerRadius = playerRadius * 1.28;
    return checkAttackHit(
      { x: this.pawn.x, y: this.pawn.y },
      this.pawn.rotation,
      { x: player.x, y: player.y },
      playerRadius,
      killerRadius,
      1.9
    );
  }

  public reset(): void {
    this.isAttacking = false;
    this.attackState = 'IDLE';
    this.attackTimer = 0;
    this.targetSurvivor = undefined;
  }
}
