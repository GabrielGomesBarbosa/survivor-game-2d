import GUI from 'lil-gui';
import {
  DebugSettings,
  DEFAULT_DEBUG_SETTINGS,
  MonitorState,
  DEFAULT_MONITOR_STATE,
  STORAGE_KEY
} from '../config/constants';

export interface DebugPanelCallbacks {
  onSettingsChanged?: (settings: DebugSettings) => void;
  onPlayerScaleOrHitboxChanged?: (scale: number, radius: number) => void;
  onAnimFrameRateChanged?: (animKey: 'walk' | 'run', fps: number) => void;
  onPhysicsDebugToggled?: (show: boolean) => void;
  onCameraZoomChanged?: (zoom: number) => void;
  onFreeCamToggled?: (enabled: boolean) => void;
  onTogglePlacerMode?: (enabled: boolean) => void;
  onTogglePlacerSnap?: (snap: boolean) => void;
  onCyclePlacerRotation?: () => void;
  onCopyCandidatesJson?: () => void;
  onClearCandidates?: () => void;
  onTestSkillCheck?: () => void;
  onCompleteAllGenerators?: () => void;
  onResetAllGenerators?: () => void;
  onShuffleGenerators?: () => void;
  onLoadFullPool?: () => void;
  onClearAllGenerators?: () => void;
  onSurvivorActiveToggled?: (active: boolean) => void;
  onGeneratorTargetsChanged?: (total: number, required: number) => void;
  onAudioSettingsChanged?: (enabled: boolean, volume: number) => void;
  onTerrorHeartbeatVisualToggled?: (enabled: boolean) => void;
  onResetDefaults?: () => void;
}

/**
 * @class DebugPanel
 * @description Integrates lil-gui inside the dedicated right sidebar container (#debug-gui-container).
 * Provides granular sliders, switches, live monitors, tooltips [?], and LocalStorage persistence.
 */
export class DebugPanel {
  public settings: DebugSettings;
  public monitorState: MonitorState;
  private gui: GUI;
  private callbacks: DebugPanelCallbacks;

  /**
   * @param callbacks Callback handlers triggered when settings change or action buttons are clicked
   */
  constructor(callbacks: DebugPanelCallbacks = {}) {
    this.callbacks = callbacks;
    this.settings = { ...DEFAULT_DEBUG_SETTINGS };
    this.monitorState = { ...DEFAULT_MONITOR_STATE };

    this.loadSettingsFromStorage();

    const container = document.getElementById('debug-gui-container');
    this.gui = new GUI({
      container: container || undefined,
      title: '⚙️ Sandbox Debug',
      width: 350
    });

    this.buildFolders();
    this.setupGuiEventListeners();
  }

  /**
   * Constructs all folders and controls within the lil-gui panel
   */
  private buildFolders(): void {
    // 1. Velocidades & Movimento
    const speedsFolder = this.gui.addFolder('Velocidades & Movimento');
    this.attachTooltip(
      speedsFolder
        .add(this.settings, 'survivorActive')
        .name('Survivor Ativo')
        .onChange((val: boolean) => {
          this.settings.survivorActive = Boolean(val);
          this.saveSettingsToStorage();
          this.callbacks.onSurvivorActiveToggled?.(this.settings.survivorActive);
          this.callbacks.onSettingsChanged?.(this.settings);
        }),
      'Habilita ou desabilita o Survivor no mapa (Modo Espectador do Killer). Quando desmarcado, torna o Survivor invisível, desativa colisão física e faz a IA do Killer ignorá-lo.'
    );
    this.attachTooltip(
      speedsFolder
        .add(this.settings, 'walkSpeed', 1.0, 3.5, 0.1)
        .name('Walk Speed (m/s)')
        .onChange(() => this.saveSettingsToStorage()),
      'Velocidade base de caminhada do Player em metros/segundo (WASD normal, ~2.3 m/s).'
    );
    this.attachTooltip(
      speedsFolder
        .add(this.settings, 'runSpeed', 2.5, 6.0, 0.1)
        .name('Run Speed (m/s)')
        .onChange(() => this.saveSettingsToStorage()),
      'Velocidade máxima de corrida ao pressionar a tecla Shift em metros/segundo (padrão DBD 4.0 m/s).'
    );
    this.attachTooltip(
      speedsFolder
        .add(this.settings, 'turnSpeed', 1, 60, 1)
        .name('Turn Speed')
        .onChange((val: number) => {
          this.settings.turnSpeed = Number(val) || 18;
          this.callbacks.onSettingsChanged?.(this.settings);
        }),
      'Suavidade e velocidade de rotação do corpo em direção ao mouse.'
    );
    this.attachTooltip(
      speedsFolder
        .add(this.settings, 'playerScale', 0.05, 1.0, 0.01)
        .name('Player Scale')
        .onChange((val: number) => {
          this.settings.playerScale = Number(val) || 0.25;
          this.callbacks.onPlayerScaleOrHitboxChanged?.(this.settings.playerScale, this.settings.hitboxRadius);
        }),
      'Fator multiplicador da escala gráfica e física do Player (0.25 calibrado para os corredores).'
    );
    this.attachTooltip(
      speedsFolder
        .add(this.settings, 'instantTurn')
        .name('Giro Instantâneo')
        .onChange((val: boolean) => {
          this.settings.instantTurn = Boolean(val);
          this.callbacks.onSettingsChanged?.(this.settings);
        }),
      'Desativa o amortecimento angular, virando o corpo do Player instantaneamente para a mira.'
    );

    // 2. Taxa de Animações
    const animFolder = this.gui.addFolder('Taxa de Animações (FPS)');
    this.attachTooltip(
      animFolder
        .add(this.settings, 'walkAnimFrameRate', 2, 24, 1)
        .name('Walk Anim FPS')
        .onChange((val: number) => {
          this.callbacks.onAnimFrameRateChanged?.('walk', val);
        }),
      'Taxa de quadros por segundo da animação de caminhada ("walk").'
    );
    this.attachTooltip(
      animFolder
        .add(this.settings, 'runAnimFrameRate', 2, 30, 1)
        .name('Run Anim FPS')
        .onChange((val: number) => {
          this.callbacks.onAnimFrameRateChanged?.('run', val);
        }),
      'Taxa de quadros por segundo da animação de corrida rápida ("run").'
    );

    // 3. Física & Renderização
    const displayFolder = this.gui.addFolder('Física & Renderização');
    this.attachTooltip(
      displayFolder
        .add(this.settings, 'cameraZoom', 0.4, 1.5, 0.05)
        .name('Camera Zoom')
        .onChange((val: number) => {
          this.settings.cameraZoom = Number(val) || 1.0;
          this.callbacks.onCameraZoomChanged?.(this.settings.cameraZoom);
        }),
      'Nível de aproximação/afastamento da câmera virtual centrada no sobrevivente.'
    );
    this.attachTooltip(
      displayFolder
        .add(this.settings, 'freeCam')
        .name('Câmara Livre (Pan)')
        .onChange((val: boolean) => {
          this.settings.freeCam = Boolean(val);
          this.callbacks.onFreeCamToggled?.(this.settings.freeCam);
        }),
      'Desativa o seguimento automático do Player e permite arrastar o mapa livremente com o ponteiro do mouse.'
    );
    this.attachTooltip(
      displayFolder
        .add(this.settings, 'hitboxRadius', 150, 350, 5)
        .name('Raio Base Hitbox')
        .onChange((val: number) => {
          this.settings.hitboxRadius = Number(val) || 265;
          this.callbacks.onPlayerScaleOrHitboxChanged?.(this.settings.playerScale, this.settings.hitboxRadius);
        }),
      'Raio base do círculo de colisão em pixels da textura original antes do scaling.'
    );
    this.attachTooltip(
      displayFolder
        .add(this.settings, 'showPhysicsDebug')
        .name('Visualizar Colisão')
        .onChange((enabled: boolean) => {
          this.callbacks.onPhysicsDebugToggled?.(enabled);
        }),
      'Desenha os contornos de colisão Arcade (hitbox circular do Player/Killer e quinas).'
    );

    // 4. Killer (IA)
    const killerFolder = this.gui.addFolder('Killer (IA)');
    this.attachTooltip(
      killerFolder
        .add(this.settings, 'killerSpeed', 3.0, 6.5, 0.1)
        .name('Killer Speed (m/s)')
        .onChange(() => this.saveSettingsToStorage()),
      'Velocidade constante única do Assassino em todos os estados de deslocamento (PATROL, ALERT, CHASE) em metros/segundo (padrão DBD 4.6 m/s).'
    );
    this.attachTooltip(
      killerFolder
        .add(this.settings, 'detectionRadius', 2.0, 20.0, 0.5)
        .name('Detection Radius (m)')
        .onChange(() => this.saveSettingsToStorage()),
      'Distância máxima de percepção em metros na qual o Killer avista o Player e inicia perseguição (padrão ~7.5m).'
    );
    this.attachTooltip(
      killerFolder
        .add(this.settings, 'inspectionTime', 0.5, 8.0, 0.5)
        .name('Tempo Inspeção (s)')
        .onChange(() => this.saveSettingsToStorage()),
      'Tempo de pausa em segundos que o Assassino passa inspecionando o gerador antes de avançar para o próximo.'
    );
    this.attachTooltip(
      killerFolder
        .add(this.settings, 'inspectionDistance', 80, 160, 5)
        .name('Distância Inspeção')
        .onChange(() => this.saveSettingsToStorage()),
      'Distância em pixels para considerar chegada ao gerador e disparar o estado de inspeção (zona amarela).'
    );
    this.attachTooltip(
      killerFolder
        .add(this.settings, 'showKillerVision')
        .name('Debug Visão'),
      'Renderiza círculos de detecção (laranja em patrulha, vermelho em perseguição) e linha de mira.'
    );
    this.attachTooltip(
      killerFolder
        .add(this.settings, 'showAStarPath')
        .name('Mostrar Rota A*'),
      'Traça no mapa a linha ciano e balizas da rota contornando paredes calculada pelo A* (EasyStar).'
    );
    this.attachTooltip(
      killerFolder
        .add(this.settings, 'killerAiEnabled')
        .name('Killer Bot (IA Ativa)'),
      'Liga ou desliga o bot do Assassino. Quando desmarcado, a IA congela e o estado passa para DESATIVADO.'
    );
    killerFolder.open();

    // 5. Telemetria em Tempo Real
    const monitorFolder = this.gui.addFolder('Telemetria em Tempo Real');
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'worldSize').name('Tamanho Mapa').listen().disable(),
      'Dimensões totais da instalação em pixels e blocos da grelha (largura x altura).'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'currentTile').name('Tile Atual').listen().disable(),
      'Coordenadas de coluna e linha [col, row] do ladrilho onde o Player se encontra no grid.'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'killerState').name('Estado Killer').listen().disable(),
      'Estado da máquina FSM do Killer: PATROL (patrulha), CHASE (perseguição), STANDBY (aguardando geradores) ou DESATIVADO (robô desligado).'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'killerDist').name('Dist. Killer').listen().disable(),
      'Distância real de superfície (borda a borda) entre as hitboxes do Player e do Killer (0px no contato).'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'currentSpeed').name('Vel. Atual').listen().disable(),
      'Velocidade vetorial instantânea do Player em pixels por segundo.'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'isMoving').name('Movendo').listen().disable(),
      'Indica se o jogador está se deslocando no momento via WASD.'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'isSprinting').name('Sprint (Shift)').listen().disable(),
      'Indica se o jogador está correndo com a tecla Shift pressionada.'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'rotationDeg').name('Ângulo').listen().disable(),
      'Orientação angular do personagem em graus (0° a 360°) apontando para o cursor.'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'playerScale').name('Escala Atual').listen().disable(),
      'Multiplicador de escala atual do Player (definido no slider de escala).'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'hitboxPixels').name('Hitbox Diâmetro').listen().disable(),
      'Diâmetro real calibrado do círculo de colisão física Arcade em pixels.'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'playerX').name('Pos X').listen().disable(),
      'Coordenada horizontal X do centro do Player no cenário.'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'playerY').name('Pos Y').listen().disable(),
      'Coordenada vertical Y do centro do Player no cenário.'
    );
    this.attachTooltip(
      monitorFolder.add(this.monitorState, 'fps').name('Game FPS').listen().disable(),
      'Taxa real de quadros por segundo gerada pelo loop do Phaser.'
    );

    // 6. Geradores (DBD)
    const genFolder = this.gui.addFolder('Geradores (DBD)');
    this.attachTooltip(
      genFolder
        .add(this.settings, 'generatorRepairTime', 4, 30, 1)
        .name('Tempo Reparo (s)')
        .onChange(() => this.saveSettingsToStorage()),
      'Tempo necessário em segundos segurando [E] para concluir 100% do reparo de um gerador.'
    );
    this.attachTooltip(
      genFolder
        .add(this.settings, 'skillCheckFrequency', 2, 12, 0.5)
        .name('Frequência QTE (s)')
        .onChange(() => this.saveSettingsToStorage()),
      'Intervalo médio em segundos entre os testes de reação (Skill Checks) durante o conserto.'
    );
    this.attachTooltip(
      genFolder
        .add(this.settings, 'generatorTotalTarget', 1, 16, 1)
        .name('Total no Mapa')
        .onChange((val: number) => {
          this.settings.generatorTotalTarget = Number(val) || 8;
          this.saveSettingsToStorage();
          this.callbacks.onGeneratorTargetsChanged?.(this.settings.generatorTotalTarget, this.settings.generatorRequiredTarget);
        }),
      'Quantidade de geradores sorteados para instanciar no mapa (1 a 16).'
    );
    this.attachTooltip(
      genFolder
        .add(this.settings, 'generatorRequiredTarget', 1, 12, 1)
        .name('Meta para Concluir')
        .onChange((val: number) => {
          this.settings.generatorRequiredTarget = Number(val) || 5;
          this.saveSettingsToStorage();
          this.callbacks.onGeneratorTargetsChanged?.(this.settings.generatorTotalTarget, this.settings.generatorRequiredTarget);
        }),
      'Meta de geradores necessários para acionar a vitória da partida.'
    );

    const genActions = {
      shuffleGenerators: () => this.callbacks.onShuffleGenerators?.(),
      loadFullPool: () => this.callbacks.onLoadFullPool?.(),
      clearAllGenerators: () => this.callbacks.onClearAllGenerators?.(),
      testSkillCheck: () => this.callbacks.onTestSkillCheck?.(),
      completeAll: () => this.callbacks.onCompleteAllGenerators?.(),
      resetAll: () => this.callbacks.onResetAllGenerators?.()
    };

    this.attachTooltip(
      genFolder.add(genActions, 'shuffleGenerators').name('🎲 Sortear Geradores (Shuffle)'),
      'Sorteia aleatoriamente a quantidade definida em "Total no Mapa" a partir do pool de candidatos e os instancia no mapa.'
    );
    this.attachTooltip(
      genFolder.add(genActions, 'loadFullPool').name('📦 Carregar Pool Completo'),
      'Instancia na cena todos os candidatos cadastrados no pool para validação de spawns.'
    );
    this.attachTooltip(
      genFolder.add(genActions, 'clearAllGenerators').name('🧹 Limpar Todos do Mapa'),
      'Remove e destrói todos os geradores ativos da cena, esvazia o mapa e coloca o Killer em STANDBY.'
    );
    this.attachTooltip(
      genFolder.add(genActions, 'testSkillCheck').name('🎯 Disparar Skill Check'),
      'Dispara imediatamente um evento de Skill Check (QTE com barra giratória e [Espaço]) para testes.'
    );
    this.attachTooltip(
      genFolder.add(genActions, 'completeAll').name('⚡ Concluir Todos'),
      'Define todos os geradores ativos para 100% concluídos imediatamente.'
    );
    this.attachTooltip(
      genFolder.add(genActions, 'resetAll').name('🔄 Resetar Geradores'),
      'Reseta o progresso de todos os geradores para 0% e reativa o estado incompleto.'
    );

    // 7. Modo Editor de Spawns (DBD Builder)
    const editorFolder = this.gui.addFolder('Modo Editor de Spawns');
    this.attachTooltip(
      editorFolder
        .add(this.settings, 'editorMode')
        .name('Ativar Modo Posicionamento')
        .onChange((val: boolean) => {
          this.settings.editorMode = Boolean(val);
          this.callbacks.onTogglePlacerMode?.(this.settings.editorMode);
        }),
      'Ativa a ferramenta de posicionamento de geradores. Permite fixar novos pontos com LMB, remover com RMB e rotacionar com [R].'
    );
    this.attachTooltip(
      editorFolder
        .add(this.settings, 'placerSnapToGrid')
        .name('Snap ao Grid (32px)')
        .onChange((val: boolean) => {
          this.settings.placerSnapToGrid = Boolean(val);
          this.callbacks.onTogglePlacerSnap?.(this.settings.placerSnapToGrid);
        }),
      'Alinha a posição do holograma em múltiplos de 32px (meio-ladrilho). Desmarque para posicionamento contínuo livre.'
    );

    const editorActions = {
      rotate: () => this.callbacks.onCyclePlacerRotation?.(),
      copyJson: () => this.callbacks.onCopyCandidatesJson?.(),
      clearCandidates: () => this.callbacks.onClearCandidates?.()
    };

    this.attachTooltip(
      editorFolder.add(editorActions, 'rotate').name('🔄 Girar [R] (+90°)'),
      'Gira a orientação do gerador em 90 graus (0°, 90°, 180°, 270°).'
    );
    this.attachTooltip(
      editorFolder.add(editorActions, 'copyJson').name('📋 Copiar Candidatos (JSON)'),
      'Copia a lista estruturada de candidatos para a área de transferência e imprime no console.'
    );
    this.attachTooltip(
      editorFolder.add(editorActions, 'clearCandidates').name('🗑️ Limpar Candidatos Marcados'),
      'Remove todos os marcadores de candidatos da cena e limpa os dados salvos no localStorage (horror2d_generator_candidates).'
    );
    editorFolder.open();

    // 8. Áudio
    const audioFolder = this.gui.addFolder('Áudio');
    this.attachTooltip(
      audioFolder
        .add(this.settings, 'audioEnabled')
        .name('Áudio Ativo')
        .onChange((val: boolean) => {
          this.settings.audioEnabled = Boolean(val);
          this.saveSettingsToStorage();
          this.callbacks.onAudioSettingsChanged?.(this.settings.audioEnabled, this.settings.masterVolume);
          this.callbacks.onSettingsChanged?.(this.settings);
        }),
      'Habilita ou desabilita os efeitos sonoros procedurais do jogo.'
    );
    this.attachTooltip(
      audioFolder
        .add(this.settings, 'masterVolume', 0, 1, 0.05)
        .name('Volume Geral')
        .onChange((val: number) => {
          this.settings.masterVolume = Number(val);
          this.saveSettingsToStorage();
          this.callbacks.onAudioSettingsChanged?.(this.settings.audioEnabled, this.settings.masterVolume);
          this.callbacks.onSettingsChanged?.(this.settings);
        }),
      'Volume mestre de todos os efeitos sonoros gerados via Web Audio API (0 a 1).'
    );
    audioFolder.open();

    // 9. HUD / Interface
    const hudFolder = this.gui.addFolder('HUD / Interface');
    this.attachTooltip(
      hudFolder
        .add(this.settings, 'terrorHeartbeatVisual')
        .name('Coração de Terror Visual')
        .onChange((val: boolean) => {
          this.settings.terrorHeartbeatVisual = Boolean(val);
          this.saveSettingsToStorage();
          this.callbacks.onTerrorHeartbeatVisualToggled?.(this.settings.terrorHeartbeatVisual);
          this.callbacks.onSettingsChanged?.(this.settings);
        }),
      'Exibe o ícone visual de coração pulsante no HUD sincronizado matematicamente ao Raio de Terror do Killer.'
    );
    hudFolder.open();

    // 10. Botão de restaurar configurações padrão
    const actions = {
      resetDefaults: () => this.resetSettingsToDefaults()
    };
    this.attachTooltip(
      this.gui.add(actions, 'resetDefaults').name('🔄 Restaurar Padrões'),
      'Restaura todas as opções de velocidade, zoom, hitbox e IA para os valores padrão.'
    );

    genFolder.open();
    speedsFolder.open();
    displayFolder.open();
    monitorFolder.open();
  }

  /**
   * Configures automatic focus release so keyboard input passes through to Phaser immediately
   */
  private setupGuiEventListeners(): void {
    this.gui.onChange(() => {
      this.saveSettingsToStorage();
      this.callbacks.onSettingsChanged?.(this.settings);
    });

    this.gui.domElement.addEventListener('pointerup', () => {
      if (
        document.activeElement instanceof HTMLInputElement &&
        document.activeElement.type === 'checkbox'
      ) {
        document.activeElement.blur();
      }
    });

    this.gui.domElement.addEventListener('change', (e: Event) => {
      const target = e.target as HTMLElement;
      if (target && target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox') {
        target.blur();
      }
    });

    this.gui.domElement.addEventListener('pointerleave', () => {
      const active = document.activeElement;
      if (active && this.gui.domElement.contains(active)) {
        (active as HTMLElement).blur();
      }
    });
  }

  /**
   * Binds informative tooltips and [?] icons to controllers
   * @param controller lil-gui Controller instance
   * @param description Explanatory text
   */
  public attachTooltip(controller: any, description: string): any {
    if (!controller || !controller.domElement) return controller;

    controller.domElement.setAttribute('data-tooltip', description);
    controller.domElement.setAttribute('title', description);

    if (controller.$name) {
      const help = document.createElement('span');
      help.className = 'debug-help-icon';
      help.textContent = '?';
      help.setAttribute('aria-label', description);
      controller.$name.appendChild(help);
    }

    controller.domElement.addEventListener('mouseenter', (e: MouseEvent) => {
      const title = controller._name || controller.property || 'Configuração';
      this.showTooltip(e, title, description);
    });

    controller.domElement.addEventListener('mouseleave', () => {
      this.hideTooltip();
    });

    return controller;
  }

  private showTooltip(e: MouseEvent, title: string, text: string): void {
    const tooltip = document.getElementById('debug-tooltip');
    if (!tooltip) return;

    tooltip.innerHTML = `<strong>${title}</strong><span>${text}</span>`;
    tooltip.classList.add('visible');

    const target = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    let top = target.top + (target.height - tooltipRect.height) / 2;
    let left = target.left - tooltipRect.width - 12;

    if (top < 12) top = 12;
    if (top + tooltipRect.height > window.innerHeight - 12) {
      top = window.innerHeight - tooltipRect.height - 12;
    }
    if (left < 12) {
      left = target.right + 12;
    }

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  private hideTooltip(): void {
    const tooltip = document.getElementById('debug-tooltip');
    if (tooltip) {
      tooltip.classList.remove('visible');
    }
  }

  /**
   * Loads saved debug settings from LocalStorage
   */
  public loadSettingsFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        Object.keys(DEFAULT_DEBUG_SETTINGS).forEach((key) => {
          if (key in parsed) {
            (this.settings as any)[key] = parsed[key];
          }
        });

        // Migração automática de valores legados em pixels para a nova escala métrica (m e m/s)
        if (typeof this.settings.walkSpeed === 'number' && this.settings.walkSpeed > 10) {
          this.settings.walkSpeed = Number((this.settings.walkSpeed / 60).toFixed(2));
        }
        if (typeof this.settings.runSpeed === 'number' && this.settings.runSpeed > 10) {
          this.settings.runSpeed = Number((this.settings.runSpeed / 60).toFixed(2));
        }
        if (typeof this.settings.killerSpeed === 'number' && this.settings.killerSpeed > 10) {
          this.settings.killerSpeed = Number((this.settings.killerSpeed / 60).toFixed(2));
        }
        if (typeof this.settings.detectionRadius === 'number' && this.settings.detectionRadius > 25) {
          this.settings.detectionRadius = Number((this.settings.detectionRadius / 60).toFixed(1));
        }
      }
    } catch (e) {
      console.warn('Erro ao carregar debugSettings do localStorage:', e);
    }
  }

  /**
   * Saves current debug settings to LocalStorage
   */
  public saveSettingsToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch (e) {
      console.warn('Erro ao salvar debugSettings no localStorage:', e);
    }
  }

  /**
   * Resets all settings to original defaults and updates the GUI display
   */
  public resetSettingsToDefaults(): void {
    Object.assign(this.settings, DEFAULT_DEBUG_SETTINGS);
    this.saveSettingsToStorage();
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    this.callbacks.onFreeCamToggled?.(this.settings.freeCam);
    this.callbacks.onSurvivorActiveToggled?.(this.settings.survivorActive);
    this.callbacks.onGeneratorTargetsChanged?.(this.settings.generatorTotalTarget, this.settings.generatorRequiredTarget);
    this.callbacks.onResetDefaults?.();
  }

  /**
   * Destroys lil-gui instance
   */
  public destroy(): void {
    this.gui.destroy();
  }
}
