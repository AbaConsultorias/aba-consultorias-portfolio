# Módulos de API

## Padrão

Cada módulo de negócio é uma pasta dentro de `src/app/api/(modules)/`, com no
máximo três arquivos:

```
src/app/api/(modules)/{feature}/
├── route.ts      # controller — HTTP: ler body, validar, chamar o service, responder
├── schema.ts      # validação — schema Zod da entrada
└── service.ts      # regra de negócio — chama o Supabase direto, sem repository
```

Sem `controllers/`, `services/`, `repositories/` como pastas separadas:
cada módulo já é pequeno o bastante pra caber em três arquivos soltos, e
adicionar mais subpastas seria complexidade sem necessidade real.

O `route.ts` é a única porta de entrada do módulo — tanto pro próprio
frontend (via `fetch`) quanto pra qualquer chamador externo (webhook,
app mobile, curl). Não existe uma segunda porta via Server Action: ter
dois jeitos diferentes do front chamar o backend no mesmo projeto seria
complexidade sem necessidade real pra esse público. Ver
[WEB-DATA-LAYER.md](./WEB-DATA-LAYER.md).

Módulos que não recebem dado (como `sair/`) podem ficar só com `route.ts`
e `service.ts`.

## Por que `(modules)` entre parênteses

É um [Route Group](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups)
do Next.js: a pasta organiza fisicamente os módulos de negócio, separado
de arquivos de infraestrutura (`HttpErrors.ts`, `utils/`), mas **não
aparece na URL**. `src/app/api/(modules)/entrar/route.ts` responde em
`/api/entrar`, não em `/api/modules/entrar`.

Isso funciona porque, dentro de `src/app/`, um arquivo só vira rota pública se
for exatamente `route.ts` (ou `page.tsx`, etc). Qualquer outro arquivo ao
lado — `service.ts`, `schema.ts` — nunca é tratado como endpoint, então é
seguro colocá-los dentro da mesma pasta do módulo.

## Exemplo real: `entrar/`

O módulo `entrar/` é o login de usuário (cliente, empreiteiro, fornecedor).
Copie a estrutura dele ao criar um módulo novo.

```typescript
// schema.ts
export const entrarSchema = z.object({
  identificador: z
    .string("Informe seu e-mail ou usuário.")
    .trim()
    .min(1, "Informe seu e-mail ou usuário.")
    .max(254, "E-mail ou usuário inválido.")
    .refine(
      (valor) =>
        valor.includes("@")
          ? z.email().safeParse(valor).success
          : FORMATO_USUARIO.test(valor),
      "E-mail ou usuário inválido.",
    ),
  senha: z
    .string("Informe sua senha.")
    .min(1, "Informe sua senha.")
    .max(128, "Senha inválida."),
});
export type EntrarInput = z.infer<typeof entrarSchema>;
```

```typescript
// service.ts
export async function entrar(
  { identificador, senha }: EntrarInput,
  request: Request,
) {
  const email = identificadorParaEmail(identificador);

  const dentroDoLimite =
    (await limitar(chaveIp(request, "entrar-ip"), 30, 60 * 60)) &&
    (await limitar(chaveIp(request, "entrar", email), 5, 15 * 60));

  if (!dentroDoLimite) {
    throw new TooManyRequestsError("Muitas tentativas. Tente novamente mais tarde.");
  }

  const perfil = await entrarComSenha(email, senha, PAPEIS_USUARIO);

  return { destino: destinoAposLogin(perfil) };
}
```

A checagem de senha e de papel fica em `src/lib/auth/login.ts`
(`entrarComSenha`), compartilhada com o login da equipe. O módulo só cuida
do que é específico dele: o limite de tentativas e o destino depois do login.

```typescript
// route.ts
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const data = validation({ data: body, schema: entrarSchema });

    const { destino } = await entrar(data, request);

    return handleResponse({
      message: "Login realizado com sucesso.",
      details: { destino },
      status: 200,
    });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
```

O `request.json().catch(() => null)` faz um body inválido (que não é JSON)
cair na validação, e não num 500.

## Módulos sem sessão de usuário: API do conector

`src/app/api/(modules)/conector/v1/{configuracao,envios,envios/[id]/confirmar,status}/` é chamada pelo programa do
servidor da empresa (contrato em ETAPA-7-API-CONECTOR.md), não por navegador. Mesmo
padrão `route.ts` + `schema.ts` + `service.ts`, com estas diferenças:

- **Sem cookie e sem `validation()`/`handleResponse()`**: o corpo e os erros seguem o contrato (`{ erro, ... }`).
  O `route.ts` só chama `responderAoConector()` (`src/lib/conector/rota.ts`), que autentica a chave
  `Bearer abacon_...`, aplica o limite de 600 requisições/hora, atualiza `ultimo_contato_em` e converte qualquer
  exceção em `500 { erro: "interno" }`. Chave inválida, revogada ou ausente é **404 vazio**.
- **Tudo pelo client admin** (a chave não é um usuário), então o RLS não protege: o código confere sozinho dono do
  envio, estado, validade e regra. Nada é lido do corpo sem passar pelo `schema.ts` (Zod `strictObject`).
- **Regras puras** (caminho, lista de bloqueio, casamento de regra, limite diário) ficam em
  `src/lib/conector/regras.ts`, sem dependências de servidor, e são testadas por `scripts/testar-conector-api.mjs`.
- O `service.ts` aceita `dependencias` (R2, relógio, gerador de id) como o upload de documentos, para teste.

A chave de servidor é emitida e revogada por `adm-interno/portal/conector/` (`GET` estado, `POST` emite e devolve
a chave uma única vez, `DELETE` revoga), só para o papel `admin`, com a sessão do admin (RLS) e não com a secret key.
Pelo caminho secreto do admin: `/<ADMIN_PATH>/api/portal/conector`.

## Sem cadastro público

Não existe rota de cadastro. Não crie um módulo `register/` nem chame
`supabase.auth.signUp` a partir do site: o cadastro é feito pela equipe.
A primeira conta de administrador sai de `scripts/criar-admin.mjs`, que usa
o client admin.

Se um módulo novo precisar criar uma conta, use o client admin
(`src/lib/supabase/admin.ts`), e só em código de servidor. Ver a regra 4
do [SECURITY.md](./SECURITY.md).

## Inspecione o erro de provedor externo

Quando um `service.ts` chama um provedor externo (Supabase ou qualquer
outra API), não assuma que a falha tem um único formato. Inspecione o
`error` que volta: `code`, `status`, campos específicos. Não basta checar
se ele existe.

O exemplo real está em `src/lib/auth/login.ts`. Uma falha do Supabase com
`status` 5xx (ou sem `status`) vira `InternalServerError`, com o `code` no
log. Só uma credencial recusada vira `UnauthorizedError`, com mensagem
genérica:

```typescript
if (error || !data.user) {
  if (!error?.status || error.status >= 500) {
    console.error("[login] falha no Supabase:", error?.code, error?.status);
    throw new InternalServerError(null);
  }
  throw new UnauthorizedError(CREDENCIAIS_INVALIDAS);
}
```

A lição vale além do Supabase: só deixe cair no genérico
(`InternalServerError`) os casos que você realmente não sabe explicar. Um
erro mal propagado é a diferença entre o usuário entender o que fazer
e ele simplesmente tentar de novo e travar do mesmo jeito.

## Adicionando um módulo novo

1. Crie `src/app/api/(modules)/{feature}/`.
2. `schema.ts` — schema Zod com as mensagens de erro em português.
3. `service.ts` — a regra de negócio, chamando o Supabase direto
   (`@/lib/supabase/server`). Toda tabela nova que o service usar precisa
   seguir [SECURITY.md](./SECURITY.md) (RLS + políticas).
4. `route.ts` — controller: `validation()` → chama o service → `handleResponse()`,
   tudo dentro de um `try/catch` que cai em `handleError()`.
5. Erros específicos do módulo usam as classes de `HttpErrors.ts` (ou uma
   nova, se nenhuma servir).
