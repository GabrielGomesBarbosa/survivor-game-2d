# Relatório de Diagnóstico e Auditoria do Gerador
**Projeto:** Horror Topdown (DBD 2D Prototype)  
**Data:** 20 de Setembro de 2026  
**Status:** Diagnóstico Completo  
**Branch:** `refactor/modular-architecture`  
**Alvo:** Entidade de Gerador, Hitbox Física, Interação [E] e Resolução de Malha (NavGrid)

---

## Sumário Executivo

Esta auditoria investiga as anomalias relatadas na interação do Survivor com os Geradores:
1. **Bloqueio por barreira invisível:** O Survivor é impedido de encostar na carcaça do gerador, parando a uma distância considerável do sprite.
2. **Falha de ativação da tecla [E] e ausência do prompt:** Mesmo posicionado visualmente dentro da demarcação circular amarela no piso, pressionar [E] não inicia o reparo nem exibe o texto de interface.
3. **Desproporção da hitbox física sólida (retângulo azul de debug):** O colisor estático atual mede $76 \times 88\text{ px}$ (formato quase quadrado de aspecto 1:1.15), enquanto o sprite real da máquina é um retângulo vertical esguio com proporção de 1:1.6, resultando em laterais excessivamente largas e topo/base desprotegidos.

---

## 1. Diagnóstico da Hitbox Física vs Sprite

### 1.1 Como estão calculadas as dimensões e offsets atuais do colisor sólido?
No arquivo [src/entities/Generator.ts](file:///Users/gabri/Documents/projects/horror-topdown/src/entities/Generator.ts#L60-L67), a colisão física estática é instanciada diretamente como um `Phaser.GameObjects.Rectangle`:

```typescript
60:    // 2. Colisor físico estático sólido para Player e Killer (76x88px)
61:    this.solidBlock = scene.add.rectangle(def.x, def.y, 76, 88, 0x000000, 0);
62:    obstaclesGroup.add(this.solidBlock);
63:    const solidBody = this.solidBlock.body as Phaser.Physics.Arcade.StaticBody;
64:    if (solidBody) {
65:      solidBody.updateFromGameObject();
66:    }
```

* **Dimensões do Colisor:**
  * $\text{Width} = 76\text{ px}$
  * $\text{Height} = 88\text{ px}$
* **Offsets:**
  * Por ser um `Phaser.GameObjects.Rectangle` com origem padrão $(0.5, 0.5)$, o método `updateFromGameObject()` do `StaticBody` centraliza o corpo estático em $(def.x, def.y)$:
  * $\text{left} = def.x - 38\text{ px}$, $\text{right} = def.x + 38\text{ px}$
  * $\text{top} = def.y - 44\text{ px}$, $\text{bottom} = def.y + 44\text{ px}$
  * Não há offsets manuais aplicados ($\text{offsetX} = 0$, $\text{offsetY} = 0$).

### 1.2 Dimensões Reais do Sprite do Gerador
No arquivo [src/assets/generator.json](file:///Users/gabri/Documents/projects/horror-topdown/src/assets/generator.json#L6-L7):
* $\text{frameWidth} = 960\text{ px}$
* $\text{frameHeight} = 1536\text{ px}$
* Razão de aspecto da imagem: $\frac{1536}{960} = \mathbf{1.60}$ (retângulo vertical pronunciado).

Em [src/entities/Generator.ts](file:///Users/gabri/Documents/projects/horror-topdown/src/entities/Generator.ts#L75-L77):
```typescript
75:    this.sprite = scene.add.sprite(0, -4, 'generator', 0);
76:    this.sprite.setScale(0.095);
77:    this.sprite.setOrigin(0.5, 0.5);
```
Com o multiplicador de escala $\text{scale} = 0.095$:
* $\text{Largura Total Renderizada} = 960 \times 0.095 = \mathbf{91.2\text{ px}}$
* $\text{Altura Total Renderizada} = 1536 \times 0.095 = \mathbf{145.92\text{ px}}$
* Posição vertical do centro: $def.y - 4\text{ px}$.

### 1.3 Por que o colisor azul está em formato quase quadrado?
1. **Discrepância Geométrica:** A caixa azul tem $76 \times 88\text{ px}$ (relação de aspecto de $1.15$), enquanto a máquina real tem $91.2 \times 145.92\text{ px}$ (relação de aspecto de $1.60$).
2. **Largura Excessiva nas Laterais:** A silhueta da carcaça mecânica do motor ocupa apenas a coluna central do frame (~50% da largura do quadro). Com $76\text{ px}$ de largura, a caixa azul projeta uma barreira sólida de quase $15\text{ px}$ a $20\text{ px}$ além da carcaça de metal desenhada, impedindo o toque lateral.
3. **Corte no Topo e na Base:** Com apenas $88\text{ px}$ de altura contra os $146\text{ px}$ do sprite, o colisor azul deixa quase $30\text{ px}$ de carcaça no topo e outros $28\text{ px}$ na base desprovidos de colisão física com relação ao centro.
4. **Formato Ideal:** A carcaça requer um retângulo vertical esguio com dimensões em torno de **$48\text{ px}$ a $52\text{ px}$ de largura** e **$108\text{ px}$ a $114\text{ px}$ de altura**, alinhado ao corpo do motor.

---

## 2. Causa da Falha de Ativação da Tecla [E]

### 2.1 Como é validada a presença do Survivor para acionar o reparo?
No arquivo [src/scenes/SandboxScene.ts](file:///Users/gabri/Documents/projects/horror-topdown/src/scenes/SandboxScene.ts#L153-L171):

```typescript
153:    let closestGen: Generator | null = null;
154:    let closestDist = Infinity;
155:    for (const gen of this.generators) {
156:      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, gen.x, gen.y);
157:      if (dist <= gen.interactionRadius && dist < closestDist) {
158:        closestDist = dist;
159:        closestGen = gen;
160:      }
161:    }
162:    this.activeNearbyGen = closestGen;
163:
164:    if (!closestGen || closestGen.isCompleted) {
165:      if (this.isRepairing) this.stopRepairing();
166:      this.repairPrompt.hide();
167:      return;
168:    }
```

* O sistema **NÃO utiliza colisão ou overlap do Arcade Physics** para a detecção de proximidade.
* A validação depende exclusivamente de:
  $$\text{dist}(\mathbf{P}_{\text{player}}, \mathbf{P}_{\text{gen}}) \le gen.interactionRadius$$
* Em [Generator.ts:29](file:///Users/gabri/Documents/projects/horror-topdown/src/entities/Generator.ts#L29), o raio de interação é configurado como:
  ```typescript
  public interactionRadius = 95; // 95 pixels
  ```

### 2.2 Por que a interação [E] não responde mesmo dentro do círculo amarelo?
O problema ocorre pela **impossibilidade física de satisfazer a condição $\text{dist} \le 95\text{ px}$**, decorrente da superposição de barreiras físicas e da geometria de contato:

#### A. A Ilusão Visual da Zona Amarela
* A demarcação desenhada no chão possui raio de $95\text{ px}$:
  ```typescript
  this.floorZone = scene.add.circle(def.x, def.y, 95);
  ```
* O sprite do Survivor possui uma extensão gráfica de ~30px a partir do seu centro. Quando o jogador avança contra o gerador, os pés/cabeça do boneco entram no círculo amarelo. Visualmente, o jogador parece estar dentro da zona.
* No entanto, a fórmula testa as coordenadas pontuais centrais $(player.x, player.y)$ contra $(gen.x, gen.y)$.

#### B. A Barreira Inultrapassável
1. **Pela grade `navGrid` (Causa Primária):** Como detalhado na Seção 3 abaixo, a grade de navegação cria uma caixa sólida de $128 \times 128\text{ px}$ em volta do gerador. O corpo circular do Player ($R = 66.25\text{ px}$) é barrado em:
   $$d_{\text{min, navGrid}} = 64\text{ px} + 66.25\text{ px} = \mathbf{130.25\text{ px}}$$
   Como $130.25\text{ px} > 95\text{ px}$, o centro do Survivor é barrado $35\text{ px}$ antes de alcançar o raio de interação!
2. **Pelo próprio colisor sólido (`solidBlock`):** Mesmo ignorando a `navGrid`, o colisor sólido mede $76\text{ px} \times 88\text{ px}$.
   * Ao se aproximar pelo **Topo** ou pela **Base** ($Y$): a borda do colisor fica a $44\text{ px}$ do centro.
   * Somando o raio do colisor do Player ($66.25\text{ px}$):
     $$d_{\text{min, Y}} = 44\text{ px} + 66.25\text{ px} = \mathbf{110.25\text{ px}}$$
   * Como $110.25\text{ px} > 95\text{ px}$, um jogador encostado no topo ou na base do gerador **nunca consegue atingir $95\text{ px}$**!
   * Ao se aproximar pelas **Laterais** ($X$):
     $$d_{\text{min, X}} = 38\text{ px} + 66.25\text{ px} = \mathbf{104.25\text{ px}}$$
   * Novamente, $104.25\text{ px} > 95\text{ px}$!

**Conclusão Matemática:**
Em nenhum ponto do mapa em volta da máquina o centro do Survivor consegue atingir uma distância euclidiana menor ou igual a $95\text{ px}$. Portanto, `closestGen` é perpetuamente avaliado como `null`, o método `repairPrompt.hide()` é acionado a cada quadro e o comando da tecla [E] é descartado na linha 164.

---

## 3. Interação com a Grade de Navegação (NavGrid)

### 3.1 Os geradores estão inserindo blocos estáticos no NavGrid?
**SIM.** No arquivo [src/map/MapBuilder.ts](file:///Users/gabri/Documents/projects/horror-topdown/src/map/MapBuilder.ts#L103-L165):

```typescript
103:    for (let r = 14; r <= 15; r++) {
104:      for (let c = 4; c <= 5; c++) {
105:        grid[r][c] = 'G'; // Gerador B (Ala Oeste)
106:      }
107:    }
...
121:    for (let r = 14; r <= 15; r++) {
122:      for (let c = 34; c <= 35; c++) {
123:        grid[r][c] = 'G'; // Gerador A (Ala Leste)
124:      }
125:    }
...
160:    for (let r = 25; r <= 26; r++) {
161:      for (let c = 19; c <= 20; c++) {
162:        grid[r][c] = 'G'; // Gerador C (Ala Sul)
163:      }
164:    }
```

E na inicialização da matriz `navGrid` ([MapBuilder.ts:210-216](file:///Users/gabri/Documents/projects/horror-topdown/src/map/MapBuilder.ts#L210-L216)):
```typescript
210:    const navGrid: number[][] = [];
211:    for (let r = 0; r < ROWS; r++) {
212:      navGrid[r] = new Array(COLS);
213:      for (let c = 0; c < COLS; c++) {
214:        navGrid[r][c] = (grid[r][c] === '#' || grid[r][c] === 'G') ? 1 : 0;
215:      }
216:    }
```

### 3.2 O Conflito de Camadas de Colisão
Cada ladrilho na malha mede $64 \times 64\text{ px}$ (`TILE_SIZE = 64`).
* Um bloco de $2 \times 2$ ladrilhos preenchidos com `'G'` ocupa:
  * $\text{Largura} = 2 \times 64 = \mathbf{128\text{ px}}$
  * $\text{Altura} = 2 \times 64 = \mathbf{128\text{ px}}$
  * $\text{Área Sólida} = 16.384\text{ px}^2$
* Em contrapartida, o colisor de física Arcade (`solidBlock`) na entidade `Generator` mede:
  * $76 \times 88\text{ px} = \mathbf{6.688\text{ px}^2}$ (quase 2.5 vezes menor que o bloco no grid).

Como a função pós-física anti-tunelamento `Player.enforceWallBounds(navGrid)` aplica `clampCircleAgainstNavGrid` contra **todas as células com valor 1 no `navGrid`**, o Player colide com uma **caixa invisível de $128 \times 128\text{ px}$**.

```
                           Grade NavGrid (128 x 128 px) - Bloqueio Invisivel
                    +-----------------------------------------------+
                    |                                               |
                    |         Colisor Arcade (76 x 88 px)           |
                    |           +-----------------------+           |
                    |           |  Carcaça do Motor     |           |
                    |           |  (~50 x 112 px)       |           |
                    |           |                       |           |
                    |           +-----------------------+           |
                    |                                               |
                    +-----------------------------------------------+
                    <------------------- 128 px -------------------->
```

O jogador bate nessa parede invisível da `navGrid` $26\text{ px}$ antes de alcançar o colisor azul e $39\text{ px}$ antes de alcançar o sprite da máquina.

---

## 4. Proposta de Correção Segura

Para sanar os três problemas simultaneamente, sem regressões de navegação para a IA ou para a física do Survivor, recomenda-se uma intervenção em três etapas:

### 4.1 Separação entre Malha de Paredes (NavGrid) e Obstáculos Pontuais
**Arquivo:** [src/map/MapBuilder.ts](file:///Users/gabri/Documents/projects/horror-topdown/src/map/MapBuilder.ts#L214)
* O `navGrid` utilizado pelo `Player.enforceWallBounds` e `clampCircleAgainstNavGrid` deve conter **apenas paredes arquitetônicas estáticas (`'#'`)**, delegando a colisão de geradores para o grupo de obstáculos do Arcade Physics (`mapData.obstacles`):
  ```typescript
  // Apenas paredes '#' geram bloqueio na grade de clamping estrito
  navGrid[r][c] = (grid[r][c] === '#') ? 1 : 0;
  ```
  *(Nota: Para a IA do Killer no EasyStar, pode-se manter uma grade com aceitação exclusiva de tiles livres ou registrar os geradores com peso de custo alto, evitando que a IA atravesse o ponto central da máquina sem criar um muro invisível de 128px para o Player).*

### 4.2 Calibração da Hitbox Física Sólida (Retângulo Vertical Estreito)
**Arquivo:** [src/entities/Generator.ts](file:///Users/gabri/Documents/projects/horror-topdown/src/entities/Generator.ts#L61)
* Redimensionar o colisor estático sólido (`solidBlock`) para cobrir fielmente a silhueta vertical do motor:
  * $\text{Largura} = \mathbf{50\text{ px}}$ (reduzindo a sobra lateral de 76px para 50px).
  * $\text{Altura} = \mathbf{112\text{ px}}$ (aumentando a proteção vertical de 88px para 112px, cobrindo o corpo do gerador).
  * Alinhamento vertical: $y = def.y - 4$ (coincidindo com o centro do sprite `this.sprite = scene.add.sprite(0, -4, ...)`).
  ```typescript
  // Colisor físico retangular vertical acompanhando a carcaça real (50x112px)
  this.solidBlock = scene.add.rectangle(def.x, def.y - 4, 50, 112, 0x000000, 0);
  ```

### 4.3 Calibração do Raio e Validação de Proximidade para a Tecla [E]
**Arquivo:** [src/entities/Generator.ts](file:///Users/gabri/Documents/projects/horror-topdown/src/entities/Generator.ts#L29) e [src/scenes/SandboxScene.ts](file:///Users/gabri/Documents/projects/horror-topdown/src/scenes/SandboxScene.ts#L156)
* Com uma hitbox de $50 \times 112\text{ px}$ e raio do jogador de $66\text{ px}$, a distância máxima de aproximação pelo topo/base é $56\text{ px} + 66\text{ px} = 122\text{ px}$.
* Para garantir que o jogador consiga reparar o gerador por qualquer um dos 4 lados (Norte, Sul, Leste e Oeste) quando encostado no colisor:
  * **Opção Recomendada (Aumento Proporcional do Raio):** Ajustar `interactionRadius` para **$130\text{ px}$**:
    ```typescript
    public interactionRadius = 130;
    ```
    Isso assegura que, ao encostar na carcaça metálica (distâncias entre $91\text{px}$ nas laterais e $122\text{px}$ no topo/base), a condição $\text{dist} \le 130$ seja satisfeita imediatamente com margem confortável de $\sim 8\text{ px}$, ativando o prompt [E] em 360°.
  * A demarcação gráfica do piso (`this.floorZone`) passará a desenhar o anel amarelo com raio $130\text{ px}$, tornando a indicação visual 100% sincrônica com a área de resposta do teclado.

---

## 5. Tabela Comparativa de Parâmetros

| Parâmetro | Configuração Atual (Com Falha) | Configuração Proposta (Corrigida) | Racional Técnico |
| :--- | :--- | :--- | :--- |
| **Bloqueio no `navGrid`** | $2 \times 2$ tiles ($128 \times 128\text{ px}$) | Apenas paredes arquitetônicas (`#`) | Remove a parede invisível de 128px que barrava o Survivor |
| **Largura do Colisor Azul** | $76\text{ px}$ | $\mathbf{50\text{ px}}$ | Elimina as sobras laterais que impediam toque no motor |
| **Altura do Colisor Azul** | $88\text{ px}$ | $\mathbf{112\text{ px}}$ | Cobre a carcaça vertical real de 146px sem cortar topo/base |
| **Offset Vertical do Colisor**| $Y = def.y$ | $Y = def.y - 4$ | Alinha concêntrico com `sprite(0, -4)` |
| **Raio de Interação [E]** | $95\text{ px}$ | $\mathbf{130\text{ px}}$ | Permite acionamento em todos os 4 lados (topo $122\text{px} < 130\text{px}$) |
| **Círculo Amarelo no Piso** | Raio $95\text{ px}$ | Raio $\mathbf{130\text{ px}}$ | Garante que entrar no círculo amarelo ative o prompt [E] |
