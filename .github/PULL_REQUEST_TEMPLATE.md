## 📋 Descrição das Alterações

<!-- Forneça um resumo claro e conciso das alterações implementadas neste PR -->

---

## 🏷️ Tipo de Alteração

Marque as opções aplicáveis com um `x`:

- [ ] 🚀 **Nova Feature** (adição de funcionalidade ou mecânica)
- [ ] 🐛 **Correção de Bug** (fix sem quebra de compatibilidade)
- [ ] ♻️ **Refatoração** (reestruturação de código sem alteração funcional)
- [ ] 📚 **Documentação** (ajustes na pasta docs/, regras ou guias)
- [ ] 🧪 **Testes** (adição ou aprimoramento de suítes de testes unitários)
- [ ] 🔧 **Chore / Infraestrutura** (ajuste de dependências, CI ou ferramentas)

---

## 🛡️ Checklist de Qualidade (Quality Gate Obrigatório)

Certifique-se de marcar todos os itens antes de submeter o PR:

- [ ] **Bloqueio da `main`:** Código desenvolvido exclusivamente em branch isolada (`feature/*`, `fix/*`, etc.). Não há commits diretos na `main`.
- [ ] **Suíte de Testes:** Código não quebra `npm test` (100% dos testes unitários passando no Vitest).
- [ ] **Compilação e Tipagem:** `npm run build` compila sem erros ou warnings bloqueantes (`tsc && vite build`).
- [ ] **Documentação Viva Sincronizada:** Documentação em `docs/` (`GAME_DESIGN_SPEC.md` e `FEATURE_MATRIX.md`) atualizada com as novas regras, fórmulas ou escopo implementados.
- [ ] **Conventional Commits:** Todas as mensagens de commit seguem o padrão `type(scope): description`.
- [ ] **Validação no Sandbox:** Mecânica, física ou áudio testados interativamente no navegador (`npm run dev`).

---

## 🧪 Instruções de Teste e Cenários de Validação

<!-- Descreva os passos para reproduzir e testar as mudanças no Sandbox -->
1. Inicie a aplicação com `npm run dev`.
2. Acesse `http://localhost:5173`.
3. Verifique o cenário:
   - ...

---

## 📸 Evidências Visuais (Opcional)

<!-- Se houver alteração visual no Sandbox ou no HUD, anexe capturas de tela ou gravações -->
| Antes | Depois |
| :---: | :---: |
| *(Imagem)* | *(Imagem)* |

---

## 🔗 Tarefas ou Issues Relacionadas

- Relacionado a: <!-- Referência de issue ou descrição da solicitação do usuário -->
