/**
 * @file KillerController.ts
 * @description Interface de abstração do controlador do Killer.
 * Permite alternar facilmente entre IA local (KillerAIController), controle por jogador humano ou rede multiplayer.
 */

import { DebugSettings } from '../config/constants';
import { Player } from '../entities/Player';
import { Generator } from '../entities/Generator';

export interface IKillerController {
  /**
   * Atualização lógica por frame do controlador.
   */
  update(delta: number, player: Player, generators: Generator[], settings: DebugSettings): void;

  /**
   * Alerta de ruído sonoro (ex: falha de Skill Check em gerador).
   */
  alertToNoise(x: number, y: number): void;

  /**
   * Retorna o identificador textual do estado ativo para a telemetria do HUD.
   */
  getState(): string;
}
