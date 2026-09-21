# BACKLOG_PENDENCIAS.md

**Data:** 20/09/2026
**Status Geral:** Fases 1, 2 e 3 Concluídas | Fase 4 e Mecânicas Core em Aberto
**Escopo:** Lista estrita de itens em aberto para implementação e arquitetura

---

## 1. Comportamento Tático e Visão da IA (Fase 4)

- [ ] **Cone de Visão Direcional (FOV) com Oclusão Real por Paredes**
  - Substituição do raio circular radial por cone direcional frontal (90° a 120°, alcance ~350 a 400px) alinhado ao ângulo de rotação do Killer.
  - Oclusão via raycast contínuo contra paredes '#' e carcaças de geradores, permitindo que o Survivor use cantos cegos para se ocultar.
  - Renderização visual do cone em modo debug alternando cores conforme o estado da IA (patrulha vs perseguição).
- [ ] **Máquina de Estados de Perseguição (CHASE & SEARCH)**
  - **CHASE:** Aceleração imediata para velocidade de perseguição (~200 a 210 px/s) com perseguição direta e contínua em direção às coordenadas do Survivor.
  - **SEARCH:** Ao perder a linha de visão do Survivor, navegar até a Última Posição Conhecida (Last Known Position) e rastrear o perímetro por 2.5 a 3.0s antes de retomar a ronda.
- [ ] **Heurística de Ronda Ponderada**
  - Patrulha inteligente priorizando geradores com maior progresso de reparo acumulado e proximidade euclidiana.
  - Exclusão definitiva de geradores finalizados (100%) da rota prioritária de patrulha.

---

## 2. Mecânica Central (Core Gameplay)

- [ ] **Ataque do Killer e Estados de Vida do Survivor (M1 & Health System)**
  - Ação de golpe corpo a corpo frontal com cooldown e penalidade temporária de desaceleração pós-ataque.
  - Estados do Survivor: Saudável (Healthy) -> Ferido (Injured, com rastro/penalidade) -> Derrubado (Dying/Downed).
- [ ] **Mecânicas de Looping (Pallets & Vaults / Janelas)**
  - Janelas de salto rápido para Survivor e salto lento para Killer.
  - Pallets funcionais com 3 estados: em pé (transitável/pulável), derrubada (bloqueia Killer até ser quebrada) e destruída.
- [ ] **Portões de Saída e Conclusão de Partida**
  - Ativação de 2 portões de fuga externos ao atingir a meta configurada de geradores (padrão: 5).
  - Alavanca temporizada para abertura e zona de fuga vitoriosa.

---

## 3. Feedback Sensorial e Atmosfera

- [ ] **Raio de Terror Dinâmico (Terror Radius / Heartbeat)**
  - Modulação sonora de batimentos cardíacos com base na proximidade euclidiana do Killer (32m ≈ 500px).
- [ ] **Red Stain (Luz Vermelha Frontal)**
  - Projeção luminosa direcional suave no chão à frente do Killer para permitir leitura de curvas e mindgames.
