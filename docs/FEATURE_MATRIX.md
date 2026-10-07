# Matriz de Escopo Vivo (Feature Matrix)

Esta matriz documenta o status atual de implementação de todas as mecânicas e subsistemas do jogo, mapeando responsabilidades por arquivo.

---

## 📊 Status Global dos Módulos

| Módulo | Funcionalidade | Status | Arquivos Responsáveis | Descrição |
| :--- | :--- | :---: | :--- | :--- |
| **Locomoção** | Movimentação 8 direções normalizada | `IMPLEMENTADO` | `src/entities/Player.ts` | Caminhada (2.26 m/s) e corrida (4.0 m/s) com vetor unitário diagonal |
| **Locomoção** | Suavização de rotação $360^\circ$ | `IMPLEMENTADO` | `src/entities/Player.ts`, `src/utils/mathUtils.ts` | Rotação suave orientada ao ponteiro do mouse (`turnSpeed = 18`) |
| **Locomoção** | Câmera com interpolação suave | `IMPLEMENTADO` | `src/controllers/CameraController.ts`, `src/scenes/SandboxScene.ts`, `src/utils/mathUtils.ts` | `startFollow` com lerp 0.08 e zoom compensado dinamicamente |
| **Locomoção** | Modo de Câmera Livre & Pan | `IMPLEMENTADO` | `src/controllers/CameraController.ts`, `src/gameplay/gameplayEvaluation.ts` | Pan via botão do meio ou Espaço+LMB sem interferir no controle do Killer |
| **Física** | Limites rígidos de mundo e quinas | `IMPLEMENTADO` | `src/scenes/SandboxScene.ts`, `src/physics/collisionUtils.ts` | Arcade Physics 60Hz com colisão estática em 4 paredes e obstáculos |
| **Física** | Raio de folga anti-travamento | `IMPLEMENTADO` | `src/physics/collisionUtils.ts` | Cápsula de folga de 45px impedindo sobreposição em paredes |
| **IA & Patrulha** | Patrulha autônoma entre geradores | `IMPLEMENTADO` | `src/controllers/KillerAIController.ts`, `src/navigation/patrolUtils.ts` | Seleção de candidatos e inspeção periódica de 2.5s |
| **IA & Patrulha** | Pathfinding A* ponderado | `IMPLEMENTADO` | `src/controllers/KillerAIController.ts`, `src/navigation/navigationUtils.ts` | EasyStar com grid de pesos reduzindo navegação colada a paredes |
| **IA & Patrulha** | Curvas suaves (Look-Ahead Steering) | `IMPLEMENTADO` | `src/controllers/KillerAIController.ts`, `src/navigation/pathSmoothing.ts` | Interpolação vetorial e suavização de rota com string pulling |
| **IA & Patrulha** | Reação acústica a passos e explosões | `IMPLEMENTADO` | `src/controllers/KillerAIController.ts`, `src/ai/KillerFSM.ts` | Estado `INVESTIGATING_SOUND` acionado por ruídos no mapa |
| **IA & Patrulha** | Perseguição com Linha de Visão (LOS) | `IMPLEMENTADO` | `src/controllers/KillerAIController.ts`, `src/ai/KillerFSM.ts`, `src/navigation/navigationUtils.ts` | Transição instantânea para `CHASE` ao avistar o Survivor |
| **IA & Patrulha** | Failsafe anti-stuck do Killer | `IMPLEMENTADO` | `src/controllers/KillerAIController.ts` | Detector de velocidade estagnada (< 15 px/s) forçando re-rota |
| **Combate M1** | Lunge Dash frontal (250ms) | `IMPLEMENTADO` | `src/combat/KillerCombatSystem.ts`, `src/entities/Killer.ts` | Impulso direcional de 1.5x da velocidade nominal (~6.9 m/s) |
| **Combate M1** | Arco de corte frontal (~140°) | `IMPLEMENTADO` | `src/combat/KillerCombatSystem.ts`, `src/gameplay/gameplayEvaluation.ts` | `checkAttackHit` com alcance de 1.9m e tolerância de proximidade |
| **Combate M1** | Blade Wipe (Success Recovery 2.7s) | `IMPLEMENTADO` | `src/combat/KillerCombatSystem.ts`, `src/entities/Killer.ts` | Desaceleração a 30% da velocidade com impacto e dano ao Survivor |
| **Combate M1** | Miss Recovery (1.5s) | `IMPLEMENTADO` | `src/combat/KillerCombatSystem.ts`, `src/entities/Killer.ts` | Desaceleração a 60% da velocidade após golpe no ar |
| **Combate M1** | Bloqueio de M1 acidental por clique | `IMPLEMENTADO` | `src/scenes/SandboxScene.ts`, `src/combat/KillerCombatSystem.ts`, `src/entities/Killer.ts` | Cliques no canvas ignorados exceto com `manualKillerControl = true` |
| **Acústica** | Passos procedurais de Survivor e Killer | `IMPLEMENTADO` | `src/audio/synths/FootstepSynthesizer.ts`, `src/audio/AudioManager.ts`, `src/services/AcousticWaveVisualizer.ts` | Ruído filtrado e sub-grave sintetizados via Web Audio API nativa |
| **Acústica** | Ondas sonoras visuais (Ripples) | `IMPLEMENTADO` | `src/services/AcousticWaveVisualizer.ts`, `src/scenes/SandboxScene.ts` | Círculos expansivos animados com pooling e cores específicas por fonte |
| **Acústica** | Raio de Terror de duas camadas (32m) | `IMPLEMENTADO` | `src/audio/synths/TerrorSynthesizer.ts`, `src/audio/spatial/SpatialAudioService.ts`, `src/audio/AudioManager.ts` | Batimento acelerando (55 a 150 BPM) + Drone dissonante progressivo |
| **Acústica** | Som espacial de gerador danificado | `IMPLEMENTADO` | `src/audio/synths/GeneratorAudioSynthesizer.ts`, `src/audio/spatial/SpatialAudioService.ts`, `src/services/GeneratorLifecycleManager.ts`, `src/scenes/SandboxScene.ts` | Atenuação linear de 10.0m (600px) com estalos estocásticos |
| **Acústica** | Desbloqueio seguro de Autoplay Policy | `IMPLEMENTADO` | `src/audio/core/AudioContextManager.ts`, `src/audio/AudioManager.ts`, `src/scenes/SandboxScene.ts` | Ativação automática no primeiro gesto do usuário sem quebra de grafo |
| **Objetivos** | Reparo contínuo com QTE (Skill Check) | `IMPLEMENTADO` | `src/entities/Generator.ts`, `src/services/GeneratorLifecycleManager.ts`, `src/ui/SkillCheckUI.ts`, `src/gameplay/gameplayEvaluation.ts` | Barra de agulha radial com zonas Great, Good e Miss |
| **Objetivos** | Regressão contínua por chute | `IMPLEMENTADO` | `src/entities/Generator.ts`, `src/audio/synths/GeneratorAudioSynthesizer.ts`, `src/audio/AudioManager.ts`, `src/gameplay/gameplayEvaluation.ts` | Regressão progressiva com faíscas visuais e áudio espacial |
| **Objetivos** | Editor de geradores e persistência F5 | `IMPLEMENTADO` | `src/editor/GeneratorPlacer.ts`, `src/services/GeneratorLifecycleManager.ts`, `src/storage/generatorStorage.ts`, `src/gameplay/placementUtils.ts` | LocalStorage persistindo geradores customizados entre reloads |
| **HUD / UI** | Telemetria HTML superior | `IMPLEMENTADO` | `src/ui/TelemetryHUD.ts`, `src/gameplay/gameplayEvaluation.ts`, `index.html` | Monitor em tempo real de FPS, estado da IA, distância e geradores |
| **HUD / UI** | Legenda de Raios na camada HTML/DOM | `IMPLEMENTADO` | `src/ui/TelemetryHUD.ts`, `index.html` | Card com vidro translúcido independente do zoom da câmera Phaser |
| **HUD / UI** | Badge de desbloqueio de áudio | `IMPLEMENTADO` | `index.html`, `src/ui/TelemetryHUD.ts` | Aviso discreto com fade-out automático no primeiro clique ou tecla |
| **HUD / UI** | Efeito visual de vinheta de perseguição | `IMPLEMENTADO` | `src/ui/TelemetryHUD.ts` | Escurecimento radial dinâmico nas bordas da tela por proximidade |
| **HUD / UI** | Visualização de Debug do Killer (Raios e Waypoints) | `IMPLEMENTADO` | `src/rendering/KillerDebugRenderer.ts`, `src/entities/Killer.ts` | Círculo de terror (32m), raio de visão (14m), linha de perseguição e rota A* com waypoints |
| **Arquitetura**| Decomposição Modular de gameLogic | `IMPLEMENTADO` | `src/utils/mathUtils.ts`, `src/physics/collisionUtils.ts`, `src/navigation/navigationUtils.ts`, `src/storage/generatorStorage.ts`, `src/gameplay/placementUtils.ts`, `src/gameplay/gameplayEvaluation.ts`, `src/utils/gameLogic.ts` | God File (2.205 linhas) decomposto em módulos coesos (todos ≤ 300 linhas) com barrel de transição |
| **Arquitetura**| Decomposição Modular do AudioManager | `IMPLEMENTADO` | `src/audio/core/AudioContextManager.ts`, `src/audio/synths/*`, `src/audio/spatial/SpatialAudioService.ts`, `src/audio/AudioManager.ts` | Monolito de 1.315 linhas modularizado em sintetizadores dedicados e fachada orquestradora (< 120 linhas, todos ≤ 250 linhas) |
| **Arquitetura**| Decomposição Modular da SandboxScene | `IMPLEMENTADO` | `src/controllers/CameraController.ts`, `src/services/AcousticWaveVisualizer.ts`, `src/services/GeneratorLifecycleManager.ts`, `src/scenes/SandboxScene.ts` | God Scene (917 linhas) decomposta em CameraController (208L), AcousticWaveVisualizer (158L), GeneratorLifecycleManager (292L) e cena orquestradora enxuta (348L) |
| **Arquitetura**| Desacoplamento de Combate M1, Debug e FSM do Killer | `IMPLEMENTADO` | `src/combat/KillerCombatSystem.ts`, `src/rendering/KillerDebugRenderer.ts`, `src/ai/KillerFSM.ts`, `src/entities/Killer.ts`, `src/controllers/KillerAIController.ts` | Redução drástica de Killer.ts (844L -> 290L) e KillerAIController.ts (801L -> 490L), desacoplando combate (187L), renderização de depuração (195L) e máquina de estados da IA (166L) |
| **Governança** | Bloqueio de main & Conventional Commits | `IMPLEMENTADO` | `AGENT_RULES.md`, `CONTRIBUTING.md` | Fluxo de branches obrigatório com padrão SemVer |
| **Governança** | Template de Pull Request | `IMPLEMENTADO` | `.github/PULL_REQUEST_TEMPLATE.md` | Checklist de Quality Gate exigindo testes, build e docs atualizados |
| **Governança** | Pipeline de CI no GitHub Actions | `IMPLEMENTADO` | `.github/workflows/ci.yml` | Workflow automatizado com Node 20 validando `npm ci`, build e test |

---

## 🔮 Funcionalidades Futuras / Backlog

| Módulo | Funcionalidade Planejada | Status | Arquivo Previsto |
| :--- | :--- | :---: | :--- |
| **Objetivos** | Portões de saída (Exit Gates) | `PENDENTE` | `src/entities/ExitGate.ts` |
| **Survivor** | Sistema de Saúde completo (Saudável -> Ferido -> Caído) | `PENDENTE` | `src/entities/Player.ts` |
| **Survivor** | Mecânica de Pulos de Janela / Paletes (Vaulting) | `PENDENTE` | `src/entities/Obstacle.ts` |
| **Killer** | Carregar sobrevivente caído e gancho de sacrifício | `PENDENTE` | `src/entities/Hook.ts` |
| **Multiplayer** | Sincronização via WebSocket / WebRTC | `PENDENTE` | `src/network/NetworkManager.ts` |
