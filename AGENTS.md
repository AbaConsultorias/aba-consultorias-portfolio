# Guia pra IA trabalhando neste projeto

**Leia este arquivo inteiro antes de começar qualquer tarefa.**

Este arquivo é copiado junto com o resto do template pra todo projeto
novo criado a partir dele. Se o escopo deste projeto mudar bastante, este
arquivo (e `docs/`) deve ser adaptado — do mesmo jeito que este aqui já
foi adaptado a partir do seu próprio ponto de partida.

---

## Esta NÃO é a versão do Next.js que você conhece

Este projeto usa **Next.js 16**, que tem mudanças que quebram
compatibilidade com versões anteriores — APIs, convenções e estrutura de
arquivos podem ser diferentes do que está no seu treinamento.

1. Leia a documentação da versão instalada em `node_modules/next/dist/docs/`
   (não confie em conhecimento antigo sobre Next.js).
2. Preste atenção em avisos de depreciação do próprio `next dev`/`next build`.

---

## Documentação: carregue sob demanda, pela tarefa

- **Carregue um doc só quando precisar de informação dele** pra
  completar a tarefa atual — nunca "porque existe" ou "pode ser
  relevante".
- **Não carregue todos os docs no início da sessão.** Só
  [docs/PROJECT-OVERVIEW.md](./docs/PROJECT-OVERVIEW.md) vale ler sempre
  — é o mapa do projeto e linka pro resto.
- **Carregamento recursivo**: se o doc que você abriu linkar pra outro
  (ex: `API-MODULES.md` apontando pra `WEB-DATA-LAYER.md`), abra esse
  outro também antes de continuar.
- **Nunca hardcode caminho absoluto.** Resolva todo caminho relativo à
  raiz do projeto atual — este template é copiado pra uma pasta
  diferente a cada novo projeto que a Skill "ViziClub Starter" cria.

| Vai fazer o quê?                                    | Leia antes de começar                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| Qualquer tarefa neste projeto                       | [docs/PROJECT-OVERVIEW.md](./docs/PROJECT-OVERVIEW.md)                     |
| Criar ou alterar um módulo de API (rota)            | [docs/API-MODULES.md](./docs/API-MODULES.md), [docs/API-OVERVIEW.md](./docs/API-OVERVIEW.md) |
| Validar entrada de uma rota (schema Zod)            | [docs/API-VALIDATION.md](./docs/API-VALIDATION.md)                         |
| Criar/alterar tabela, RLS, política, migration      | [docs/DATABASE.md](./docs/DATABASE.md), [docs/SECURITY.md](./docs/SECURITY.md) |
| Qualquer chave, token, variável de ambiente, webhook | [docs/SECURITY.md](./docs/SECURITY.md)                                     |
| Criar página, layout, rota pública/privada          | [docs/WEB-OVERVIEW.md](./docs/WEB-OVERVIEW.md)                             |
| Buscar ou enviar dado no frontend (form, listagem)  | [docs/WEB-DATA-LAYER.md](./docs/WEB-DATA-LAYER.md)                         |
| Adicionar/usar componente de UI ou ícone            | [docs/WEB-COMPONENTS.md](./docs/WEB-COMPONENTS.md)                         |

[docs/SECURITY.md](./docs/SECURITY.md) nunca é opcional quando a tarefa
toca dado de usuário, banco ou segredo — mesmo que o pedido não mencione
segurança.

---

## Princípios

- **Sem complexidade à toa (YAGNI).** Este template é deliberadamente
  minimalista — sem repository, sem Server Actions, sem TanStack Query
  instalado por padrão.
  Não reintroduza uma dessas camadas "por padrão de mercado" sem uma
  necessidade real e concreta na tarefa atual.
- **Segurança não é negociável.** Valide toda entrada com Zod, nunca
  hardcode segredo, nunca exponha dado sensível em log/resposta/erro.
  Detalhes em [docs/SECURITY.md](./docs/SECURITY.md).
- **Manutenibilidade primeiro.** Nomes revelam intenção; função faz uma
  coisa só; prefira early return a aninhar `if`.
- **Comentários**: por padrão, nenhum. Escreva um só quando o código
  sozinho não explica o *porquê* — uma decisão não óbvia, uma
  contorno de limitação do framework, uma pegadinha que alguém vai
  repetir (ex: em `src/lib/auth/guard.ts`, por que só as telas de troca de
  senha liberam `permitirTrocaSenhaPendente`: senão o guard manda a pessoa
  para a própria tela em loop). Nunca escreva um comentário pra explicar *o quê* o
  código faz — se precisa disso, o código deveria ter nome melhor.
- **TypeScript**: modo estrito já ligado (`strict: true`) — mantenha
  assim. Evite `any`; use `unknown` e refine o tipo. Prefira `type` a
  `interface` pra formatos de objeto.

## Padrões deste projeto (resumo rápido)

- **Módulo de API** = pasta com `route.ts` (controller HTTP) +
  `schema.ts` (Zod) + `service.ts` (regra de negócio, chama o Supabase
  direto). Sem repository. Ver [docs/API-MODULES.md](./docs/API-MODULES.md).
- **Frontend fala com o backend via `fetch`**, nunca Server Action —
  um jeito só de fazer a mesma coisa. Ver [docs/WEB-DATA-LAYER.md](./docs/WEB-DATA-LAYER.md).
- **RLS é a fronteira de segurança real**, não o front-end nem a
  publishable key. Ver [docs/SECURITY.md](./docs/SECURITY.md).
- **Componentes de UI vêm do shadcn/ui (base Radix)**, ícones do
  Lucide. Ver [docs/WEB-COMPONENTS.md](./docs/WEB-COMPONENTS.md).

## Comandos

```bash
npm run dev          # servidor de desenvolvimento
npm run build        # build de produção
npm run check-types  # checagem de tipos (rápido, sem build completo)
npm run lint         # eslint
```
