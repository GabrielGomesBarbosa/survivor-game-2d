# Projeto: 2D Top-Down Survival Horror (Estilo Dead by Daylight)

## Stack Técnica

- Vite + TypeScript + Phaser 3 (Arcade Physics)
- Node.js scripts para manipulação de assets locais

---

## Fase 1: Setup do Ambiente & Sandbox de Testes

### 1. Pré-processamento de Assets (Script Automatizado)

- O arquivo de entrada está em `public/assets/survivor.jpg`[cite: 5].
- Criar e rodar um script Node (usando `sharp` ou `jimp`) para:
  1. Detectar a cor predominante de fundo cinza ao redor dos sprites[cite: 5].
  2. Tornar o fundo 100% transparente (canal alfa = 0)[cite: 5].
  3. Salvar o resultado final como `public/assets/survivor.png`[cite: 5].

### 2. Configuração do Phaser 3 + Vite

- Inicializar o projeto com Vite template vanilla-ts (ou instalar Phaser diretamente com TypeScript).
- Configuração de tela: Resolução 1280x720, com física Arcade (`gravity: { x: 0, y: 0 }` e `debug: true`).
- A cena inicial deve ser a `SandboxScene`.

### 3. Estrutura do Sandbox (`SandboxScene.ts`)

- **Cenário de Teste:**
  - Chão com grid visual (quadriculado escuro).
  - 4 paredes delimitando o mapa (com colisão física estática).
  - 2 ou 3 obstáculos fechados no centro da sala para testar quinas.
- **Player (Sobrevivente):**
  - Carregar o spritesheet gerado `public/assets/survivor.png` (8 frames organizados em 2 linhas: 4 de caminhada e 4 de corrida)[cite: 5].
  - Criar as animações `walk` (linha 1)[cite: 5] e `run` (linha 2)[cite: 5].
  - **Movimentação:** Teclas WASD com movimento omnidirecional normalizado (evitar que andar na diagonal seja mais rápido).
  - **Sprint:** Segurar `Shift` ativa a velocidade de corrida e a animação `run`[cite: 5].
  - **Rotação:** O sprite do jogador deve girar em $360^\circ$ apontando para a posição atual do cursor do mouse.
  - **Colisão:** Ativar colisão entre o Player e as paredes/obstáculos.

### 4. Sliders de Ajuste Rápido (lil-gui ou Tweakpane)

- Incluir um pequeno painel de debug no canto da tela para ajustar em tempo real:
  - `walkSpeed` (padrão: 140)
  - `runSpeed` (padrão: 240)
  - `turnSpeed` / Suavização da rotação
