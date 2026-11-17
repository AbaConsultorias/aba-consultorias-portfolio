# Componentes (shadcn/ui)

## Por que shadcn/ui

Os componentes de interface (botão, input, card...) vêm do
[shadcn/ui](https://ui.shadcn.com) em vez de serem escritos na mão. São
componentes prontos, acessíveis e testados pela comunidade — usar eles
reduz bastante a chance de quebrar alguma coisa, especialmente quando
quem está construindo é uma IA sem revisão humana no meio do caminho.

Diferente de uma lib normal, o shadcn **não é uma dependência do
`node_modules`** — o código de cada componente é copiado pro projeto em
`src/components/ui/`. Isso significa que os componentes já instalados
podem ser editados livremente, sem medo de um `npm update` sobrescrever
alguma customização.

## Já instalado

`src/components/ui/`: `button`, `input`, `label`, `card`, `field`,
`separator` (dependência do `field`).

`field` é o componente de formulário do shadcn — substituiu o antigo
`form`/`FormField`/`FormMessage` (esse ainda aparece no registro, mas
vazio; não use). Vem acompanhado de `react-hook-form` e
`@hookform/resolvers` como dependências do projeto (não do shadcn em
si). Ver [API-VALIDATION.md](./API-VALIDATION.md#no-front-end) pro
padrão de uso com Zod.

## Como adicionar um componente novo

```bash
npx shadcn@latest add <nome-do-componente>
```

Exemplos de nomes: `dialog`, `select`, `textarea`, `checkbox`, `sonner`
(toast). Lista completa em [ui.shadcn.com/docs/components](https://ui.shadcn.com/docs/components).

### Importante pra quem for rodar isso via IA, sem humano no meio

O CLI do shadcn é **interativo por padrão** — ele pergunta coisas tipo
"deseja reinstalar o componente existente?" e trava esperando resposta.
Pra evitar isso, sempre rode com `-y`, e se o componente já existir e
precisar ser atualizado, use `--reinstall`:

```bash
npx shadcn@latest add button --yes --reinstall
```

Pra inicializar um projeto do zero (não é o caso deste template, que já
está inicializado), o comando teria que incluir `-d`/`--defaults` pra
pular todos os prompts — mas veja a nota abaixo antes de usar isso.

## Base UI vs Radix — uma decisão consciente

Este projeto usa a base **Radix** (`components.json` → `"style":
"radix-nova"`), não a "Base UI" que é o novo padrão do shadcn quando você
roda `init -d` (sem escolher a base manualmente). Motivo: Radix é muito
mais estabelecido, documentado e testado — inclusive no treinamento de
praticamente qualquer IA — enquanto Base UI é recente e menos coberto por
exemplos e documentação. Pro objetivo deste template (IA mantendo o
código sozinha), Radix é a escolha mais segura hoje.

Se algum dia for necessário reinicializar do zero, force a base certa:

```bash
npx shadcn@latest init -b radix -p nova -y --reinstall
```

(`-b radix` escolhe a base; `-p nova` escolhe o preset visual que já
estava em uso; sem isso o CLI vai perguntar interativamente.)

## Usando um componente

```tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

<Button variant="outline" size="sm">Sair</Button>
<Input type="email" placeholder="E-mail" />
```

Ver `src/components/auth/LoginForm.tsx` para um exemplo real combinando
`Card`, `Input`, `Field` e `Button` num formulário completo.

## Tamanho dos componentes

Um componente bom é pequeno. Como regra prática: se passar de **~200
linhas**, é sinal de que precisa ser quebrado em componentes menores.

Quando isso acontecer, **não** resolva extraindo a lógica pra um hook só
pra "esconder" linhas do componente — a lógica continua pertencendo ao
componente, e separar em hook nesse caso só espalha a mesma coisa em
outro arquivo sem simplificar nada de verdade. Em vez disso:

1. Verifique se o componente está carregando lógica/responsabilidade que
   **não é dele** — um formulário que também renderiza uma lista, um
   card que também decide regra de negócio, etc.
2. Componentize: extraia essa parte pra um componente próprio, com sua
   própria responsabilidade — não pra um hook.

Um hook faz sentido quando existe lógica de estado genuinamente
reaproveitada por **mais de um componente** — não como técnica pra
encurtar um componente grande.

## Ícones: Lucide

Use sempre [Lucide](https://lucide.dev) (`lucide-react`) pra qualquer
ícone — já vem instalado (é a lib padrão de ícone do shadcn/ui,
`iconLibrary: "lucide"` no `components.json`). Não instale outra lib de
ícones (react-icons, heroicons, etc.) sem um motivo forte — ter duas
libs de ícone no mesmo projeto é inconsistência visual e peso extra à
toa.

```tsx
import { Mail, Trash2 } from "lucide-react";

<Mail className="size-4" />
<Button variant="destructive" size="icon"><Trash2 /></Button>
```

## Tokens de tema

Cores usam classes semânticas do shadcn (`text-muted-foreground`,
`bg-muted`, `text-destructive`, etc.), definidas em `src/app/globals.css`,
em vez de cores fixas do Tailwind (`text-gray-600`). Isso faz qualquer
mudança de tema (cor primária, modo escuro) valer pro projeto inteiro de
uma vez, sem precisar trocar componente por componente.
