# API Overview

## Propósito

Este guia dá a visão geral da API. Para o padrão de cada módulo em
detalhe, veja [API-MODULES.md](./API-MODULES.md); para validação de
entrada, veja [API-VALIDATION.md](./API-VALIDATION.md).

## Estrutura

```
src/app/api/
├── HttpErrors.ts       # classes de erro compartilhadas entre módulos
├── utils/
│   ├── handleError.ts   # normaliza qualquer erro em {message, details, status}
│   ├── handleResponse.ts# transforma {message, details, status} em Response.json
│   └── validation.ts    # valida dados com um schema Zod, lança BadRequestError
└── (modules)/           # grupo de rotas — não aparece na URL (ver API-MODULES.md)
    ├── entrar/          # POST /api/entrar — login de usuário
    ├── sair/            # POST /api/sair — logout
    ├── trocar-senha/    # POST /api/trocar-senha — troca de senha
    └── adm-interno/
        └── entrar/      # login da equipe, só pelo caminho secreto (ver WEB-OVERVIEW.md)
```

## Ciclo de uma requisição

```
HTTP Request
    ↓
route.ts        → lê o body, valida com validation(), chama o service
    ↓
service.ts      → regra de negócio, chama o Supabase direto (sem repository)
    ↓
route.ts        → devolve a resposta com handleResponse()
```

Não existe uma camada de "controller" separada em pasta: no Next.js App
Router, o arquivo `route.ts` **precisa** estar fisicamente no caminho da
URL, então ele já É o controller.

## Erros

Toda rota segue o mesmo formato de resposta, sucesso ou erro:

```json
{ "message": "...", "details": ... }
```

- **Sucesso**: `message` é uma frase legível ("Login realizado com
  sucesso."), `details` traz os dados.
- **Erro**: `message` é o nome da classe de erro (`BadRequestError`,
  `UnauthorizedError`, `ForbiddenError`, `TooManyRequestsError`...),
  `details` traz a explicação ou, no caso de validação, os erros por campo.

Classes disponíveis em `HttpErrors.ts`: `BadRequestError` (400),
`UnauthorizedError` (401), `ForbiddenError` (403), `ConflictError` (409),
`TooManyRequestsError` (429), `InternalServerError` (500). Precisar de outra
(ex: `NotFoundError`, 404)? Adiciona seguindo o mesmo padrão — `status` +
nome da classe + `details`.

Quando o limite de requisições do `proxy.ts` bloqueia uma chamada a `/api`,
a resposta sai antes de chegar na rota, no mesmo formato, com
`message: "TooManyRequestsError"` e status 429.

Use `401` quando a sessão não existe ou é inválida, e `403` quando a sessão
é válida mas não basta (papel errado, conta inativa, ou troca de senha
pendente, ou sem a permissão). Ver `src/lib/auth/permissoes-servidor.ts` (`exigirRegraApi`).

Todo `route.ts` segue o mesmo formato de `try/catch`:

```typescript
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const data = validation({ data: body, schema: minhaSchema });

    const resultado = await minhaFuncaoDoService(data);

    return handleResponse({ message: "...", details: resultado, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
```

`handleError` só sabe tratar instâncias de `HttpError` — qualquer outro
erro (um bug, uma falha de rede) vira automaticamente um 500 genérico, sem
vazar detalhe nenhum pro cliente. Erros inesperados são sempre logados com
`console.error` dentro do `service.ts` antes de virar um `HttpError`, pra
não perder a causa real durante o desenvolvimento.

### Por que isso importa

Erro tratado direito é parte da funcionalidade, não um detalhe por cima
dela — é o que diferencia o usuário entender "esse e-mail já existe,
tenta entrar" de só ver "algo deu errado, tenta de novo" e travar no
mesmo lugar de novo. Por isso, todo `service.ts` que chama um provedor
externo (Supabase ou qualquer outra API) deve **inspecionar o erro**
que volta — `code`, `status`, campos específicos — em vez de assumir
que só existe "deu erro" ou "não deu erro". Provedores externos costumam
ter mais de um jeito de sinalizar o mesmo tipo de falha dependendo de
configuração (veja o exemplo real disso em `src/lib/auth/login.ts`, descrito em
[API-MODULES.md](./API-MODULES.md#inspecione-o-erro-de-provedor-externo)).
Só deixe cair no `InternalServerError` genérico os casos que, de fato,
você não tem como prever ou explicar melhor pro usuário.
