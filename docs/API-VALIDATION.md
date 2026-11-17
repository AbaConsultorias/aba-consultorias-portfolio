# Validação de entrada (Zod)

## Visão geral

Toda entrada de uma rota de API precisa ser validada com um schema Zod
antes de chegar na regra de negócio. Isso garante que o `service.ts` só
recebe dados no formato certo, e centraliza as mensagens de erro. Esse é
o lado obrigatório, no backend — ver [No front-end](#no-front-end) logo
abaixo pra quando também vale validar no formulário.

## No backend (obrigatório)

### 1. Crie o schema no módulo

```typescript
// src/app/api/(modules)/{feature}/schema.ts
import z from "zod";

export const meuSchema = z.object({
  email: z.string().email("E-mail inválido."),
  quantidade: z.number("Valor inválido.").min(1, "A quantidade mínima é 1."),
});

export type MeuInput = z.infer<typeof meuSchema>;
```

### 2. Valide dentro do `route.ts`

Diferente de uma API Express (onde a validação roda como middleware antes
do controller), aqui não existe cadeia de middleware — o `route.ts` só
chama a função `validation()` diretamente, no início do handler:

```typescript
import { validation } from "../../utils/validation";

const body = await request.json();
const data = validation({ data: body, schema: meuSchema });
// `data` já sai tipado como MeuInput
```

Se a validação falhar, `validation()` lança um `BadRequestError` — o
`catch` do `route.ts` cuida do resto (ver [API-OVERVIEW.md](./API-OVERVIEW.md)).

## Formato do erro de validação

```json
{
  "message": "BadRequestError",
  "details": {
    "identificador": { "errors": ["E-mail ou usuário inválido."] },
    "senha": { "errors": ["Informe sua senha."] }
  }
}
```

Esse é o formato real do login (`src/app/api/(modules)/entrar/schema.ts`).

## Padrões comuns do Zod

Referência completa: https://zod.dev/api

### E-mail

```typescript
z.string().email("E-mail inválido.");
```

### Texto com limite

```typescript
z.string().min(1, "Obrigatório.").max(255, "Muito longo.");
```

### Número

```typescript
z.number("Valor inválido.").min(1).max(100);
// vindo de query string (sempre chega como texto):
z.coerce.number("Valor inválido.").min(1);
```

### UUID (ids do Supabase são UUID por padrão)

```typescript
z.uuid("ID inválido.");
```

### Enum

```typescript
z.enum(["PENDENTE", "PAGO", "ENVIADO"]);
```

### Campo opcional

```typescript
z.object({ nome: z.string().optional() });
```

### Validação customizada

```typescript
z.string().refine((val) => val.startsWith("BR-"), {
  message: "Código deve começar com 'BR-'.",
});
```

## Boas práticas (backend)

1. **Um schema por módulo**, no `schema.ts` daquele módulo — não crie uma
   pasta de schemas compartilhada.
2. **Mensagens em português, específicas** — evite deixar a mensagem
   padrão do Zod (em inglês) vazar pro usuário final.
3. **`z.coerce.number()`** para valores vindos de query string ou params,
   que sempre chegam como texto.
4. **Valide todo o body de uma vez** — não valide campo por campo dentro
   do `service.ts`; se chegou lá, já passou pela validação.

## No front-end

Validação no front-end é sobre **UX** (avisar a pessoa mais rápido, sem
esperar o servidor) — nunca é a proteção de verdade. O backend sempre
valida de novo, mesmo que o formulário já tenha validado (ver regra 7 do
[SECURITY.md](./SECURITY.md)).

### Padrão: react-hook-form + Zod + `Field` do shadcn

Todo formulário que envia dado pra uma rota validada usa esse padrão —
o balão de validação nativo do navegador muda de cara em cada browser e
não combina com o resto do site, então não é ele que mostra o erro.
Quem mostra é o `FieldError` do shadcn, embaixo do campo, com o mesmo
estilo (`text-destructive`) que já usamos pro erro do servidor.

Reaproveita o **mesmo `schema.ts` do módulo** via `zodResolver` — nunca
duplica a regra de validação num segundo lugar:

```tsx
"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { entrarSchema, type EntrarInput } from "@/app/api/(modules)/entrar/schema";

const { control, handleSubmit } = useForm<EntrarInput>({
  resolver: zodResolver(entrarSchema),
  defaultValues: { identificador: "", senha: "" },
});

// dentro do <form onSubmit={handleSubmit(onSubmit)} noValidate>:
<Controller
  name="identificador"
  control={control}
  render={({ field, fieldState }) => (
    <Field data-invalid={fieldState.invalid}>
      <FieldLabel htmlFor="identificador">E-mail ou usuário</FieldLabel>
      <Input {...field} id="identificador" aria-invalid={fieldState.invalid} />
      <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
    </Field>
  )}
/>
```

Ver `src/components/auth/LoginForm.tsx` pro exemplo completo e real
(inclusive o erro geral do servidor, tipo "e-mail ou senha inválidos",
que é separado do erro de campo — esse continua um texto simples abaixo
do botão, porque não pertence a um campo específico).

`noValidate` no `<form>` desliga a validação nativa do navegador — sem
isso, o balão nativo pode aparecer antes do JS rodar e brigar com o
`FieldError`.

### Máscara/formatação em tempo real — só onde o formato é fixo

Diferente da validação (que vale pra praticamente todo formulário agora),
**máscara não é pra todo campo** — só faz sentido onde o formato é
rígido e conhecido: telefone, CEP, CPF/CNPJ. E-mail, nome, texto livre
não devem ser mascarados.

```tsx
function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

// no onChange do campo (dentro do Controller):
onChange={(e) => field.onChange(formatPhone(e.target.value))}
```

Nenhum campo deste template precisa de máscara hoje (é só e-mail/senha)
— fica documentado como padrão pra quando um formulário com
telefone/CEP/CPF aparecer (ex: checkout).
