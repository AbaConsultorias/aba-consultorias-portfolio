# Dados no Frontend

## A regra: use o mais simples que resolve

Antes de escolher como buscar ou enviar um dado, siga esta ordem — só
passe pro próximo item se o anterior genuinamente não resolver:

1. **Mostrar dado numa página** → busque direto no Server Component.
2. **Enviar um formulário** (login, troca de senha, qualquer "submit")
   → `fetch` pra rota do próprio backend (`src/app/api/(modules)/{feature}/route.ts`).
3. **Dado que muda no client sem reload de página e fora de um submit**
   (busca ao digitar, contador ao vivo, scroll infinito) → só aí instale
   `@tanstack/react-query`, e só pra essa parte específica.

Este template **não** vem com TanStack Query instalado, e também não usa
Server Actions pra chamar o backend — só `fetch` mesmo. É o mesmo
conceito ensinado na Live 2 (o front chama uma rota no backend), sem
introduzir um segundo jeito de fazer a mesma coisa.


---

## 1. Buscar dado pra exibir: Server Component

Sem lib nenhuma, sem `useEffect`, sem estado de loading manual — o Next
já espera a página terminar de buscar antes de mandar o HTML:

```typescript
// src/app/cliente/page.tsx (o layout dessa área já chamou exigirPapel)
import { obterAcessoAtual } from "@/lib/auth/sessao";

export default async function ClientePage() {
  const acesso = await obterAcessoAtual();

  return <p>Logado como {acesso?.user.email}</p>;
}
```

`obterAcessoAtual()` lê a sessão já validada no servidor e o perfil (ver
`src/lib/auth/sessao.ts`). Ele é deduplicado por requisição com `cache()`.

## 2. Enviar formulário: `fetch` pra rota do backend

Todo módulo de API já expõe um `route.ts` (ver
[API-MODULES.md](./API-MODULES.md)) que devolve sempre o mesmo formato:
`{ message, details }`. O formulário só precisa de um `onSubmit` que
chama essa rota, sem nenhum conceito novo do Next.js pra aprender.

### Exemplo real: formulário de login

Ver `src/components/auth/LoginForm.tsx` — usa exatamente esse padrão
(`fetch` pra `POST /api/entrar`), só que com react-hook-form + Zod no lugar
de `useState` puro, e com componentes do shadcn/ui (`Field`, `Input`,
`Button`, `Card`). Ele reaproveita o `entrarSchema` do módulo. A lógica de
fetch/erro/redirecionamento é a mesma, só a parte visual muda — ver
[WEB-COMPONENTS.md](./WEB-COMPONENTS.md) e
[API-VALIDATION.md](./API-VALIDATION.md#no-front-end).

Os formulários leem a resposta com `src/components/auth/resposta.ts`
(`lerResposta`, `mensagemDeErro`, `destinoDaResposta`). Ele aceita só
caminhos internos, nunca uma URL de fora.

Como o `fetch` sai do navegador (não do servidor), o cookie de sessão que
`/api/entrar` grava chega certinho no navegador — não existe o problema de
"resposta interna que ninguém lê" que aconteceria se fosse o próprio
servidor chamando a própria rota. Mesma origem, sem CORS, sem
configuração extra.

## 3. Só quando precisar: TanStack Query

Se uma tela realmente precisar de dado reativo no client (não é o caso de
login/troca de senha, nem da maioria das páginas de exibição):

```bash
npm install @tanstack/react-query
```

Adicione um `QueryClientProvider` no `layout.tsx` só quando for instalar,
e use `useQuery`/`useMutation` apenas no componente que precisa — não
troque as buscas em Server Component nem os formulários existentes por
TanStack Query "pra ficar tudo igual". As duas abordagens convivem no
mesmo projeto sem problema.
