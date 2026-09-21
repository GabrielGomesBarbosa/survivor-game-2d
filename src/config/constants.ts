/**
 * @file constants.ts
 * @description Constantes de configuração global, limites de mundo, malha lógica e padrões do painel de debug.
 */

export const WORLD_WIDTH = 5120;
export const WORLD_HEIGHT = 3840;
export const TILE_SIZE = 64;
export const COLS = 80;
export const ROWS = 60;

export const STORAGE_KEY = 'horror_topdown_debug_settings';
export const GENERATOR_CANDIDATES_STORAGE_KEY = 'horror2d_generator_candidates';

export const GENERATOR_DEFS = [
  { id: 'gen-1', name: 'Gerador A', roomName: 'Ala Nordeste (Laboratório)', x: 4096, y: 768 },
  { id: 'gen-2', name: 'Gerador B', roomName: 'Ala Sudoeste (Enfermaria)', x: 1024, y: 3072 },
  { id: 'gen-3', name: 'Gerador C', roomName: 'Ala Sudeste (Sala de Máquinas)', x: 4096, y: 3072 }
];

/**
 * Interface com todos os parâmetros ajustáveis via painel de debug (lil-gui) e persistidos em localStorage.
 */
export interface DebugSettings {
  walkSpeed: number;
  runSpeed: number;
  turnSpeed: number;
  instantTurn: boolean;
  playerScale: number;
  hitboxRadius: number;
  showPhysicsDebug: boolean;
  walkAnimFrameRate: number;
  runAnimFrameRate: number;
  cameraZoom: number;
  freeCam: boolean;
  // Killer Settings
  killerSpeed: number;
  detectionRadius: number;
  inspectionTime: number; // Tempo de pausa de inspeção no gerador em segundos (padrão: 2.5s)
  inspectionDistance: number; // Distância segura de chegada/inspeção ao gerador em pixels (padrão: 110px)
  showKillerVision: boolean;
  showAStarPath: boolean;
  killerAiEnabled: boolean;
  // Generator & Skill Check Settings
  generatorRepairTime: number; // Tempo total para 0 a 100% em segundos (padrão: 12s)
  skillCheckFrequency: number; // Frequência média em segundos entre QTEs (padrão: 3s)
  // Spawn Editor Settings
  editorMode: boolean;
  placerSnapToGrid: boolean;
  // Survivor & Match Target Settings
  survivorActive: boolean;
  generatorTotalTarget: number;
  generatorRequiredTarget: number;
}

/**
 * Valores padrão calibrados de fábrica para a Sandbox.
 */
export const DEFAULT_DEBUG_SETTINGS: DebugSettings = {
  walkSpeed: 140,
  runSpeed: 240,
  turnSpeed: 18,
  instantTurn: false,
  playerScale: 0.25,
  hitboxRadius: 265, // Calibrado com frame 704x768
  showPhysicsDebug: true,
  walkAnimFrameRate: 8,
  runAnimFrameRate: 12,
  cameraZoom: 1.0,
  freeCam: false,
  killerSpeed: 170,
  detectionRadius: 280,
  inspectionTime: 2.5,
  inspectionDistance: 110,
  showKillerVision: true,
  showAStarPath: true,
  killerAiEnabled: true,
  generatorRepairTime: 12,
  skillCheckFrequency: 3,
  editorMode: false,
  placerSnapToGrid: true,
  survivorActive: true,
  generatorTotalTarget: 8,
  generatorRequiredTarget: 5
};

/**
 * Interface do estado em tempo real exibido na pasta "Telemetria em Tempo Real" do lil-gui.
 */
export interface MonitorState {
  currentSpeed: number;
  isMoving: boolean;
  isSprinting: boolean;
  rotationDeg: string;
  playerScale: string;
  hitboxPixels: string;
  playerX: string;
  playerY: string;
  currentTile: string;
  worldSize: string;
  killerState: string;
  killerDist: string;
  fps: number;
}

export const DEFAULT_MONITOR_STATE: MonitorState = {
  currentSpeed: 0,
  isMoving: false,
  isSprinting: false,
  rotationDeg: '0°',
  playerScale: '0.25x',
  hitboxPixels: '133px',
  playerX: '2560',
  playerY: '1920',
  currentTile: '[40, 30]',
  worldSize: `${WORLD_WIDTH} x ${WORLD_HEIGHT} px (${COLS} x ${ROWS} tiles)`,
  killerState: 'PATROL',
  killerDist: '0px',
  fps: 0
};

