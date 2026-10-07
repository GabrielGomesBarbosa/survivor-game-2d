# Guia de Contribuição e Ciclo de Desenvolvimento

Bem-vindo ao guia de desenvolvimento do **2D Top-Down Survival Horror Sandbox**. Este documento define o padrão de ciclo de vida de código, convenções de branches, commits, testes e publicação no repositório.

---

## 🛠️ Pré-requisitos do Ambiente

- **Node.js:** Versão 20.x ou superior (LTS recomendada).
- **npm:** Versão 10.x ou superior.
- **Git:** Instalado e configurado com suas credenciais.

Para inicializar o ambiente local:
```bash
# Instalar dependências de forma reproduzível
npm ci

# Iniciar servidor local de desenvolvimento (Vite)
npm run dev
```

---

## 🌿 Modelo de Branches (Git Flow)

A branch `main` representa o estado estável e em produção do projeto. **Commits diretos na branch `main` são terminantemente proibidos.**

Toda contribuição segue o fluxo baseado em branches de curta duração e Pull Requests:

```
main (protegida)
  │
  ├── feature/damaged-gen-audio ───────► PR ───► Merge na main (v0.4.0)
  │
  ├── fix/killer-attack-trigger ───────► PR ───► Merge na main (v0.4.1)
  │
  └── refactor/telemetry-legend ───────► PR ───► Merge na main (v0.4.2)
```

### Prefixos de Branch:
- `feature/<nome-curto>`: Novas mecânicas ou componentes.
- `fix/<nome-curto>`: Correções de bugs ou falhas.
- `refactor/<nome-curto>`: Otimizações e limpezas sem alteração de funcionalidade.
- `docs/<nome-curto>`: Atualizações de documentação e governança.
- `test/<nome-curto>`: Criação ou aprimoramento de suítes de testes.

---

## 🔄 Ciclo de Vida de uma Tarefa (Passo a Passo)

### 1. Sincronize a branch `main`
Antes de iniciar qualquer trabalho, garanta que a sua base local esteja atualizada:
```bash
git checkout main
git pull origin main
```

### 2. Crie uma branch de trabalho
Crie a branch seguindo o prefixo adequado:
```bash
git checkout -b feature/sua-feature-aqui
```

### 3. Desenvolva respeitando a arquitetura
- **Métricas:** 60 pixels equivalem estritamente a 1.0 metro no mundo do jogo.
- **Áudio:** Síntese procedural em tempo real via Web Audio API (`AudioManager.ts`), sem dependência de arquivos externos de áudio.
- **Física:** Arcade Physics a 60Hz.
- **Tipagem:** TypeScript rigoroso sem `any` desnecessário.

### 4. Valide a Suíte de Testes e o Build Localmente
Antes de realizar qualquer commit, execute o Quality Gate:
```bash
# Executa todos os testes unitários (Vitest)
npm test

# Valida tipagem TypeScript e gera o bundle de produção (tsc && vite build)
npm run build
```
> ⚠️ **Atenção:** 100% dos testes devem passar e a compilação deve finalizar com código de saída 0.

### 5. Registre seus Commits com Conventional Commits
Formate sua mensagem segundo a convenção:
```bash
git add .
git commit -m "feat(audio): add spatial roll-off attenuation to damaged generators"
```

Tipos comuns:
- `feat`: Adição de nova mecânica.
- `fix`: Correção de bug.
- `refactor`: Limpeza ou refatoração.
- `docs`: Documentação.
- `test`: Testes unitários.
- `chore`: Tarefas de build e dependências.

### 6. Envie a branch para o repositório remoto
```bash
git push -u origin feature/sua-feature-aqui
```

### 7. Abra o Pull Request (PR)
1. Vá até o GitHub e crie o Pull Request apontando para a branch `main`.
2. Preencha todos os campos do template oficial (`.github/PULL_REQUEST_TEMPLATE.md`).
3. Aguarde o pipeline de CI do **GitHub Actions** ser executado. O merge só pode ocorrer com o status verde (aprovado).

---

## 🏷️ Versionamento Semântico e Releases

Ao mesclar um PR na `main`:
1. Incremente a versão em conformidade com o SemVer (`MAJOR.MINOR.PATCH`).
2. Gere a Git Tag anotada correspondente:
   ```bash
   git checkout main
   git pull origin main
   git tag -a v0.4.0 -m "Release v0.4.0: Spatial audio attenuation and DOM HUD legend"
   git push origin v0.4.0
   ```
3. Registre a Release no GitHub detalhando as principais melhorias implementadas.
