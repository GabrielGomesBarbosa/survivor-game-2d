/**
 * @file patrolUtils.ts
 * @description Patrol state manager and arrival evaluation.
 */

import { PatrolTarget, MAJOR_FACILITY_ROOMS } from './patrolDestinations';
export * from './patrolDestinations';

/**
 * Gerenciador de ciclo de ronda (patrol cycle) entre geradores e inspeção de ambientes.
 */
export class GeneratorPatrolManager {
  public currentIndex = 0;
  public inspectTimer = 0;
  public isInspecting = false;
  public currentDestination: PatrolTarget | null = null;
  public totalInspectDuration = 2500; // 2.5s (entre 2s e 3s)
  public lastVisitedGenerator: string | null = null;
  public visitHistory: Map<string, number> = new Map();
  public visitCounter = 0;

  /**
   * Filtra estritamente geradores incompletos e com coordenadas válidas.
   * Exclui geradores já completados (100% ou isCompleted == true).
   */
  public filterActiveGenerators(
    generators: Array<{ name: string; x: number; y: number; progress?: number; isCompleted?: boolean } | null | undefined>
  ): PatrolTarget[] {
    return (generators || [])
      .filter((g): g is { name: string; x: number; y: number; progress?: number; isCompleted?: boolean } => {
        if (!g) return false;
        if (g.isCompleted) return false;
        if (typeof g.progress === 'number' && g.progress >= 100) return false;
        return (
          typeof g.x === 'number' &&
          typeof g.y === 'number' &&
          !isNaN(g.x) &&
          !isNaN(g.y) &&
          isFinite(g.x) &&
          isFinite(g.y)
        );
      })
      .map((g) => ({ name: g.name, x: g.x, y: g.y, type: 'generator' }));
  }

  /**
   * Filtra geradores ativos preservando o progresso para ponderação dinâmica.
   */
  public filterActiveGeneratorsWithProgress(
    generators: Array<{ name: string; x: number; y: number; progress?: number; isCompleted?: boolean } | null | undefined>
  ): Array<{ name: string; x: number; y: number; progress: number }> {
    return (generators || [])
      .filter((g): g is { name: string; x: number; y: number; progress?: number; isCompleted?: boolean } => {
        if (!g) return false;
        if (g.isCompleted) return false;
        if (typeof g.progress === 'number' && g.progress >= 100) return false;
        return (
          typeof g.x === 'number' &&
          typeof g.y === 'number' &&
          !isNaN(g.x) &&
          !isNaN(g.y) &&
          isFinite(g.x) &&
          isFinite(g.y)
        );
      })
      .map((g) => ({
        name: g.name,
        x: g.x,
        y: g.y,
        progress: typeof g.progress === 'number' ? g.progress : 0
      }));
  }

  /**
   * Obtém o próximo destino de patrulha na sequência dinâmica/não-determinística:
   * - Regra Mandatória: NUNCA repete o mesmo gerador em que acabou de inspecionar (se houver mais de 1).
   * - Prioriza geradores sob reparo (progresso > 0%) e visitados há mais tempo (staleness).
   * - Se todos os geradores foram concluídos, ronda pelas salas principais sem repetição consecutiva.
   */
  public getNextDestination(
    generators: Array<{ name: string; x: number; y: number; progress?: number; isCompleted?: boolean } | null | undefined>,
    majorRooms: PatrolTarget[] = MAJOR_FACILITY_ROOMS,
    rng: () => number = Math.random
  ): PatrolTarget | null {
    const rawGens = this.filterActiveGeneratorsWithProgress(generators);
    this.isInspecting = false;
    this.inspectTimer = 0;

    if (rawGens.length > 0) {
      // Regra Mandatória: Se houver mais de 1 gerador incompleto, NUNCA sortear o mesmo que acabou de inspecionar
      let candidates = rawGens;
      if (rawGens.length > 1 && this.lastVisitedGenerator) {
        const remaining = rawGens.filter((g) => g.name !== this.lastVisitedGenerator);
        if (remaining.length > 0) {
          candidates = remaining;
        }
      }

      // Priorização ponderada:
      // - Progresso > 0%: geradores com reparo em andamento recebem prioridade alta
      // - Staleness: geradores visitados há mais tempo (ou nunca visitados) recebem prioridade
      const weights = candidates.map((g) => {
        let w = 1.0;
        if (g.progress > 0) {
          w += 2.0 + (g.progress / 100) * 3.0; // bônus de 2.0 a 5.0
        }
        const lastTick = this.visitHistory.get(g.name) ?? 0;
        const staleness = Math.max(1, this.visitCounter - lastTick + 1);
        w += staleness * 1.5;
        return w;
      });

      const totalWeight = weights.reduce((acc, weight) => acc + weight, 0);
      let randVal = rng() * totalWeight;
      let chosen = candidates[0];

      for (let i = 0; i < candidates.length; i++) {
        randVal -= weights[i];
        if (randVal <= 0) {
          chosen = candidates[i];
          break;
        }
      }

      this.visitCounter++;
      this.lastVisitedGenerator = chosen.name;
      this.visitHistory.set(chosen.name, this.visitCounter);

      const target: PatrolTarget = {
        name: chosen.name,
        x: chosen.x,
        y: chosen.y,
        type: 'generator'
      };
      this.currentDestination = target;
      return target;
    }

    // Se todos os geradores foram concluídos, ronda pelas salas principais
    const validRooms = (majorRooms || []).filter((r) => r && typeof r.x === 'number' && typeof r.y === 'number');
    if (validRooms.length > 0) {
      let roomCandidates = validRooms;
      if (validRooms.length > 1 && this.lastVisitedGenerator) {
        const filtered = validRooms.filter((r) => r.name !== this.lastVisitedGenerator);
        if (filtered.length > 0) roomCandidates = filtered;
      }
      const idx = Math.floor(rng() * roomCandidates.length);
      const target = roomCandidates[idx];
      this.lastVisitedGenerator = target.name;
      this.currentDestination = target;
      return target;
    }

    this.currentDestination = null;
    return null;
  }

  /**
   * Verifica se o Killer alcançou a distância segura do alvo (evita empurrar a máquina sólida).
   * @param distance Distância euclidiana atual em pixels.
   * @param safeRadius Raio de segurança em pixels (padrão: 110px).
   */
  public hasReachedSafeDistance(distance: number, safeRadius: number = 110): boolean {
    return distance <= safeRadius;
  }

  /**
   * Inicia o estado de inspeção no gerador.
   * @param durationMs Duração da pausa de inspeção (padrão: 2500ms).
   */
  public startInspection(durationMs: number = 2500): void {
    this.isInspecting = true;
    this.inspectTimer = durationMs;
    this.totalInspectDuration = durationMs;
  }

  /**
   * Atualiza o cronômetro de inspeção e retorna o offset angular para olhar ao redor.
   * @param delta Delta time em milissegundos.
   * @returns isComplete: boolean indicando se a inspeção terminou, lookOffset: desvio angular em radianos.
   */
  public tickInspection(delta: number): { isComplete: boolean; lookOffset: number } {
    if (!this.isInspecting) {
      return { isComplete: false, lookOffset: 0 };
    }

    this.inspectTimer -= delta;

    // Simula olhar em volta varrendo angularmente (+/- 1.1 radianos)
    const elapsed = this.totalInspectDuration - this.inspectTimer;
    const lookOffset = Math.sin(elapsed * 0.0032) * 1.1;

    if (this.inspectTimer <= 0) {
      this.isInspecting = false;
      this.inspectTimer = 0;
      return { isComplete: true, lookOffset: 0 };
    }

    return { isComplete: false, lookOffset };
  }

  /**
   * Interrompe imediatamente a inspeção (ex: perseguição iniciada ou alerta de ruído).
   */
  public interruptInspection(): void {
    this.isInspecting = false;
    this.inspectTimer = 0;
  }

  /**
   * Registra um gerador como destino prioritário imediato decorrente de ruído/explosão,
   * atualizando currentDestination e marcando lastVisitedGenerator para evitar loops na próxima rodada.
   */
  public registerAlertDestination(gen: { name: string; x: number; y: number }): PatrolTarget {
    this.interruptInspection();
    const target: PatrolTarget = {
      name: gen.name,
      x: gen.x,
      y: gen.y,
      type: 'generator'
    };
    this.currentDestination = target;
    this.lastVisitedGenerator = gen.name;
    return target;
  }
}

/**
 * Avalia se o Killer alcançou a tolerância de chegada ao alvo de patrulha:
 * - Para geradores:
 *   - Chegada confirmada se 'distToTarget <= 32' (alcançou o ponto livre de stand-off); OU
 *   - se estiver dentro do raio de interação ('distToGen <= 130') e adjacente ao stand-off ('distToTarget <= 75').
 * - Para salas principais:
 *   - 'distToTarget <= 40' (centro do cômodo).
 */
export function evaluatePatrolArrival(
  distToTarget: number,
  isTargetingGenerator: boolean,
  distToGen?: number
): boolean {
  if (isTargetingGenerator) {
    return distToTarget <= 32 || ((distToGen !== undefined && distToGen <= 130) && distToTarget <= 75);
  }
  return distToTarget <= 40;
}
