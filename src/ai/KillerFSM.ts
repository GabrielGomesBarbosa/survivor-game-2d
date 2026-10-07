/**
 * @file KillerFSM.ts
 * @description Finite State Machine managing Killer AI behavior states, transitions, inspection timers, and sound investigation.
 */

export type AIState = 'PATROL' | 'INSPECTING' | 'CHASE' | 'DESATIVADO' | 'STANDBY' | 'INVESTIGATING_SOUND';

export interface FSMTransitionCallbacks {
  onEnterPatrol?: () => void;
  onEnterChase?: () => void;
  onEnterInspecting?: () => void;
  onEnterInvestigatingSound?: () => void;
  onEnterStandby?: () => void;
  onEnterDisabled?: () => void;
}

export class KillerFSM {
  private _state: AIState = 'STANDBY';
  private callbacks: FSMTransitionCallbacks;

  // Inspection and kicking state
  public isKicking = false;
  public kickTimer = 0;

  // Sound investigation and sniffing state
  public isSniffingSound = false;
  public investigateTimer = 0;

  constructor(initialState: AIState = 'STANDBY', callbacks: FSMTransitionCallbacks = {}) {
    this._state = initialState;
    this.callbacks = callbacks;
  }

  public get state(): AIState {
    return this._state;
  }

  public set state(newState: AIState) {
    this.transitionTo(newState);
  }

  public transitionTo(newState: AIState): boolean {
    if (this._state === newState) return false;
    this._state = newState;
    this.notifyTransition(newState);
    return true;
  }

  private notifyTransition(state: AIState): void {
    switch (state) {
      case 'PATROL':
        this.callbacks.onEnterPatrol?.();
        break;
      case 'CHASE':
        this.callbacks.onEnterChase?.();
        break;
      case 'INSPECTING':
        this.callbacks.onEnterInspecting?.();
        break;
      case 'INVESTIGATING_SOUND':
        this.callbacks.onEnterInvestigatingSound?.();
        break;
      case 'STANDBY':
        this.callbacks.onEnterStandby?.();
        break;
      case 'DESATIVADO':
        this.callbacks.onEnterDisabled?.();
        break;
    }
  }

  public evaluateGlobalState(aiEnabled: boolean, genCount: number): AIState {
    if (!aiEnabled) {
      this.transitionTo('DESATIVADO');
      return this._state;
    }
    if (genCount === 0) {
      this.transitionTo('STANDBY');
      return this._state;
    }
    if (this._state === 'DESATIVADO' || this._state === 'STANDBY') {
      this.transitionTo('PATROL');
    }
    return this._state;
  }

  public startChase(): void {
    this.isKicking = false;
    this.isSniffingSound = false;
    this.investigateTimer = 0;
    this.transitionTo('CHASE');
  }

  public loseChase(): void {
    this.transitionTo('PATROL');
  }

  public startInspecting(kick: boolean, kickDurationMs = 1500): void {
    this.transitionTo('INSPECTING');
    this.isKicking = kick;
    this.kickTimer = kick ? kickDurationMs : 0;
  }

  public tickKick(delta: number): boolean {
    if (!this.isKicking) return true;
    this.kickTimer -= delta;
    if (this.kickTimer <= 0) {
      this.isKicking = false;
      this.transitionTo('PATROL');
      return true;
    }
    return false;
  }

  public completeInspection(): void {
    this.isKicking = false;
    this.transitionTo('PATROL');
  }

  public startInvestigatingSound(): void {
    this.isKicking = false;
    this.isSniffingSound = false;
    this.investigateTimer = 0;
    this.transitionTo('INVESTIGATING_SOUND');
  }

  public startSniffing(durationMs = 2000): void {
    this.isSniffingSound = true;
    this.investigateTimer = durationMs;
  }

  public tickSniffing(delta: number): { isComplete: boolean; sweepAngle: number } {
    if (!this.isSniffingSound) return { isComplete: true, sweepAngle: 0 };
    this.investigateTimer -= delta;
    const sweepAngle = Math.sin((2000 - this.investigateTimer) * 0.005) * 0.45;
    if (this.investigateTimer <= 0) {
      this.isSniffingSound = false;
      this.transitionTo('PATROL');
      return { isComplete: true, sweepAngle: 0 };
    }
    return { isComplete: false, sweepAngle };
  }

  public canInvestigateSound(): boolean {
    return this._state !== 'DESATIVADO' && this._state !== 'STANDBY' && this._state !== 'CHASE';
  }

  public canAlertNoise(): boolean {
    return this._state !== 'DESATIVADO' && this._state !== 'STANDBY';
  }

  public isMovingState(isAttacking = false): boolean {
    return (
      (this._state === 'PATROL' || this._state === 'CHASE' || this._state === 'INVESTIGATING_SOUND') &&
      !isAttacking &&
      !this.isSniffingSound
    );
  }

  public abortToPatrol(): void {
    this.isSniffingSound = false;
    this.investigateTimer = 0;
    this.isKicking = false;
    this.transitionTo('PATROL');
  }
}
