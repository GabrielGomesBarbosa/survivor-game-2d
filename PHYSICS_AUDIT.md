# Relatório de Auditoria do Sistema de Física e Colisão
**Projeto:** Horror Topdown (DBD 2D Prototype)  
**Data:** 20 de Setembro de 2026  
**Status:** Diagnóstico Completo & Plano de Correção  
**Branch:** `refactor/modular-architecture`  

---

## Sumário Executivo

Esta auditoria técnica foi realizada para investigar e diagnosticar três anomalias críticas no subsistema de física, colisão e controle de entidades do jogo:
1. **Travamento Sistemático em Quinas (Corner Pinning / Lockout)**: Ao colidir com quinas internas ('L') ou vértices convexos de paredes, o Survivor fica completamente imobilizado (WASD não responde nem para recuar/descolar da parede), respondendo exclusivamente à rotação pelo mouse.
2. **Inconsistência de Penetração Visual**: A hitbox circular afunda de 2 a 4+ pixels nos blocos azuis estáticos antes da separação física, gerando sensação de engate/agarramento nas bordas.
3. **Conflito de Contato com o Killer (Tremulação / Congelamento Mútuo)**: Ao colidir frontalmente com o Killer, o Player entra em um ciclo de oscilação em alta frequência (efeito "flicker/piscando" e congelamento), perdendo comandos de fuga e mantendo apenas a mira do mouse.

---

## 1. Resumo da Causa Raiz dos 3 Problemas

### 1.1 Travamento Sistemático em Quinas (Corner Pinning)
* **Causa Raiz 1 (Anulação Incondicional de Velocidade em Limites):** No método `Player.enforceWallBounds` (e de forma análoga em `Killer.enforceWallBounds`), toda vez que a função geométrica pura `clampCircleAgainstNavGrid` detecta qualquer contato (`clamped === true`), é executada a instrução destrutiva:
  ```typescript
  this.sprite.setVelocity(0, 0);
  ```
  Isso anula completamente o vetor de velocidade física do personagem no fim de cada frame (`POST_UPDATE`).
* **Causa Raiz 2 (Ausência de Limiar de Histerese / Epsilon em Círculo vs Tiles):** A verificação em `clampCircleAgainstNavGrid` testa estritamente `distSq < radius * radius`. Devido à imprecisão de ponto flutuante (IEEE 754), uma entidade posicionada exatamente sobre a borda tangencial de contato ($d \approx R$) frequentemente avalia $d^2 = (R - 10^{-14})^2 < R^2$. Como resultado, a condição `clamped = true` é disparada continuamente em todos os frames, forçando `setVelocity(0, 0)` mesmo quando o jogador não está se movendo ou tenta se afastar.
* **Causa Raiz 3 (Loop de Teletransporte Restaurativo):** Em quinas em 'L' ou vértices de quina, múltiplos blocos sólidos adjacentes (ex: ladrilhos $(r, c)$, $(r+1, c)$ e $(r, c+1)$) são avaliados sequencialmente. O empurrão do Bloco A desloca o centro do círculo em direção à área de colisão do Bloco B; o Bloco B empurra o círculo de volta. O algoritmo de 2 iterações não converge para um estado livre, resultando em `clamped = true` permanente e sobrescrevendo a posição do sprite via `this.sprite.setPosition(clampResult.x, clampResult.y)`. Qualquer deslocamento de 2px gerado pelo comando WASD de recuo é revertido no `POST_UPDATE` pelo teletransporte da posição clampada.
* **Causa Raiz 4 (Saturação dos Flags `blocked` do Arcade Physics):** Ao encostar em uma quina de 90°, o Arcade Physics do Phaser sinaliza bloqueio em ambos os eixos simultaneamente (`blocked.right = true` e `blocked.down = true`). A lógica em `Player.postUpdate` avalia:
  ```typescript
  const isDirectlyBlocked = !hasFreeX && !hasFreeY;
  ```
  Quando ambos os eixos estão marcados como bloqueados, mesmo que o jogador pressione uma tecla oposta, a latência de liberação dos flags do Arcade associada ao zeramento contínuo de velocidade trava a máquina de estados de locomoção em `effectiveSpeed = 0` e `animState = 'idle'`.

---

### 1.2 Inconsistência de Penetração Visual (Afundamento em Blocos)
* **Causa Raiz 1 (Integração Discreta de Euler a 60Hz):** O Phaser Arcade Physics utiliza integração numérica discreta por passos fixos (`fixedStep = 60Hz`, $\Delta t \approx 16.66\text{ ms}$). A 140 px/s (caminhada), o personagem desloca $2.33\text{ px/frame}$; a 240 px/s (corrida), desloca $4.00\text{ px/frame}$. Em desacelerações ou picos de quadro (ex: telas a 120Hz/144Hz com interpolação de render), a entidade é desenhada na tela na posição integrada *antes* de sofrer a resolução de colisão do passo físico ou a trava do `POST_UPDATE`.
* **Causa Raiz 2 (Incompatibilidade de `pushable = false` em Corpos Dinâmicos contra Paredes Estáticas):** No método `updateHitbox`, foi adicionada a instrução `body.pushable = false;`. No Phaser 3 Arcade Physics, a propriedade `pushable` é concebida para definir se um corpo dinâmico pode ser empurrado por outro corpo dinâmico. Quando aplicada a um corpo que colide contra um `StaticGroup` (`immovable = true`), o algoritmo interno de separação de círculos (`World.separateCircle`) entra em um ramo de resolução não-reativo, falhando em ejetar o círculo suavemente para fora do AABB da parede estática e permitindo que a geometria afunde até ser travada tardiamente pelo `enforceWallBounds`.
* **Causa Raiz 3 (Desalinhamento entre o Centro do Sprite e o Centro da Hitbox):** A textura do Survivor possui dimensões $106 \times 106\text{ px}$. O colisor circular é instanciado com offset $(106 \times 0.5 - R)$. No entanto, `clampCircleAgainstNavGrid` utiliza diretamente as coordenadas $(this.sprite.x, this.sprite.y)$, sem levar em consideração compensações de escala dinâmica ($1.25\times$) ou eventuais diferenças entre a origem geométrica do GameObject e o centro de massa do `body`.

---

### 1.3 Conflito de Contato com o Killer (Tremulação / Congelamento Mútuo)
* **Causa Raiz 1 (Ping-Pong Oscilatório entre Física e `overlap`):** A colisão entre Player e Killer está configurada como `physics.add.overlap` em [SandboxScene.ts](file:///Users/gabri/Documents/projects/horror-topdown/src/scenes/SandboxScene.ts#L112-L114), em conjunto com a resolução posicional em [gameLogic.ts:resolveSolidBodyCollision](file:///Users/gabri/Documents/projects/horror-topdown/src/utils/gameLogic.ts#L232-L313):
  1. *Frame N (Fase de Update):* O Player move-se em direção ao Killer ($\vec{v} = (0, -140)$). O Arcade Physics integra o deslocamento e gera sobreposição ($\text{dist} < R_k + R_p$).
  2. *Frame N (Fase de Overlap Callback):* O callback dispara `handlePlayerCollision`, que executa `resolveSolidBodyCollision`. Como o Player está em aproximação ativa e o Killer é inamovível, o Player é teletransportado para trás ao longo de $-\hat{n}$ até a distância de contato rígido ($R_k + R_p$), e sua velocidade de aproximação é zerada.
  3. *Frame N+1 (Fase de Update):* O jogador continua segurando 'W'. `handleMovement` reaplica a velocidade total $\vec{v} = (0, -140)$. O corpo avança novamente $2.3\text{ px}$ para dentro do Killer.
  4. *Resultado:* O Player alterna a cada frame entre a posição penetrada e a posição teletransportada para trás. Em monitores de 60Hz/120Hz, essa onda quadrada posicional de $30\text{Hz}$ a $60\text{Hz}$ se manifesta visualmente como uma tremulação violenta ("flicker" ou "piscando").
* **Causa Raiz 2 (Anulação Contínua do Movimento Efetivo):** Como a posição do Player é restaurada para a mesma coordenada em todo ciclo, a diferença posicional medida entre frames subsequentes no `POST_UPDATE` é zero:
  ```typescript
  const frameDist = Math.hypot(dx, dy); // frameDist ≈ 0
  ```
  A cada $50\text{ ms}$, `effectiveSpeed` cai abaixo de $0.2\text{ px/s}$, acionando `effectiveSpeed = 0`. O sistema de animação interrompe a caminhada e congela no frame 0 da pose estática:
  ```typescript
  this.sprite.anims.stop();
  this.sprite.setFrame(0);
  ```
* **Causa Raiz 3 (Falsa Detecção de Colisão em Paredes via `isWalkableTile`):** Em `Killer.ts`, o método `isWalkableTile(candidatePx, candidatePy)` utiliza uma margem estrita de $20\text{ px}$. Quando o contato entre Player e Killer ocorre em um corredor ou próximo a uma parede, `isWalkableTile` recusa a nova posição candidata ($candidatePx, candidatePy$). O código então aborta o recuo do Player, mantendo-o preso em sobreposição física profunda com o corpo do Killer.

---

## 2. Trechos de Código Relevantes

### 2.1 Destruição de Velocidade no Clamping de Parede
**Arquivo:** [src/entities/Player.ts](file:///Users/gabri/Documents/projects/horror-topdown/src/entities/Player.ts#L310-L323)
```typescript
310:   public enforceWallBounds(navGrid: number[][]): void {
311:     if (!this.sprite || !this.sprite.body || navGrid.length === 0) return;
312: 
313:     const radius = (this.settings?.hitboxRadius ?? 53) * (this.settings?.playerScale ?? 1.25);
314:     const clampResult = clampCircleAgainstNavGrid(this.sprite.x, this.sprite.y, radius, navGrid);
315: 
316:     if (clampResult.clamped) {
317:       this.sprite.setPosition(clampResult.x, clampResult.y);
318:       this.sprite.setVelocity(0, 0); // <-- CAUSA DO TRAVAMENTO EM QUINAS: Anula qualquer movimento WASD
319:       (this.sprite.body as Phaser.Physics.Arcade.Body).updateCenter();
320:     }
321:     this.lastSafeX = this.sprite.x;
322:     this.lastSafeY = this.sprite.y;
323:   }
```
*Impacto:* Toda vez que o personagem toca uma quina, `clampResult.clamped` é verdadeiro e a velocidade é zerada para $(0, 0)$.

---

### 2.2 Saturação de Bloqueio em Múltiplos Eixos no `POST_UPDATE`
**Arquivo:** [src/entities/Player.ts](file:///Users/gabri/Documents/projects/horror-topdown/src/entities/Player.ts#L363-L390)
```typescript
363:     const blocked = body
364:       ? {
365:           left: Boolean(body.blocked.left || body.touching.left),
366:           right: Boolean(body.blocked.right || body.touching.right),
367:           up: Boolean(body.blocked.up || body.touching.up),
368:           down: Boolean(body.blocked.down || body.touching.down)
369:         }
370:       : undefined;
371: 
372:     const blockedX = (this.inputDir.x > 0 && Boolean(blocked?.right)) || (this.inputDir.x < 0 && Boolean(blocked?.left));
373:     const blockedY = (this.inputDir.y > 0 && Boolean(blocked?.down)) || (this.inputDir.y < 0 && Boolean(blocked?.up));
374:     const hasFreeX = this.inputDir.x !== 0 && !blockedX;
375:     const hasFreeY = this.inputDir.y !== 0 && !blockedY;
376:     const isDirectlyBlocked = !hasFreeX && !hasFreeY;
...
386:     if (isDirectlyBlocked) {
387:       this.effectiveSpeed = 0;
388:       this.sampleDist = 0;
389:       this.sampleTime = 0;
390:     }
```
*Impacto:* Em vértices ou quinas em 'L', `blocked.right` e `blocked.down` são ativados simultaneamente. Se o jogador pressiona apenas uma tecla ou tenta recuar em diagonal, `isDirectlyBlocked` torna-se `true`, forçando `effectiveSpeed = 0` e congelando a animação e o estado.

---

### 2.3 Ausência de Histerese / Margem de Tolerância no Clamping da Grade
**Arquivo:** [src/utils/gameLogic.ts](file:///Users/gabri/Documents/projects/horror-topdown/src/utils/gameLogic.ts#L391-L420)
```typescript
391:           const closestX = Math.max(boxLeft, Math.min(curX, boxRight));
392:           const closestY = Math.max(boxTop, Math.min(curY, boxBottom));
393: 
394:           const diffX = curX - closestX;
395:           const diffY = curY - closestY;
396:           const distSq = diffX * diffX + diffY * diffY;
397: 
398:           if (distSq < radius * radius) {
399:             clamped = true;
400:             if (distSq > 0.0001) {
401:               const dist = Math.sqrt(distSq);
402:               const push = radius - dist;
403:               curX += (diffX / dist) * push;
404:               curY += (diffY / dist) * push;
405:             } else { ... }
406:           }
```
*Impacto:* A comparação `distSq < radius * radius` sem margem epsilon faz com que qualquer corpo posicionado na tangente exata continue registrando `clamped = true` em todos os quadros subsequentes.

---

### 2.4 Resolução de Contato Player vs Killer e Anulação Vetorial
**Arquivo:** [src/utils/gameLogic.ts](file:///Users/gabri/Documents/projects/horror-topdown/src/utils/gameLogic.ts#L273-L302)
```typescript
273:   // Regra Fundamental de Imobilidade Absoluta:
...
287:   } else {
288:     // Player se movendo (ou repouso mútuo/taps): Killer NUNCA se move (delta = 0).
289:     // O Player recua até minDistance ao longo de -n
290:     killerX = killer.x;
291:     killerY = killer.y;
292: 
293:     const candidatePx = player.x - nx * overlap;
294:     const candidatePy = player.y - ny * overlap;
295:     if (!isWalkable || isWalkable(candidatePx, candidatePy)) {
296:       playerX = candidatePx;
297:       playerY = candidatePy;
298:     }
299:   }
300: 
301:   const { killerVel: resKVel, playerVel: resPVel } = resolveAntiPushVelocity(kVel, pVel, dx, dy);
```
**Arquivo:** [src/entities/Killer.ts](file:///Users/gabri/Documents/projects/horror-topdown/src/entities/Killer.ts#L240-L252)
```typescript
240:     if (resolution.hasCollision) {
241:       this.sprite.setPosition(resolution.killerPos.x, resolution.killerPos.y);
242:       player.sprite.setPosition(resolution.playerPos.x, resolution.playerPos.y);
243: 
244:       this.enforceWallBounds(this.navGrid);
245:       player.enforceWallBounds(this.navGrid); // <-- Aciona enforceWallBounds do Player e zera velocidade
246: 
247:       killerBody.setVelocity(resolution.killerVel.x, resolution.killerVel.y);
248:       playerBody.setVelocity(resolution.playerVel.x, resolution.playerVel.y);
249: 
250:       killerBody.updateCenter();
251:       playerBody.updateCenter();
252:     }
```
*Impacto:* A combinação de teletransporte instantâneo via `setPosition`, seguido pelo `player.enforceWallBounds` e anulação da velocidade, cria o ciclo de oscilação e remove o controle de movimento do jogador ao colidir com o Killer.

---

## 3. Análise dos Vetores de Movimento

### 3.1 Por que o comando de recuo do jogador é matematicamente anulado?

Considere o Player com centro posicionado em $\mathbf{P}_0 = (x_0, y_0)$ e raio efetivo $R = 66.25\text{ px}$.
Suponha uma quina ortogonal formada pelo vértice $\mathbf{V} = (x_v, y_v)$ de um bloco de parede.

```
                    Parede (Sólido)
                 +-------------------+
                 |                   |
                 |      Bloco        |
                 |     de Parede     |
                 +-------------------+ Vértice V (xv, yv)
                       \
                        \  Vetor normal d = P - V
                         \
                          + P0 (Centro do Player)
```

1. **Estado de Contato Inicial:**
   O vetor de separação relativo é:
   $$\mathbf{d} = \mathbf{P}_0 - \mathbf{V}, \quad d = \|\mathbf{d}\| \approx R$$
   A normal unitária voltada do vértice para o jogador é:
   $$\hat{\mathbf{n}} = \frac{\mathbf{d}}{d}$$

2. **Comando de Recuo (Input WASD):**
   O jogador deseja afastar-se da quina. O teclado fornece um vetor de intenção:
   $$\mathbf{u} = (u_x, u_y), \quad \|\mathbf{u}\| = 1$$
   Tal que o produto escalar com a normal aponta para fora do obstáculo:
   $$\mathbf{u} \cdot \hat{\mathbf{n}} > 0 \quad (\text{intenção de recuo clara})$$
   No frame seguinte ($t + \Delta t$), o método `handleMovement` define a velocidade do corpo:
   $$\mathbf{v}_{\text{intent}} = \mathbf{u} \cdot v_{\text{walk}}$$
   O integrador do Arcade Physics atualiza a posição provisória:
   $$\mathbf{P}_{\text{int}} = \mathbf{P}_0 + \mathbf{v}_{\text{intent}} \cdot \Delta t$$
   Com $\Delta t \approx 0.0166\text{ s}$ e $v = 140\text{ px/s}$, o deslocamento esperado é:
   $$\Delta \mathbf{P} \approx 2.33 \cdot \mathbf{u}\text{ px}$$

3. **O Bloqueio Matemático pelo Clamping:**
   Ao final do frame, o evento `POST_UPDATE` executa obrigatoriamente `enforceWallBounds(navGrid)`.
   A função `clampCircleAgainstNavGrid` reexamina todos os ladrilhos $64 \times 64$ em volta de $\mathbf{P}_{\text{int}}$.
   Se o jogador estava em uma quina em 'L', existem pelo menos **dois ladrilhos** ortogonais $T_1$ e $T_2$.
   Ao recuar na direção de $\mathbf{u}$, o círculo pode afastar-se de $T_1$, mas sua trajetória lateral ainda mantém sobreposição microscópica com $T_2$:
   $$\|\mathbf{P}_{\text{int}} - \mathbf{C}_{T_2}\| < R$$
   O algoritmo executa a ejeção corretiva:
   $$\mathbf{P}_{\text{final}} = \mathbf{P}_{\text{int}} + \Delta \mathbf{P}_{\text{clamp}}$$
   E ativa a flag:
   $$\text{clamped} = \text{true}$$

4. **A Anulação Fatal:**
   Ao registrar $\text{clamped} = \text{true}$, o código executa:
   $$\mathbf{v} = \mathbf{0}$$
   $$\mathbf{P}_{\text{sprite}} = \mathbf{P}_{\text{clamp}}$$
   No frame seguinte, $\mathbf{v}$ parte de zero. Pior: como o Arcade Physics detectou colisão contra o `StaticGroup`, os campos internos:
   $$\text{body.blocked.left} / \text{right} / \text{up} / \text{down}$$
   Permanecem populados. A verificação:
   $$\text{hasFreeX} = (u_x \neq 0) \land \neg \text{blockedX}$$
   $$\text{hasFreeY} = (u_y \neq 0) \land \neg \text{blockedY}$$
   Avalia para $\text{false}$ em ambos os eixos se o jogador pressionar uma tecla composta ou se os flags da quina ainda não tiverem sido limpos.
   Logo:
   $$\mathbf{v}_{\text{efetiva}} \equiv \mathbf{0}$$
   O vetor de recuo do jogador é matematicamente anulado a cada frame pela combinação do teletransporte de volta à quina e pelo zeramento forçado de velocidade.

---

## 4. Análise de Deslizamento (Wall Slide) ao Longo de Paredes e Cantos de 90 Graus

### 4.1 Decomposição Ideal de Deslizamento (Mecânica Esperada)
Em um motor físico 2D de alta fidelidade, o contato com uma parede sólida rígida com vetor normal unitário $\hat{\mathbf{n}}$ deve apenas anular a penetração perpendicular, preservando a componente tangencial do movimento:

$$\mathbf{v} = \mathbf{v}_{\parallel} + \mathbf{v}_{\perp}$$
$$\mathbf{v}_{\perp} = (\mathbf{v} \cdot \hat{\mathbf{n}}) \hat{\mathbf{n}}$$
$$\mathbf{v}_{\parallel} = \mathbf{v} - \mathbf{v}_{\perp} = \mathbf{v} - (\mathbf{v} \cdot \hat{\mathbf{n}}) \hat{\mathbf{n}}$$

* Se o jogador se desloca em direção à parede ($\mathbf{v} \cdot \hat{\mathbf{n}} < 0$):
  $$\mathbf{v}_{\text{slide}} = \mathbf{v} - (\mathbf{v} \cdot \hat{\mathbf{n}}) \hat{\mathbf{n}}$$
* A entidade deve deslizar suavemente ao longo do vetor tangente $\hat{\mathbf{t}} \perp \hat{\mathbf{n}}$ com módulo $|\mathbf{v}_{\parallel}|$.

```
                            Parede
      ===================================================> Parede (Eixo X)
             ^
             | n (Normal)
             |
             |       / v (Vetor de Entrada WASD)
             |      /
             |     /
             |    /
             +---/------------------------> v_slide (Componente Tangente Preservada)
```

### 4.2 O Que Acontece no Código Atual?
1. **Em Paredes Retas:**
   Quando o Player colide contra uma parede horizontal e segura `W + D`, o Arcade Physics zera a componente $Y$ e mantém a componente $X$. O jogador consegue deslizar horizontalmente.
2. **Ao Atingir um Canto / Vértice de 90 Graus:**
   No instante em que a hitbox circular alcança a quina:
   * A parede frontal gera $\hat{\mathbf{n}}_1 = (0, 1)$ (bloqueia $Y$).
   * A parede lateral gera $\hat{\mathbf{n}}_2 = (-1, 0)$ (bloqueia $X$).
   * O Arcade Physics aplica separação nos dois eixos, zerando $v_x$ e $v_y$.
   * Imediatamente a seguir, `enforceWallBounds` roda no `POST_UPDATE`. Como o círculo toca a quina, `clampCircleAgainstNavGrid` detecta penetração diagonal contra a quina ($distSq < R^2$), aplica correção posicional e executa:
     ```typescript
     this.sprite.setVelocity(0, 0);
     ```
   * Isso destrói qualquer componente residual de deslizamento. O jogador perde a inércia e não consegue contornar a quina suavemente. Para sair, precisaria de uma precisão angular impossível de teclado numérico digital, resultando na sensação de que o personagem "enganchou" ou foi "sugado" para dentro da quina.

---

## 5. Proposta de Correção (Plano de Ação Detalhado)

Para implementar movimentação fluida, deslizamento natural nas paredes e colisões sólidas sem tremulação ou travamentos, propõe-se um plano de refatoração estruturado em 4 fases:

```
+-----------------------------------------------------------------------------------+
|                           ARQUITETURA DE FÍSICA PROPOSTA                          |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  [ Input WASD ] ---> [ Projeção Tangencial na Normal ] ---> [ SetVelocity ]       |
|                                                                     |             |
|                                                                     v             |
|  [ Arcade Physics Step ] <--- [ body.pushable = true ] <--- [ Fixed Step 60Hz ]   |
|            |                                                                      |
|            v                                                                      |
|  [ Colisão Player x Killer ] ---> [ Separação Cinemática Contínua sem Overlap ]  |
|            |                                                                      |
|            v                                                                      |
|  [ POST_UPDATE Guard ] ------> [ Clamping com Epsilon de Histerese (0.5px) ]      |
|                                [ SEM this.sprite.setVelocity(0, 0) ]              |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

### Fase 1: Correção Imediata do Clamping de Parede e Eliminação do Travamento em Quinas
1. **Eliminar `setVelocity(0, 0)` do Clamping Posicional:**
   Em `Player.ts` e `Killer.ts`, remover a chamada destrutiva `this.sprite.setVelocity(0, 0)` de dentro de `enforceWallBounds`. O guard anti-tunelamento deve ser exclusivamente **geométrico-posicional** (ajusta apenas as coordenadas $(x, y)$ caso haja penetração na grade).
2. **Introduzir Margem de Tolerância / Epsilon de Histerese:**
   Em `gameLogic.ts:clampCircleAgainstNavGrid`, adicionar uma tolerância $\epsilon = 0.5\text{ px}$:
   ```typescript
   const effectiveRadius = radius - 0.5;
   if (distSq < effectiveRadius * effectiveRadius) {
     // Apenas corrige se houver penetração real, nunca na tangência
   }
   ```
   Isso garante que um corpo em repouso encostado na parede não reative o clamping indefinidamente.
3. **Resolução de Quinas com Normal Combinada (Voronoi Corner Smoothing):**
   No algoritmo do grid, quando múltiplos ladrilhos vizinhos colidirem simultaneamente, calcular a resultante vetorial média dos empurrões $\sum \vec{p}_i$ antes de aplicar à posição do círculo, evitando o ping-pong entre ladrilhos perpendiculares em 'L'.

### Fase 2: Restauração do Deslizamento Natural (Wall Slide)
1. **Desacoplamento dos Flags `blocked` do Arcade Physics na Avaliação de Animação:**
   Substituir a lógica booleana restritiva `isDirectlyBlocked = !hasFreeX && !hasFreeY` por uma métrica vetorial baseada no produto escalar entre a velocidade real de deslocamento no mundo e o vetor de input:
   * Se $\mathbf{v}_{\text{real}} \cdot \mathbf{u}_{\text{input}} > 5\text{ px/s}$, o personagem está deslizando pela parede: manter a animação `walk` ou `run` ativa.
   * Apenas entrar em `idle` se a velocidade real for inferior ao threshold ($< 5\text{ px/s}$) **e** a intenção de movimento for frontal contra a normal da parede ($\mathbf{u} \cdot \hat{\mathbf{n}} < -0.8$).
2. **Projeção Tangencial Contínua em Colisão:**
   Ao colidir com paredes, projetar o vetor de velocidade ao longo da tangente da superfície, permitindo contornar quinas de 90° suavemente enquanto o jogador mantém teclas direcionais pressionadas.

### Fase 3: Resolução Estável da Colisão Player vs Killer (Anti-Tremulação)
1. **Migração de `overlap` com Teletransporte para `collider` com Separação Cinemática:**
   Em vez de permitir a penetração no passo de física e tentar teletransportar os corpos de volta no callback `overlap`, utilizar colisão nativa de círculos ou um resolvedor cinemático não-elástico que atue no `preUpdate` / integrador:
   * O Killer permanece inamovível perante o Player (`immovable = true`).
   * A velocidade do Player relativa ao Killer ao longo da normal de contato é zerada, mas sua componente tangencial é integralmente preservada, permitindo que o Player contorne o corpo do Killer sem vibrar ou perder o controle.
2. **Ajuste do `isWalkableTile`:**
   Reduzir a margem excessiva de $20\text{ px}$ em `isWalkableTile` para um teste de ponto central ou raio equivalente ao corpo, evitando que o resolvedor de colisão desista de ejetar o Player quando este estiver em corredores próximos a paredes.

### Fase 4: Eliminação da Penetração Visual
1. **Remoção de `body.pushable = false` nos Corpos Dinâmicos:**
   Remover `body.pushable = false` de `Player.updateHitbox` e `Killer.updateHitbox`. Para garantir que o Killer não seja empurrado pelo Player, utilizar `body.immovable = true` no Killer e resolver o bloqueio mútuo via matriz de velocidades.
2. **Sincronização de Centros e Offsets:**
   Padronizar o raio da hitbox e os offsets em uma única fonte de verdade compartilhada entre o Arcade Physics e o `clampCircleAgainstNavGrid`, garantindo que a borda do colisor visual coincida com o limite do colisor físico em todas as escalas ($1.25\times$).

---

## 6. Conclusão e Próximos Passos
O diagnóstico confirmou que a física da aplicação não possui falhas estruturais insolúveis, mas sim um conflito entre duas camadas de contenção que disputam a autoridade do movimento: o resolvedor de física do Phaser e as travas corretivas manuais (`enforceWallBounds` e `handlePlayerCollision`). Ao eliminar o zeramento destrutivo de velocidade e introduzir margens de histerese e projeção tangencial, o jogo atingirá movimentação fluida e controles consistentes em conformidade com o padrão exigido.
