# Banco de Dados (Supabase)

## Visão geral

PostgreSQL hospedado no Supabase. Sem ORM — o acesso ao banco é feito
direto pelo client do Supabase (`@supabase/ssr` / `@supabase/supabase-js`)
dentro do `service.ts` de cada módulo.
sobre a decisão de não ter uma camada de repository.

**Antes de continuar, leia [SECURITY.md](./SECURITY.md)** — toda tabela
nova tem uma regra obrigatória de RLS (Row Level Security). Este
documento não repete essas regras, só mostra onde e como aplicá-las.

## Clients

```typescript
// src/lib/supabase/client.ts — Client Components (navegador)
import { createClient } from "@/lib/supabase/client";

// src/lib/supabase/server.ts — Server Components e API routes (route.ts)
import { createClient } from "@/lib/supabase/server";
const supabase = await createClient(); // lê a sessão do usuário via cookies

// src/lib/supabase/admin.ts — só servidor, com a secret key (ignora o RLS)
import { createAdminClient } from "@/lib/supabase/admin";
```

Os dois primeiros usam a **publishable key** (pública, respeita RLS). O
terceiro usa a **secret key** e só é usado em tarefas que não pertencem a
um usuário: rate limit e troca de senha (com a atualização do perfil). O
script `scripts/criar-admin.mjs` monta o próprio client com a secret key,
fora do código da aplicação. Nunca crie um client com a **secret key**
fora de uma tarefa assim (ver regra 4 do [SECURITY.md](./SECURITY.md)).

## Autenticação (`auth.users`)

O login usa a tabela `auth.users` do Supabase Auth — pronta, gerenciada
pelo próprio Supabase. Você não precisa (e não deve) criar uma tabela
`users` própria só para autenticação.

Não há cadastro público: as contas são criadas pela equipe. Os dados extras
de cada conta ficam na tabela `profiles` (papel, nome, ativo, troca de
senha pendente), com uma foreign key pra `auth.users(id)`. Os papéis estão
definidos no enum `papel_usuario`.

Se precisar de mais dados por usuário (avatar, preferências), crie uma
tabela separada, com uma foreign key pra `auth.users(id)`, do mesmo jeito.

## Migrations

Ficam em `supabase/migrations/`. **O nome do arquivo precisa começar com
um timestamp** no formato `AAAAMMDDHHMMSS_nome.sql` (ex:
`20261027120000_etapa1_base.sql`) — sem isso, o CLI do Supabase
**ignora o arquivo silenciosamente** ao rodar `db push`, sem erro
nenhum. Use `npx supabase migration new nome_da_tabela` pra gerar o
arquivo com o timestamp certo automaticamente, em vez de criar o `.sql`
na mão.

Cada migration que cria uma tabela **precisa** ativar RLS e escrever as
políticas na mesma migration. A migration base do projeto é um exemplo
real: `supabase/migrations/20261027120000_etapa1_base.sql` cria os papéis,
`profiles`, as funções de papel e o rate limit, com RLS ativado em cada
tabela e os `grant`/`revoke` explícitos. A explicação das regras está em
[SECURITY.md](./SECURITY.md).

O trecho abaixo mostra só o formato de uma tabela com RLS. A tabela `itens`
é ilustrativa e não existe no projeto:

```sql
create table if not exists public.itens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) not null,
  title text not null,
  created_at timestamptz not null default now()
);

alter table public.itens enable row level security;

create policy "itens são públicos para leitura"
  on public.itens for select using (true);

create policy "usuário autenticado insere seus próprios itens"
  on public.itens for insert to authenticated
  with check (auth.uid() = user_id);
```

### Coluna que guarda caminho de arquivo do Storage

**Toda coluna que guarda o caminho de um arquivo do Storage deve ser do
tipo `text` e ter o nome terminando em `_path`** (`capa_path`,
`storage_path`, `video_path`...). Não é só convenção: a função
`listar_objetos_orfaos` (migration `20261101100000_etapa6_orfaos.sql`)
monta a lista de arquivos "em uso" olhando exatamente as colunas `text`
de `public` cujo nome termina em `_path`. O cron
`/api/tarefas/limpar-orfaos` apaga do bucket qualquer arquivo com mais de
24 horas que **nenhuma** dessas colunas cite. Uma coluna com outro nome ou
outro tipo (`varchar`, `text[]`, `jsonb`) é invisível para a limpeza, e os
arquivos dela são apagados em até um dia, sem aviso. Colunas `_path`
novas entram sozinhas na conta, sem mexer na função.

## Documentos do servidor (Etapa 7)

Migration `20261103100000_etapa7_conector.sql`; contrato em ETAPA-7-CONTRATO.md §4.
O programa no servidor da empresa propõe PDFs pela API do conector (secret key, sem sessão de usuário).

| Tabela / coluna | O que é | Quem acessa |
| --- | --- | --- |
| `empreendimentos.codigo_pasta` | 6 dígitos, único, opcional: prefixo da pasta do empreendimento no servidor | equipe (o cliente lê a linha do próprio empreendimento) |
| `empreendimentos.liberacao_automatica` | interruptor do empreendimento (padrão `false`) | idem |
| `documentos.grupo` | `contratos`, `orcamentos` ou `arquivo` (este com `pasta_rotulo`, o nome do cartão em "Outros projetos"; ver PASTAS-SES-ARQUIVO-CONTRATO.md); só com `projeto_id` nulo | como `documentos` |
| `documentos.substitui_id` | revisão nova de um arquivo já enviado (aponta a anterior) | como `documentos` |
| `documentos.familia_id` | família de revisões: o próprio id na v1, herdado da anterior nas revisões; preenchido por trigger e imutável | como `documentos` |
| `pasta_regras` | pasta do servidor → projeto (+categoria) ou grupo (`contratos`, `orcamentos` ou `arquivo` com `rotulo` obrigatório); `liberar_automatico`, `ativa` | equipe lê e escreve |
| `configuracoes_conector` | linha única: `liberacao_automatica_geral` | equipe lê e liga/desliga |
| `conectores` | chave de servidor (`token_hash` = sha256), `revogado_em`, `ultimo_contato_em`, `ultimo_ciclo`, `arvore` | equipe lê (menos `token_hash`); admin emite e revoga |
| `documento_origens` | de onde veio o documento (`caminho_relativo`, `tamanho`, `sha256`, `mtime`) | equipe lê; escrita só pela API |
| `conector_envios` | cada autorização de envio (`estado`) e base dos limites diários | equipe lê; escrita só pela API |

- **`token_hash` não é legível por nenhum usuário logado.** O acesso a `conectores` é por privilégio de
  coluna: `select *` falha para `authenticated`, então liste as colunas. Só a secret key lê o hash.
- **No máximo um conector ativo** (índice parcial em `revogado_em is null`): para emitir uma chave nova,
  revogue a anterior antes. Uma revogação não se desfaz e o hash não troca (trigger).
- **`caminho_relativo` e `caminho_prefixo` são caminhos no servidor da empresa**, não de arquivo do
  Storage/R2, por isso não terminam em `_path` (ver a regra acima). Têm de estar em NFC, sem segmento
  vazio, `.` ou `..`, sem `:`; as regras ainda recusam os nomes da lista de bloqueio (`DADOS DO
  EMPREENDEDOR`, `COMPROVANTE`, `NOTAS FISCAIS`, `PLANILHA`).
- **Duplicado:** índice único parcial `(empreendimento_id, sha256)` onde `estado = 'confirmado'`.
- **Revisões:** a política de leitura do cliente em `documentos` não mudou. Quando uma versão passa a
  `liberado_cliente = true`, o trigger `documentos_ocultar_versoes_irmas` oculta, na mesma instrução, as
  outras versões da mesma família (`familia_id`), seja por UPDATE, por INSERT já liberado (liberação
  automática) ou pela função `liberar_revisao_documento(p_documento uuid)` (só equipe, idempotente).
  A família sobrevive à exclusão de uma versão do meio, e liberações da mesma família são serializadas por
  `pg_advisory_xact_lock` (migration `20261103110000_etapa7_familia_revisoes.sql`).
- **Contratos e orçamentos** do empreendimento são linhas de `documentos` com `projeto_id` nulo e `grupo`
  preenchido; o cliente os lê pela mesma política (`liberado_cliente`).
- **Envios** (migration `20261104100000_etapa7_envios.sql`): `conector_envios` ganhou `storage_path` (chave
  planejada no R2, `<empreendimento_id>/<documento_planejado_id>.pdf`), `documento_planejado_id` (o id que o
  documento terá; sem FK porque ainda não existe), `mtime` e `confirmado_em`, mais um índice do último envio
  confirmado por `lower(caminho_relativo)`. Quem escreve é só a API do conector.
- Testes: `supabase/tests/etapa7_conector_rls.sql`, `supabase/tests/etapa7_revisoes.sql`,
  `supabase/tests/etapa7_familia_revisoes.sql` e `supabase/tests/etapa7_envios.sql`.

## SIMOS e Laudos por equipamento

Migration `20261110100000_simos_laudos.sql` (reversão em `supabase/reversoes/`). Contrato:
SIMOS-LAUDOS-CONTRATO.md. Só aditiva; nenhuma política de RLS mudou.

- `pasta_regras.tipo` (`comum` | `equipamentos`, padrão `comum`). A regra `equipamentos` exige `projeto_id`, sem
  `categoria_id` nem `grupo`, e o trigger `validar_pasta_regra` exige que o projeto tenha as categorias `SIMOS` e
  `Laudos` (sem diferenciar caixa).
- `documentos.equipamento` (1 a 160 caracteres, sem controle) e `documentos.equipamento_papel` (`simo` | `laudo`):
  os dois nulos ou os dois preenchidos; preenchidos exigem `projeto_id` e `categoria_id` (consequência: apagar o
  projeto ou a categoria de um SIMO/Laudo é recusado; apague os documentos antes).
- `confirmar_envio_conector` ganhou `p_equipamento` e `p_papel` (a assinatura de 5 parâmetros foi removida). A API
  classifica o caminho (`src/lib/conector/equipamentos.ts`); o banco escolhe a categoria pelo papel
  (`SIMOS` ou `Laudos` do projeto da regra) e nunca confia no chamador. Revisão herda o equipamento e exige o mesmo
  papel. Situação nova: `sem_categoria`.
- O SIMO não tem download para o cliente (`/api/portal/documentos/[id]/download` responde 404); ele só o visualiza
  em `/api/portal/documentos/[id]/visualizar`, que devolve uma URL assinada de 60 s.
- Teste: `supabase/tests/simos_laudos.sql`.

## Ordem dos projetos

Migration `20261110110000_ordem_projetos.sql` (reversão em `supabase/reversoes/`). Só aditiva; nenhuma política de RLS
mudou (o UPDATE da ordem passa pela política `empreendimentos.editar atualiza projetos`).

- `projetos.ordem` (`integer not null default 0`, `check (ordem >= 0)`, índice `(empreendimento_id, projeto_pai_id, ordem)`):
  posição do projeto entre os **irmãos** (mesmo empreendimento e mesmo `projeto_pai_id`; as raízes são irmãs entre si).
  O admin define; o cliente vê nessa ordem. Toda leitura de projetos para o cliente ou para a árvore do admin ordena por
  `ordem`, `nome`, `id`. Os valores existentes foram preenchidos em ordem alfabética por irmãos, então nada mudou de lugar.
- `criar_projeto_de_modelo` grava `ordem = max(ordem dos irmãos) + 1` (0 se não há irmãos). O trigger
  `projetos_ordem_ao_mudar_pai` faz o mesmo quando `projeto_pai_id` muda, inclusive quando o pai é excluído (os
  dependentes viram raízes no fim das raízes, em ordem não garantida entre si). Dois projetos criados ao mesmo tempo podem
  ficar com a mesma `ordem`: o desempate é por nome e id.
- `reordenar_projetos(p_empreendimento, p_pai, p_ids)`: security **invoker**, exige `tem_permissao('empreendimentos.editar')`
  (`42501`), confere que `p_ids` são exatamente os irmãos daquele pai (sem faltar, sobrar nem repetir; `22023`), trava as
  linhas e grava `ordem` = posição na lista (0, 1, 2...). Só as linhas que mudaram são gravadas (e auditadas). Rota:
  `POST /api/adm-interno/portal/projetos/ordem`.
- Teste: `supabase/tests/ordem_projetos.sql`.

## Permissões das contas internas (Etapa 8)

Migrations `20261105100000` a `20261106130000` (sete arquivos `etapa8_*`). Contrato:
ETAPA-8-CONTRATO.md. As regras de uso e o passo a passo para rota ou tabela nova
estão em [SECURITY.md](./SECURITY.md), seção "Permissões das contas internas".

### Tabela `equipe_permissoes`

`id`, `profile_id` (→ `profiles`, `on delete cascade`), `permissao`, `concedida_por`, `concedida_em`; único em
`(profile_id, permissao)`. `permissao` tem CHECK contra `catalogo_permissoes()` (22 itens).

- RLS: o admin lê, concede (insert) e remove (delete); cada pessoa lê só as próprias linhas. Não há UPDATE
  para ninguém: a linha é imutável (o trigger só aceita o `set null` de `concedida_por` quando o admin que
  concedeu deixou de existir).
- Triggers: `validar_insercao_equipe_permissao` (só admin, só conta `equipe`, pré-requisito presente,
  preenche `concedida_por`/`concedida_em`), `validar_remocao_equipe_permissao` (não remove o que outra
  permissão ainda exige), `bloquear_alteracao_equipe_permissao` e `registrar_auditoria`. Os de inserção e de
  remoção são security definer; o primeiro recusa quem não é admin antes de ler qualquer coisa.

### Funções novas

| Função | O que faz |
|---|---|
| `catalogo_permissoes()`, `prerequisitos_permissao(texto)` | Catálogo e dependências (`x.editar` exige `x.ver`; `documentos.liberar`, `obras.aprovar` e `servidor.regras` também têm pré-requisito). Imutáveis; o código tem a mesma lista em `src/lib/auth/permissoes.ts` |
| `tem_permissao(texto)` | Security definer. Admin ativo: `true`; equipe ativa: só com a linha; o resto, `false`. É o que toda política usa, sempre como `(select public.tem_permissao('...'))` |
| `minhas_permissoes()` | Lista da própria sessão (admin: o catálogo todo) |
| `listar_contas_internas()` | Só admin; junta `profiles`, `auth.users` (e-mail, último acesso) e as permissões |
| `salvar_permissoes_equipe(uuid, text[])` | Só admin; security **invoker** de propósito, para passar pelo RLS e pelos triggers. Troca a lista inteira numa chamada só |
| `opcoes_empreendimentos()` (`id, nome, cidade`), `opcoes_fornecedores()` (`id, nome, ativo`), `opcoes_loteamentos()` (`id, nome`) | Listas para seletores, security definer. Quem tem o módulo escolhe sem abrir a tabela de outro módulo. Cada uma exige uma das permissões `.ver` relacionadas |
| `projeto_tem_vinculos(uuid)` | Diz se o projeto ainda tem documentos ou atualizações ligados (os dois ficam soltos com `on delete set null`). Serve a quem edita projetos e pode não enxergar esses módulos. Substitui `projeto_tem_documentos` |
| `nome_empreendimento`, `nome_pessoa`, `nome_fornecedor` | Reescritas: devolvem só o nome, conforme a permissão. `nome_pessoa` mostra nome de admin e de equipe só ao admin |
| `pode_ver_empreendimento` | `empreendimentos.ver` ou `documentos.ver` ou cliente do empreendimento |

Também passaram a usar `tem_permissao` no corpo: `excluir_item_financeiro_portal`, `criar_projeto_de_modelo`,
`salvar_etapas_projeto_portal`, `salvar_modelo_portal`, `validar_lista_portal`, `revisar_relato_obra`
(agora security definer, exige `obras.aprovar`), `liberar_documento_do_servidor` e `liberar_revisao_documento`
(`documentos.liberar`). Função security definer confere a permissão **no corpo**, porque o RLS não vale dentro
dela.

### Triggers novos

| Trigger | Tabela | Protege |
|---|---|---|
| `profiles_proteger_ultimo_admin` | `profiles` | não deixa desativar, rebaixar ou apagar o último admin ativo (lock fixo, vale até para a secret key) |
| `empreendimentos_proteger_liberacao` | `empreendimentos` | `liberacao_automatica` e `codigo_pasta` |
| `configuracoes_conector_proteger_liberacao` | `configuracoes_conector` | `liberacao_automatica_geral` |
| `pasta_regras_proteger_liberacao` | `pasta_regras` | regra com `liberar_automatico` |
| `documentos_proteger_liberacao` | `documentos` | `liberado_cliente` (`documentos.liberar`) e demais colunas (`documentos.editar`) |
| `obras_proteger_aprovacao` | `obras` | `percentual` e `situacao` (`obras.aprovar`) |

Os cinco últimos só valem para `anon`/`authenticated` (`current_user`): secret key, migration, script e ação
de chave estrangeira passam direto. Quem escreve por esses caminhos confere a permissão no código.
`validar_vinculos_portal` passou a security definer na migration `20261106110000`.

### Políticas e storage

Toda política de `public` e as 5 de `storage.objects` usam `tem_permissao(...)`, separando leitura e
escrita. Leituras de cliente, empreiteiro e fornecedor ficaram como estavam. Só o admin apaga empreendimento,
contrato e cadastro de fornecedor. `profiles` é lido por tipo de conta: cliente com `clientes.ver`,
empreiteiro com `obras.ver`, fornecedor com `fornecedores.ver`; contas internas, só o admin (e cada pessoa
lê a própria linha).

**`e_staff()` continua existindo**, mas nenhuma política, função ou view a usa. O fim de
`20261106130000_etapa8_rls_documentos_servidor_site.sql` falha a migration se sobrar alguma, e
`supabase/tests/etapa8_sem_e_staff.sql` confere o mesmo.

### Reversões: `supabase/reversoes/`

Cada migration da Etapa 8 tem um `.down.sql` com o mesmo timestamp. Ficam **fora** de `migrations/` de
propósito, para o `db push` nunca aplicá-los sozinho. Para reverter à mão:

1. Faça um backup antes: `node --env-file=.env scripts/backup.mjs --so-banco`.
2. Reverta na ordem **inversa** da aplicação, uma por vez, com o usuário `postgres`:
   `20261106130000` → `20261106120000` → `20261106110000` → `20261106100000` → `20261105120000` →
   `20261105110000` → `20261105100000`.
3. Cada arquivo: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/reversoes/<timestamp>_<nome>.down.sql`
   (ou colar no SQL Editor).
4. As três reversões de RLS devolvem as políticas e funções ao texto de produção guardado em
   `docs/etapa8-estado-banco-antes-rls.json`.
5. Reverter as de RLS devolve o acesso de `e_staff()`: toda conta de equipe volta a ver quase tudo, e as
   permissões deixam de ser a barreira real no banco (as rotas continuam conferindo no código).
6. `20261105100000` e `20261105110000` falham no `DROP` se ainda houver política, função ou rota usando o que
   elas criaram (por isso a ordem inversa). Desfazer `20261105110000` tira a proteção do último admin.
7. A tabela `auditoria` mantém as linhas antigas.

## Testes de RLS

Os testes da Etapa 8 (`supabase/tests/etapa8_*.sql`) seguem o mesmo formato e estão listados em
[SECURITY.md](./SECURITY.md), seção "Como testar". O `etapa8_sem_e_staff.sql` também falha se alguma política
ou função voltar a citar `e_staff()`.

`supabase/tests/etapa1_rls.sql` testa as políticas da migration base. Ele
cria contas fictícias dentro de uma transação, faz as verificações e termina
em `ROLLBACK`, então nada fica no banco. Se alguma verificação falhar, o
script para com `FALHA: ...`. Se chegar ao fim, imprime `OK` no último
select.

Rode com o usuário `postgres`, colando o arquivo no SQL Editor do Supabase
ou pelo `psql`:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa1_rls.sql
```

Rode esse script sempre que mexer em políticas, funções de papel ou em
`profiles`.

## Aplicando migrations

Duas formas, escolha uma:

**CLI do Supabase** (recomendado — mantém histórico de migrations no
banco):

```bash
npm install supabase --save-dev   # só na primeira vez
npx supabase login                # autentica (abre o navegador)
npx supabase link                 # escolhe o projeto remoto (pede o project ref)
npx supabase db push              # aplica os arquivos de supabase/migrations/
```

**Colar direto no painel**: Dashboard do Supabase → SQL Editor → cola o
conteúdo do `.sql` → Run. Mais rápido pra testar uma vez, mas não fica
registrado no histórico de migrations do banco.

De qualquer forma, o arquivo `.sql` correspondente fica salvo em
`supabase/migrations/` pra manter o histórico versionado no código.

## Padrões comuns

Os exemplos abaixo usam a tabela ilustrativa `itens` (ver acima).

### Buscar com o usuário da sessão (RLS aplica sozinho)

```typescript
const { data, error } = await supabase
  .from("itens")
  .select("*");
// o RLS já filtra pelo que a policy permite pro usuário atual —
// não precisa (e não deve) repetir esse filtro manualmente aqui
```

### Criar

```typescript
const { data, error } = await supabase
  .from("itens")
  .insert({ title, user_id: user.id })
  .select()
  .single();
```

### Atualizar

```typescript
const { error } = await supabase
  .from("itens")
  .update({ title })
  .eq("id", itemId);
```

### Apagar

```typescript
const { error } = await supabase.from("itens").delete().eq("id", itemId);
```

Em todos os casos acima, `error` não é uma instância de `HttpError` — o
`service.ts` deve tratá-lo e lançar o `HttpError` apropriado (ver
[API-OVERVIEW.md](./API-OVERVIEW.md)).
