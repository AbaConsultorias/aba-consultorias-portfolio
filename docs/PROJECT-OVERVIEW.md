# Visão Geral do Projeto

> Este documento descreve a **base** sobre a qual o projeto foi construído (autenticação, papéis, padrão de API).
> As funcionalidades completas (portais, painel, conector, financeiro) estão resumidas no [README](../README.md).

## O que é

Este é o **template base** da ViziClub para novos projetos: um app Next.js
único (frontend + API juntos) com Supabase para banco de dados e
autenticação. É o que a skill **"ViziClub Starter"** copia para começar
qualquer projeto novo da comunidade.

**Objetivo**: dar um ponto de partida simples e seguro o suficiente pra
quem constrói com IA sem saber programar, sem complexidade que não vai
ser usada.

---

## Stack

| Camada        | Tecnologia                          |
| ------------- | ------------------------------------ |
| Linguagem     | TypeScript                          |
| Framework     | Next.js 16 (App Router)             |
| Estilo        | Tailwind CSS v4 + shadcn/ui         |
| Banco de dados| PostgreSQL via Supabase             |
| Autenticação  | Supabase Auth (auth pronta)         |
| Validação     | Zod                                  |
| Hospedagem    | Vercel                              |

Um único app, sem monorepo: as rotas de API vivem dentro do próprio
Next.js (`src/app/api/`), então não existe servidor separado, nem CORS
pra configurar, nem dois deploys — é tudo publicado junto na Vercel.

---

## Estrutura

```
src/
├── app/
│   ├── layout.tsx, globals.css          # shell raiz (HTML, fontes, tema)
│   ├── (public)/                        # grupo — site público, sem exigir login
│   │   ├── layout.tsx                   # Header e Footer do site
│   │   ├── page.tsx                     # home
│   │   ├── entrar/page.tsx              # login de usuário (cliente, empreiteiro, fornecedor)
│   │   └── trocar-senha/page.tsx        # troca de senha obrigatória
│   ├── cliente/, empreiteiro/, fornecedor/
│   │   └── layout.tsx                   # áreas logadas, guard por papel (exigirPapel)
│   ├── adm-interno/                     # painel da equipe — só pelo caminho secreto (ADMIN_PATH)
│   │   ├── entrar/, trocar-senha/
│   │   └── (protegido)/                 # guard de papel staff; sem acesso responde 404
│   └── api/
│       ├── HttpErrors.ts                # classes de erro compartilhadas
│       ├── utils/                       # handleError, handleResponse, validation
│       └── (modules)/                   # módulos de negócio — grupo, some da URL
│           ├── entrar/                  # route.ts + schema.ts + service.ts
│           ├── sair/                    # route.ts + service.ts (sem schema — sem entrada)
│           ├── trocar-senha/            # route.ts + schema.ts + service.ts
│           └── adm-interno/entrar/      # login da equipe: route.ts + schema.ts + service.ts
├── components/
│   ├── ui/                              # componentes do shadcn/ui (button, input, card...)
│   ├── auth/                            # formulários de login e troca de senha, LogoutButton
│   ├── area/                            # AreaShell: cabeçalho das áreas logadas
│   └── site/                            # Header, Footer, MobileMenu do site público
├── lib/
│   ├── auth/                            # guard, login, sessão, perfil, papéis, destino
│   ├── supabase/                        # clients do Supabase (browser, server e admin)
│   ├── rate-limit.ts                    # limite de requisições (RPC verificar_rate_limit)
│   └── utils.ts                         # cn() do shadcn
└── proxy.ts                             # renova sessão, rate limit em /api e caminho secreto da equipe
supabase/
├── migrations/                          # SQL versionado do banco
└── tests/                               # testes de RLS em SQL (etapa1_rls.sql)
scripts/
└── criar-admin.mjs                      # cria a primeira conta da equipe
docs/                                    # esta pasta
```

Essas pastas ainda não existem, mas fazem parte da convenção deste
projeto — crie quando o primeiro caso de uso real aparecer, no mesmo
nível de `components/`/`lib/` dentro de `src/`:

- `src/hooks/` — hook customizado reaproveitado por mais de um componente
- `src/context/` — Context API do React
- `src/providers/` — providers que envolvem o `layout.tsx` raiz (ex: tema, query client)

`(public)` e `(protegido)` são [Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups)
— organizam fisicamente sem aparecer na URL. Não existe mais um grupo
`(private)`: cada área logada tem o próprio `layout.tsx` com o guard
(ver [WEB-OVERVIEW.md](./WEB-OVERVIEW.md#proteção-de-páginas)).


## Funcionalidades implementadas

| Funcionalidade | Descrição |
| --- | --- |
| **Login de usuário** | `/entrar` — formulário que chama `POST /api/entrar` (e-mail ou usuário + senha) e autentica com `supabase.auth.signInWithPassword`. Redireciona pela área do papel (`/cliente`, `/empreiteiro`, `/fornecedor`). |
| **Login da equipe** | Só pelo caminho secreto `/<ADMIN_PATH>/entrar` (valor na variável de ambiente `ADMIN_PATH`), que chama `POST /<ADMIN_PATH>/api/entrar`. Não aparece em nenhum link do site. |
| **Troca de senha** | `/trocar-senha` (usuários) e `/<ADMIN_PATH>/trocar-senha` (equipe) — obrigatória quando `precisa_trocar_senha` está ligado, por exemplo no primeiro acesso. Chama `POST /api/trocar-senha`. |
| **Logout** | Botão "Sair" nas áreas logadas, que chama `POST /api/sair`. |
| **Áreas logadas** | `/cliente`, `/empreiteiro`, `/fornecedor` e o painel da equipe — páginas em construção, protegidas por papel. |
| **Rate limit** | Limite geral de 120 req/min por IP em `/api` (no `proxy.ts`), com limites mais duros no login e na troca de senha. |
| **Home** | `/` é a página institucional pública, sem estado de login. O Header tem o link "Área do cliente" pra `/entrar`. |

Não há cadastro público: a conta é criada pela equipe (ver a nota abaixo).

Tudo o mais (novas páginas privadas, outros módulos de API) é construído
em cima deste template — não faz parte dele.

## Para saber mais

- [API-OVERVIEW.md](./API-OVERVIEW.md) — como a API é organizada
- [API-MODULES.md](./API-MODULES.md) — o padrão de módulo (controller/service/schema)
- [API-VALIDATION.md](./API-VALIDATION.md) — validação de entrada com Zod
- [DATABASE.md](./DATABASE.md) — Supabase, migrations e RLS
- [WEB-OVERVIEW.md](./WEB-OVERVIEW.md) — Server vs Client Components, rotas públicas e áreas protegidas
- [WEB-DATA-LAYER.md](./WEB-DATA-LAYER.md) — Server Component, fetch ou TanStack Query
- [WEB-COMPONENTS.md](./WEB-COMPONENTS.md) — shadcn/ui: como adicionar componentes
- [SECURITY.md](./SECURITY.md) — regras de segurança (leia antes de mexer no banco)

## Notas importantes

1. **Template, não produto final**: este projeto nasce minimalista de
   propósito. Funcionalidades reais (páginas, outros módulos de API) são
   construídas por cima, não fazem parte do template.
2. **Sem camada de repository**: a lógica de acesso ao Supabase fica
   direto no `service.ts` de cada módulo.
3. **RLS não é opcional**: qualquer tabela nova precisa seguir
   [SECURITY.md](./SECURITY.md).
4. **Sem cadastro público**: não existe página nem rota de cadastro. As
   contas são criadas pela equipe. Pra criar a primeira conta de
   administrador, rode `node --env-file=.env scripts/criar-admin.mjs`: o
   script gera uma senha temporária, mostra só no terminal e obriga a
   troca no primeiro acesso.
