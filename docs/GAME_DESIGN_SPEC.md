# Especificação Técnica de Game Design & Balanceamento

Este documento é a **Fonte Única da Verdade (Single Source of Truth)** para todas as regras, constantes numéricas, métricas e fórmulas matemáticas do jogo.

---

## 📐 1. Métrica, Proporção e Espaço

O projeto adota uma conversão métrica fixa inspirada no padrão competitivo de jogos assimétricos de terror (como *Dead by Daylight*):

| Grandeza | Valor Nominal | Valor em Pixels | Descrição |
| :--- | :--- | :--- | :--- |
| **Escala Métrica** | `1.0 metro` | `60 pixels` | Constante global `PIXELS_PER_METER = 60` |
| **Largura do Mundo** | `85.33 metros` | `5120 pixels` | `WORLD_WIDTH` (80 colunas de tiles) |
| **Altura do Mundo** | `64.00 metros` | `3840 pixels` | `WORLD_HEIGHT` (60 linhas de tiles) |
| **Tamanho do Bloco (Tile)**| `1.07 metros` | `64 pixels` | Grade lógica de colisão e pathfinding A* |
| **Folga de Navegação** | `0.75 metro` | `45 pixels` | `clearanceRadius = 45px` (cápsula anti-travamento em quinas) |
| **Raio da Hitbox do Survivor** | `1.10 metros` | `66.25 pixels` | `hitboxRadius = 265` escalado a `0.25x` |
| **Raio da Hitbox do Killer** | `1.41 metros` | `84.80 pixels` | `killerRadius = playerRadius * 1.28` |

---

## 🏃 2. Movimentação e Locomoção

### 2.1 Sobrevivente (Survivor)
- **Caminhada (Walk):** `2.26 m/s` (aproximadamente `135.6 px/s`).
  - Animação: 8 FPS (frame 0 a 3 da folha de sprites).
- **Corrida (Sprint):** `4.00 m/s` (`240 px/s`).
  - Ativado ao segurar <kbd>Shift</kbd>.
  - Animação: 12 FPS (frame 4 a 7 da folha de sprites).
- **Rotação:** $360^\circ$ apontando para o cursor do mouse com velocidade angular de `turnSpeed = 18 rad/s` (ou rotação instantânea configurável via debug).
- **Normalização Vetorial:** O movimento diagonal utiliza vetores normalizados ($\frac{\sqrt{2}}{2}$), impedindo ganho de velocidade artificial nas diagonais.

### 2.2 Assassino (Killer)
- **Velocidade Única e Constante:** `4.60 m/s` (`276 px/s`).
- **Política de Velocidade Homogênea:** O Killer mantém estritamente a velocidade nominal de `4.6 m/s` em todos os estados de IA (`PATROL`, `INSPECTING_GENERATOR`, `INVESTIGATING_SOUND`, `CHASE`). Isso garante estabilidade matemática no cálculo de rotas no EasyStar e previsibilidade de perseguição para o jogador.

---

## ⚔️ 3. Sistema de Combate e Ataque Básico (M1)

O sistema de ataque M1 implementa o modelo de *Lunge Dash* com janelas de recuperação (*Blade Wipe* e *Miss Recovery*).

### 3.1 Estados da Máquina de Combate
```
[IDLE / PATROL / CHASE]
          │
          ▼  performAttack()
     ┌──────────┐
     │  LUNGE   │ ◄── Dash frontal de 250ms a 1.5x da velocidade (~6.9 m/s)
     └────┬─────┘
          │
    ┌─────┴──────────────────────┐
    │ Houve contato?             │
    ▼ SIM                        ▼ NÃO (Tempo esgotou)
┌──────────────────────┐   ┌───────────────────┐
│   SUCCESS_RECOVERY   │   │   MISS_RECOVERY   │
│ (Blade Wipe - 2.7s)  │   │  (Recuperação - 1.5s) │
│   Velocidade: 30%    │   │  Velocidade: 60%  │
└──────────┬───────────┘   └─────────┬─────────┘
           │                         │
           └────────────►◄───────────┘
                         │
                         ▼ attackTimer <= 0
                   [IDLE / RECOVERY_END]
```

### 3.2 Parâmetros Nominais de Ataque
1. **Lunge Dash:**
   - Duração: `250 ms`.
   - Velocidade de arremetida: `1.5 * killerSpeed = 6.90 m/s` (`414 px/s`).
   - Assistência de mira angular: Interpolação suave a `8 rad/s` em direção ao Survivor durante o avanço.
   - Áudio: Whoosh de lâmina cortando o ar (`playAttackSwingSound`).
2. **Sucesso (Blade Wipe):**
   - Duração: `2.70 segundos` (`2700 ms`).
   - Velocidade durante o recovery: `30%` da velocidade nominal (`1.38 m/s` / `82.8 px/s`).
   - Dano: Aplica transição de saúde ao Survivor (`takeDamage()`).
   - Áudio e Visual: Impacto visceral de corte (`playAttackHitSound`) + flash de tela vermelho.
3. **Erro (Miss Recovery):**
   - Duração: `1.50 segundo` (`1500 ms`).
   - Velocidade durante o recovery: `60%` da velocidade nominal (`2.76 m/s` / `165.6 px/s`).
4. **Critérios de Detecção de Acerto (`checkAttackHit`):**
   - **Alcance Máximo Frontal:** `1.90 metros` (`114 pixels`).
   - **Tolerância de Contato Físico:** `playerRadius + killerRadius + 12px`.
   - **Arco Frontal de Corte:** $\approx 140^\circ$ total ($\pm 70^\circ$ a partir do vetor frontal do assassino; $|\Delta\theta| \le 0.40\pi$).

---

## 🔊 4. Sistema Acústico, Furtividade e Percepção

O áudio do jogo é 100% procedural (Web Audio API nativa), eliminando o carregamento de arquivos externos.

### 4.1 Propagação de Ruído e Raios de Percepção
| Fonte de Ruído | Raio Auditivo (Metros) | Raio Auditivo (Pixels) | Cor da Onda | Comportamento da IA |
| :--- | :--- | :--- | :--- | :--- |
| **Survivor Parado** | `0.0 m` | `0 px` | - | Silêncio total |
| **Survivor Andando** | `4.0 m` | `240 px` | Ciano (`0x00ffff`) | Detectado se dentro do raio de visão/audição |
| **Survivor Correndo** | `14.0 m` | `840 px` | Ciano (`0x00ffff`) | Atrai o Killer caso não esteja em perseguição |
| **Passos do Killer** | `14.0 m` a `20.0 m` | `840 px` a `1200 px` | Roxo (`0xa855f7`) | Som de impacto grave com atenuação de volume |
| **Raio de Terror** | `32.0 m` | `1920 px` | Vermelho (`0xff2222`) | Batimento cardíaco e Drone de tensão |
| **Gerador Regredindo** | `10.0 m` | `600 px` | Amarelo (`0xfef08a`) | Som espacial de motor com faíscas estocásticas |
| **Explosão de Gerador**| `36.0 m` | `2160 px` | Laranja (`0xff5522`) | Alerta prioritário imediato (`INVESTIGATING_SOUND`) |

### 4.2 Camadas do Raio de Terror (32.0m / 1920px)
O Raio de Terror é composto por duas camadas contínuas:
1. **Camada 1: Batimento Cardíaco Reativo ("Lub-Dub"):**
   - Ativa entre `0m` e `32.0m` (`< 1920px`).
   - Síntese acústica: Par duplo senoidal a 55Hz e 50Hz somado a uma camada harmônica triangular a 110Hz e 100Hz (garantindo audibilidade física em alto-falantes de notebooks e celulares).
   - Cadência dinâmica:
     - Em `32.0m` (1920px): `55 BPM` (intervalo de `1100 ms`).
     - Em `<= 5.0m` (300px): `150 BPM` (intervalo de `400 ms`).
2. **Camada 2: Drone Metálico Dissonante:**
   - Par de osciladores dente-de-serra desafinados a `80 Hz` e `83 Hz` gerando batimento acústico constante de apreensão.
   - Abertura de filtro passa-baixa (*lowpass*):
     - `32m a 10m` (1920px a 600px): Filtro fechado entre `180 Hz` e `320 Hz`, volume `0.05` a `0.12`.
     - `10m a 2m` (600px a 120px): Filtro abrindo de `320 Hz` a `750 Hz`, volume `0.12` a `0.20`.
     - `< 2m` (< 120px): Corte aberto em `950 Hz`, volume `0.26`.
     - Durante `CHASE`: Corte agressivo estendido entre `850 Hz` e `1200 Hz`, volume `0.20` a `0.28`.

---

## 🧮 5. Fórmulas Matemáticas Oficiais

### 5.1 Atenuação Espacial de Áudio do Gerador Danificado
O volume do áudio de regressão atenua linearmente com corte total em 10 metros:
$$V(d) = \begin{cases} 0.0 & \text{se } d \ge 600\text{px } (10.0\text{m}) \\ 1.0 & \text{se } d \le 90\text{px } (1.5\text{m}) \\ 1.0 - \left(\frac{d - 90}{600 - 90}\right) & \text{se } 90\text{px} < d < 600\text{px} \end{cases}$$

### 5.2 Cadência e Volume do Batimento Cardíaco
Calculado pela interpolação normalizada $t$ baseada na distância Euclidiana $d$:
$$t = \frac{\text{clamp}(d, 300, 1920) - 300}{1920 - 300}$$
$$\text{intervalo}(d) = 400\text{ms} + t \cdot (1100\text{ms} - 400\text{ms})$$
$$\text{volume}(d) = 0.45 - t \cdot (0.45 - 0.08)$$

### 5.3 Tolerância de Chegada em Patrulha (`evaluatePatrolArrival`)
Determina se o Killer chegou com sucesso ao ponto de inspeção:
$$\text{chegou}(d_{\text{target}}, d_{\text{gen}}) = \begin{cases} d_{\text{target}} \le 32\text{px} \lor (d_{\text{gen}} \le 130\text{px} \land d_{\text{target}} \le 75\text{px}) & \text{se o alvo for um gerador} \\ d_{\text{target}} \le 40\text{px} & \text{se for waypoint livre} \end{cases}$$

### 5.4 Look-Ahead Steering (Suavização de Curvas de IA)
Para evitar paradas bruscas e zigue-zague ao dobrar esquinas, quando a distância até o nó atual do caminho $d_{\text{node}} < 36\text{px}$, calcula-se a mistura direcional:
$$\text{blendFactor} = \min\left(1, \max\left(0, \frac{36 - d_{\text{node}}}{36}\right)\right) \times 0.5$$
$$\vec{v}_{\text{final}} = \text{normalize}\left((1 - \text{blendFactor}) \cdot \vec{v}_{\text{nó atual}} + \text{blendFactor} \cdot \vec{v}_{\text{próximo nó}}\right) \times v_{\text{killer}}$$

---

## 🛠️ 6. Motores, Reparo e Skill Checks

- **Tempo Total de Reparo (0% a 100%):** `12 segundos` nominais (ajustável via debug).
- **Frequência Média de Skill Checks:** 1 QTE a cada `3 segundos` em média.
- **Zona Great:** Bônus de progresso imediato (+2%) sem notificação de ruído.
- **Zona Good:** Sucesso de manutenção do reparo contínuo.
- **Falha (Miss):** Regressão imediata de -10% de progresso, explosão do gerador, cancelamento do reparo e alerta acústico de `36.0m` emitido para o assassino.
- **Chute do Assassino:** Adiciona regressão contínua com faíscas estocásticas, cancelável pelo Survivor ao voltar a reparar.
