# Diretrizes de Governança de Engenharia para Agentes de IA

Este documento define as regras operacionais obrigatórias e invioláveis para qualquer Agente de IA (Antigravity, Cursor, Copilot, etc.) atuando neste repositório.

---

## 🚨 Regras Invioláveis de Operação

### Regra 1: Bloqueio Absoluto da Branch `main`
> **Antes de iniciar qualquer tarefa, verifique a branch atual (`git status`). Se estiver na `main`, crie e alterne para a branch apropriada (`feature/*`, `fix/*`, `refactor/*`, `docs/*`, `test/*`) antes de tocar em qualquer arquivo de código ou configuração.**

- É terminantemente proibido realizar alterações ou commits diretamente na branch `main`.
- Toda e qualquer implementação, bugfix ou refatoração deve nascer em uma branch isolada e ser mesclada exclusivamente através de Pull Request (PR).

### Regra 2: Proibição de Push Direto na `main`
> **Nunca execute `git push origin main` nem comite diretamente na branch `main`.**

- Commits e pushes devem ser direcionados apenas à branch de trabalho correspondente.
- A mesclagem para `main` é realizada apenas após aprovação e validação completa do pipeline de CI.

### Regra 3: Regra Mandatória de Documentação Viva (Docs Synchronized)
> **Toda PR que altere lógica de jogo, constantes de balanceamento ou adicione novas mecânicas DEVE obrigatoriamente atualizar os arquivos na pasta `docs/` (`docs/GAME_DESIGN_SPEC.md` e `docs/FEATURE_MATRIX.md`) no mesmo commit.**

- O código e a documentação técnica devem sempre permanecer sincronizados (Single Source of Truth).
- Se uma constante de velocidade, raio de percepção, fórmula de áudio ou regra de combate for ajustada, a especificação correspondente em `docs/` deve refletir o valor nominal exato.

### Regra 4: Quality Gate Pré-Finalização Obrigatório
> **Sempre execute e valide `npm test` e `npm run build` antes de finalizar qualquer branch e submeter o PR.**

- **Critério 1:** `npm test` com 100% dos testes unitários passando. Nenhuma falha é tolerada.
- **Critério 2:** `npm run build` (`tsc && vite build`) compilando com código de saída 0, sem erros de tipagem TypeScript nem warnings impeditivos.
- Se algum teste falhar ou o build quebrar, investigue e corrija a causa raiz imediatamente antes de avançar.

---

## 🌿 Padrão de Nomenclatura de Branches

Toda branch criada deve seguir o padrão semântico abaixo, utilizando letras minúsculas separadas por hífen (*kebab-case*):

| Prefixo | Finalidade | Exemplo |
| :--- | :--- | :--- |
| `feature/` | Novas mecânicas, entidades, sistemas de áudio, HUD ou regras de gameplay | `feature/killer-lunge-attack`, `feature/spatial-generator-audio` |
| `fix/` | Correções de bugs, colisões, travamentos, falhas de áudio ou IA | `fix/killer-wall-stuck`, `fix/audio-context-autoplay` |
| `refactor/` | Reestruturações de código, otimizações sem mudança de comportamento | `refactor/hud-dom-migration`, `refactor/easystar-pathfinding` |
| `docs/` | Documentação viva, governança, especificações de design e matrizes | `docs/living-documentation`, `docs/game-design-spec` |
| `test/` | Criação ou refatoração de suítes de testes unitários ou mockings | `test/spatial-audio-coverage`, `test/killer-ai-scenarios` |

---

## 📝 Conventional Commits

Todo commit deve seguir rigorosamente a especificação [Conventional Commits](https://www.conventionalcommits.org/):

```
<tipo>(<escopo>): <descrição em modo imperativo e conciso>
```

### Tipos Permitidos:
- `feat`: Nova funcionalidade ou mecânica.
- `fix`: Correção de bug.
- `refactor`: Refatoração interna de código.
- `docs`: Alterações apenas em documentação técnica ou governança.
- `test`: Adição ou correção de testes unitários.
- `perf`: Mudanças voltadas à melhoria de desempenho.
- `chore`: Atualizações de ferramentas, dependências ou scripts de build.
- `style`: Formatação, pontuação ou espaçamento que não afeta a lógica.

### Exemplos Válidos:
- `feat(audio): add spatial distance roll-off to regressing generator`
- `fix(killer): avoid collision corner stuck during patrol state`
- `refactor(hud): migrate radius legend from canvas to html dom layer`
- `docs(spec): update combat recovery times and audio distance thresholds`
- `test(audio): assert node scheduling when audio context is suspended`

---

## 🏷️ Versionamento Semântico (SemVer) e Tags

O projeto segue [Semantic Versioning 2.0.0](https://semver.org/):
- **MAJOR (`X.0.0`):** Mudanças estruturais incompatíveis (breaking changes).
- **MINOR (`0.X.0`):** Adição de novas mecânicas, sistemas ou melhorias retrocompatíveis.
- **PATCH (`0.0.X`):** Correções de bugs e ajustes retrocompatíveis.

### 🚨 REGRA MANDATÓRIA PERMANENTE DE RELEASE
> **A partir da versão v0.5.0, todo e qualquer merge direcionado à branch 'main' EXIGE:**
> 1. Incremento de versão SemVer no `package.json` e `src/config/version.ts` (patch para fix, minor para feature/refactor).
> 2. Criação de Git Tag anotada no commit do merge (ex: `git tag -a v0.5.0 -m "Release v0.5.0"`).
> 3. Geração de Release Notes estruturada com resumo das alterações (ou via GitHub Release cli `gh release create`).

---

## 🔄 Fluxo Operacional Passo a Passo para o Agente

1. **Recepção da Demanda:** Analise os requisitos e o escopo da tarefa.
2. **Checagem de Branch:** Execute `git status`. Se estiver na `main`, crie a branch apropriada (`git checkout -b <tipo>/<nome-curto>`).
3. **Desenvolvimento e Integridade:** Implemente respeitando as constantes arquiteturais do projeto (escala 60px = 1m, física Arcade 60Hz, Web Audio procedural).
4. **Atualização da Living Documentation:** Se alterou constantes, lógica ou escopo, atualize `docs/GAME_DESIGN_SPEC.md` e `docs/FEATURE_MATRIX.md`.
5. **Quality Gate:** Execute `npm test` e `npm run build` localmente e certifique-se de que estão 100% verdes.
6. **Commit Padronizado:** Faça `git add` e comite segundo a convenção Conventional Commits.
7. **Publicação da Branch:** Envie a branch via `git push -u origin <tipo>/<nome-curto>`.
8. **Submissão de PR:** Preencha o template oficial `.github/PULL_REQUEST_TEMPLATE.md` validando todos os checkboxes do checklist de qualidade.
