# Frontend Overview

## Propósito

Este guia dá a visão geral do lado frontend do app (as páginas dentro de
`src/app/`). Para como buscar e enviar dados, veja
[WEB-DATA-LAYER.md](./WEB-DATA-LAYER.md). Para componentes de UI, veja
[WEB-COMPONENTS.md](./WEB-COMPONENTS.md).

## Server Components por padrão

O Next.js App Router renderiza tudo como Server Component a menos que você
diga o contrário. Isso é o padrão aqui de propósito: menos JavaScript
mandado pro navegador, menos coisa pra dar errado, mais simples de ler.

| Server Component (padrão)         | Client Component (`"use client"`) |
| ---------------------------------- | ---------------------------------- |
| Páginas e layouts                  | Formulários com estado local        |
| Busca de dados pra exibir           | `useState`, `fetch`, hooks          |
| Conteúdo estático                  | `onClick`, `onChange`, eventos      |

Só adicione `"use client"` no arquivo que realmente precisa de
interatividade (o formulário em si) — o resto da página continua Server
Component por baixo.

## Onde as páginas vivem

```
src/app/
├── (public)/            # site público: layout.tsx põe Header e Footer
│   ├── page.tsx          # home — /
│   ├── entrar/           # /entrar — login de cliente, empreiteiro e fornecedor
│   └── trocar-senha/     # /trocar-senha — troca obrigatória no 1º acesso
├── cliente/              # área logada — layout.tsx exige papel "cliente"
├── empreiteiro/          # área logada — layout.tsx exige papel "empreiteiro"
├── fornecedor/           # área logada — layout.tsx exige papel "fornecedor"
└── adm-interno/          # painel da equipe — só pelo caminho secreto (ver abaixo)
    ├── entrar/           # login da equipe
    ├── trocar-senha/     # troca de senha da equipe
    └── (protegido)/      # exige conta interna e a permissão de cada página; senão responde 404
```

São [Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups)
— pastas entre parênteses que organizam fisicamente sem aparecer na URL
(o mesmo recurso já usado em `src/app/api/(modules)/`, ver
[API-MODULES.md](./API-MODULES.md)). No site, `(public)` e `(protegido)`
usam esse recurso.

### Proteção de páginas

Não existe um grupo `(private)` com guard automático. Cada área tem o seu
`layout.tsx` que chama `exigirPapel()` de `src/lib/auth/guard.ts`:

- Sem sessão, conta inativa ou papel errado → `redirect("/entrar")`
  (áreas de usuário) ou `notFound()` (área da equipe).
- Conta com `precisa_trocar_senha` → redireciona pra tela de troca de senha.
  Só as próprias telas de troca liberam essa checagem (`permitirTrocaSenhaPendente`).

Layout e página não rodam juntos em toda navegação, então a página
também chama `exigirPapel()` por conta própria. A chamada é deduplicada por
requisição (`obterAcessoAtual` usa `cache()`), então não há consulta extra
ao banco.

**Painel da equipe: papel não basta, é preciso a permissão.** Layouts e
páginas do admin usam `src/lib/auth/permissoes-servidor.ts`, que por baixo
chama `exigirPapel()` e depois confere a regra:

- `exigirRegraPagina(regra)`: a regra é uma permissão (`"financeiro.ver"`),
  `"so-admin"` ou `{ qualquer: [...] }`. Sem acesso → `notFound()`, sem
  skeleton. Não há regra padrão.
- `exigirContaInterna()`: só para layouts e telas que qualquer conta interna
  ativa abre. Cada seção dentro delas confere a própria permissão e some
  inteira, porque uma consulta negada pelo RLS volta vazia e pareceria
  "nenhum registro".
- As permissões da sessão vêm de `obterMinhasPermissoes()` (chama
  `minhas_permissoes()` uma vez por requisição). O menu (`NavPortal`,
  `NavConteudo`) mostra só o permitido, mas isso é conforto: quem garante é a
  página, a rota e o RLS. Conta sem nenhuma permissão entra e vê "sua conta
  ainda não tem áreas liberadas".

Página nova do admin sempre chama um desses dois. Veja
[SECURITY.md](./SECURITY.md), "Permissões das contas internas".

Pra criar uma área nova que só usuário logado pode ver, crie a pasta com
um `layout.tsx` que chama `exigirPapel()` com os papéis certos. Os papéis
ficam em `src/lib/auth/papeis.ts`.

### Painel da equipe: caminho secreto

O painel da equipe não fica em `/adm-interno` pra quem visita o site. O
caminho público é o valor da variável de ambiente `ADMIN_PATH` (o valor
não vai pra documentação nem pro código). `src/proxy.ts` reescreve
`/<ADMIN_PATH>/...` para `/adm-interno/...`. Acessar `/adm-interno`
direto responde 404, igual a qualquer URL que não existe.

Sem `ADMIN_PATH` configurado (ou com formato inválido), o painel fica
inalcançável. As páginas da equipe devolvem 404, e as rotas de API da
equipe recusam o acesso.

As páginas da equipe saem com `noindex` e `Cache-Control: no-store`.

## Componentes: fora de `app/`

`src/components/` guarda o que é reaproveitável entre páginas —
diferente das páginas em si, que ficam dentro de `src/app/`:

```
src/components/
├── ui/     # componentes do shadcn/ui (ver WEB-COMPONENTS.md)
├── auth/   # LoginForm, AdminLoginForm, TrocarSenhaForm, LogoutButton,
│           # resposta.ts (lê o formato { message, details } da API)
├── area/   # AreaShell: cabeçalho simples das áreas logadas
└── site/   # Header, Footer, MobileMenu, Logo e nav-links.ts (site público)
```

Convenção reservada pra quando o projeto crescer (essas pastas ainda não
existem — crie no primeiro caso de uso real, como irmãs de
`components/`/`lib/` dentro de `src/`): `hooks/` pra hook reaproveitado
por mais de um componente, `context/` pra Context API, `providers/` pra
providers que envolvem o `layout.tsx` raiz.

## Estilo

Tailwind CSS v4 + shadcn/ui — sem arquivo de configuração
(`tailwind.config.ts`), a detecção de classes é automática. Tokens de
tema (`--background`, `--primary`, etc.) ficam em `src/app/globals.css`.

## Para saber mais

- [WEB-DATA-LAYER.md](./WEB-DATA-LAYER.md) — quando usar Server Component,
  `fetch` ou TanStack Query
- [WEB-COMPONENTS.md](./WEB-COMPONENTS.md) — shadcn/ui: como adicionar
  componentes novos
