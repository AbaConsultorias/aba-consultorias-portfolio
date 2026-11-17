# Segurança deste projeto

Leia antes de criar tabelas, rotas, variáveis de ambiente ou qualquer
coisa que lide com dado do usuário ou segredo (chave, token, webhook).

## A URL e a "publishable key" do Supabase aparecem no navegador. Isso é normal.

`NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` são
**públicas de propósito** — qualquer pessoa que abrir o site consegue ver
essas duas no código do navegador. O Supabase foi feito para funcionar
assim. **Isso não é uma falha de segurança.** (A publishable key substituiu
a antiga "anon key" — mesma função, nome novo.)

## A proteção de verdade é o RLS (Row Level Security)

Quem decide o que cada pessoa pode ler, criar, editar ou apagar no banco é
o **RLS**, configurado dentro do próprio Supabase (SQL) — não o front-end.

Regras fixas para este projeto:

1. **Toda tabela nova precisa ativar RLS na mesma migration em que é
   criada.** Sem RLS, qualquer pessoa com a URL e a publishable key do
   projeto (ou seja, qualquer visitante do site) pode ler e alterar a
   tabela inteira.
2. **Toda tabela com RLS ativado precisa de políticas explícitas.** Sem
   política, o padrão é negar tudo — ninguém enxerga nada, nem o dono dos
   dados.
3. **Nunca "desative o RLS pra funcionar".** Se uma função não está
   funcionando por causa de RLS, o problema é a política, não o RLS —
   ajuste a política.
4. **A regra não é "server-side pode usar a secret key".** A chave que
   importa não é sobre *onde* o código roda, é sobre *em nome de quem* a
   consulta deve valer:
   - **Publishable key + sessão do usuário** (é o que `src/lib/supabase/server.ts`
     já faz) → a consulta roda como aquele usuário logado, e o RLS continua
     protegendo. **Esse é o padrão pra qualquer rota que atende um usuário**
     (buscar/alterar dados do próprio usuário, etc).
   - **`secret key`** (substituiu a antiga `service_role key`) → ignora o
     RLS por completo, roda como administrador do banco. Só pode ser usada
     em tarefas que não pertencem a um usuário específico (cron job,
     webhook de outro serviço, painel de admin) — e nunca pode ir pro
     front-end. Usá-la "porque é servidor mesmo" tira a proteção do RLS e
     joga toda a responsabilidade de checar permissão pro código.

## `NEXT_PUBLIC_` vaza pro navegador — qualquer variável, não só as nossas

Toda variável de ambiente com prefixo `NEXT_PUBLIC_` é **compilada direto
no JavaScript enviado pro navegador**, sem exceção — não é uma proteção
que o Next.js aplica só nas variáveis "certas".

5. **Nunca prefixe uma variável sensível com `NEXT_PUBLIC_`.** Secret key
   do Supabase, token de API de terceiro, URL de webhook — todas ficam
   **sem** o prefixo, e só são lidas em código que roda no servidor
   (`service.ts`, `route.ts`, `proxy.ts`). Se aparecer `NEXT_PUBLIC_` na
   frente de qualquer coisa que não seja a URL ou a publishable key do
   Supabase, é bug — revise antes de continuar.

## Segredo novo? Vai pro `.env`, nunca pro código

6. **Nenhuma chave/segredo é escrito direto num arquivo `.ts`**, nem "só
   pra testar rápido". Um valor colado no código sobrevive no histórico
   do git mesmo depois de apagado numa alteração seguinte. Segredo novo
   → variável no `.env` (nunca commitado) + o nome (sem valor) no
   `.env.example`, e lido via `process.env` de dentro de código servidor.

## `schema.ts` é lista de permissão, não só validação

7. **O `service.ts` usa os dados já validados pelo `validation()`, nunca
   o corpo bruto da requisição.** O Zod descarta por padrão qualquer
   campo fora do schema — é isso que impede alguém de mandar `{ email,
   password, role: "admin" }` e conseguir setar um campo que não deveria
   existir na entrada. Essa proteção desaparece se o service repassar o
   `body`/`request` original em vez do retorno de `validation()`.

## Mensagem de erro não revela mais do que precisa

8. **Erros de autenticação usam mensagem genérica de propósito** (ver
   `src/lib/auth/login.ts`: "E-mail/usuário ou senha inválidos." serve tanto
   pra senha errada quanto pra e-mail inexistente, conta inativa ou área
   errada). Diferenciar os dois casos
   ajuda quem está atacando a descobrir quais e-mails têm conta. A mesma
   lógica vale pra qualquer fluxo novo do tipo "esqueci minha senha".

## Log não é lugar de segredo

9. **Antes de logar um objeto de erro inteiro (`console.error`),
   confirme que ele não carrega senha, token ou header de autorização.**
   Os logs já existentes em `src/lib/auth/login.ts`,
   `src/lib/rate-limit.ts` e `trocar-senha/service.ts` imprimem só o
   `code` e o `status` do erro (que não incluem a senha digitada) — siga
   esse padrão em logs novos.

## Webhook: confirme a origem antes de agir

10. **Uma rota que recebe webhook de outro serviço (Kirvano, Stripe,
    etc.) precisa confirmar que a chamada é real antes de processar.**
    Quando o serviço oferece assinatura de verificação (caso do Stripe),
    valide antes de agir. Quando não oferece — um webhook de saída
    simples, tipo mandar mensagem pro Discord — o segredo é a própria
    URL do webhook: trate-a como qualquer outro segredo (regra 6), nunca
    a exponha no front-end.

## Arquivos do Storage: caminho em coluna `text` terminada em `_path`

11. **Toda coluna que guarda caminho de arquivo do Storage deve ser
    `text` e terminar em `_path`.** A função `listar_objetos_orfaos`
    (migration `20261101100000_etapa6_orfaos.sql`) e o cron
    `/api/tarefas/limpar-orfaos` apagam, após 24 horas, todo arquivo que
    nenhuma coluna assim cita. Caminho guardado em outro tipo ou com outro
    nome (inclusive dentro de `jsonb` ou de array) faz o arquivo ser
    apagado como órfão: perda de dado real. Ver [DATABASE.md](./DATABASE.md).

## PDFs de documentos de cliente: Cloudflare R2

Os PDFs da tabela `documentos` ficam no R2 (balde privado, sem `r2.dev` e sem
domínio público), não no Supabase Storage. O código está em `src/lib/r2/cliente.ts`
(assinatura S3 v4 com `aws4fetch`) e `src/lib/portal/documentos/armazenamento.ts`.

- **Variáveis** (só servidor, nunca `NEXT_PUBLIC_`): `R2_ACCOUNT_ID`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` e `R2_BUCKET_DOCUMENTOS`. São
  validadas com Zod no primeiro uso; ausente ou inválida gera log só com o
  nome da variável e erro 500. A chave é restrita ao balde. Nunca logue URL
  assinada, chave ou token.
- **Envio**: o navegador faz `PUT` direto ao R2 numa URL pré-assinada de 5 min,
  para um único objeto, com `content-length`, `content-type: application/pdf`
  e `x-amz-checksum-sha256` assinados. O R2 recusa conteúdo ou tamanho
  diferentes do declarado. O SHA-256 vem do navegador (`assinarSchema`) e
  viaja dentro do comprovante assinado (HMAC); o servidor nunca confia nele
  sozinho: na confirmação faz `HEAD` (tamanho e checksum iguais aos do
  comprovante) e lê só os 5 primeiros bytes (`%PDF-`). Divergência apaga o
  objeto.
- **CORS do balde**: só `PUT`, com os cabeçalhos `content-type` e
  `x-amz-checksum-sha256`. O cliente do navegador não pode mandar nenhum outro.
- **Download**: a rota confere RLS e liberação e só então redireciona para um
  `GET` pré-assinado de 60 s, com o nome do arquivo derivado do título. O
  `downloads_log` não mudou.
- **CSP**: `connect-src` inclui `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`
  quando `R2_ACCOUNT_ID` está definida (32 hex).
- **Órfãos**: o R2 não aparece em `storage.objects`. O cron
  `/api/tarefas/limpar-orfaos` lista o balde, compara com
  `documentos.storage_path` e apaga objetos com mais de 24 h sem linha
  (resumo `r2-documentos`). Se a consulta ao banco falhar, nada é apagado. A
  regra 11 vale também aqui: o caminho do R2 fica em `documentos.storage_path`.
- **Limite por PDF**: 100 MB.

## Limite de tentativas (rate limit)

Quem tenta adivinhar senha é barrado pelo banco, não só pela tela. A função
`verificar_rate_limit` (migration base) guarda contagens na tabela
`rate_limits`, e `src/lib/rate-limit.ts` a chama. Os limites atuais:

- **Todo `/api`**, no `proxy.ts`: 120 requisições por minuto por IP. Se o
  banco cair, este limite deixa passar (o site continua no ar).
- **Login de usuário** (`entrar/service.ts`): 30 por hora por IP, e 5 a
  cada 15 minutos por IP + identificador, e 20 por hora por conta (sem IP,
  contra quem troca de IP a cada tentativa).
- **Login da equipe** (`adm-interno/entrar/service.ts`): 30 por hora por IP, 5 a cada 15
  minutos por IP + conta e 20 por hora por conta. O escritório sai por um IP só e toda entrada conta.
- **Limpeza de órfãos** (`tarefas/limpar-orfaos`): só com `CRON_SECRET`;
  sem ele, 404.
- **Troca de senha** (`trocar-senha/service.ts`): 5 a cada 15 minutos por
  usuário.

Nos logins, se a função falhar, a tentativa é **negada** (fail-closed).

O IP e o identificador entram no banco só como hash com sal (variável
`RATE_LIMIT_SALT`), pra `rate_limits` não guardar e-mail nem IP em claro.
Sem essa variável, a checagem lança erro em vez de rodar sem sal.

## Permissões das contas internas (Etapa 8)

Contrato: ETAPA-8-CONTRATO.md; levantamento e resoluções:
ETAPA-8-ANEXO-LEVANTAMENTO.md. Onde divergirem, valem o código e as
migrations `supabase/migrations/2026110[56]*`.

Conta interna é `profiles.papel = 'admin'` ou `'equipe'`. O admin tem tudo. A equipe só tem o que o admin
marcou na tela Equipe, e **conta nova começa sem nenhuma permissão**. O catálogo tem 22 permissões
(`site.ver`, `financeiro.editar`, `obras.aprovar`, `painel.servidor` etc.), definido em dois lugares que um
teste compara: `src/lib/auth/permissoes.ts` e `catalogo_permissoes()` no banco. `x.editar` exige `x.ver`; o
banco recusa a concessão sem o pré-requisito (trigger).

### As quatro camadas (todas obrigatórias)

| Camada | Como funciona |
|---|---|
| **Banco** (a barreira real) | Toda política de RLS e função interna usa `tem_permissao('...')`, com leitura e escrita separadas. As 5 políticas de `storage.objects` também. Nenhuma política nem função usa mais `e_staff()` (ver abaixo) |
| **Rotas** | Toda rota declara a regra de acesso na primeira instrução do handler. Sem regra, ela não compila |
| **Páginas** | Cada página e layout do admin confere a regra no servidor. Sem acesso: **404**, sem skeleton |
| **Menu** | `NavPortal` e `NavConteudo` mostram só o permitido. É conforto, não segurança |

Uma conta sem nenhuma permissão entra no painel e vê "sua conta ainda não tem áreas liberadas". O 404 vale
para as áreas sem permissão.

### `tem_permissao` e `minhas_permissoes`

- `tem_permissao(texto)` (security definer, `search_path` vazio): `true` para admin ativo; para equipe ativa,
  só se existir a linha em `equipe_permissoes`; o resto é `false`. Permissão fora do catálogo, nula, conta
  inativa e conta com troca de senha pendente dão `false` (vem de `papel_atual()`). Erro vale como negado.
- `minhas_permissoes()` devolve a lista da própria sessão (admin: o catálogo inteiro). É o que o servidor lê
  para páginas, menu e rotas (`obterMinhasPermissoes`, uma consulta por requisição).
- Quem desativa a conta corta o acesso na próxima consulta, porque `ativo` é lido a cada chamada.

### Guards no código

Os guards ficam em `src/lib/auth/permissoes-servidor.ts`; as regras, em `src/lib/auth/regras.ts`. Uma regra
é uma permissão, `"so-admin"`, `{ qualquer: [...] }` (basta uma das permissões) ou, nas rotas que atendem
também quem não é interno, `{ externos: [papéis], interna?: regra }`.

- **`autorizarPortal(acao, regra)`** (rotas do portal): a regra é **obrigatória, sem valor padrão**. Antes
  ela era `PAPEIS_STAFF`, ou seja, rota nova liberava toda a equipe. Também aplica o limite de taxa da ação.
- **`autorizarConteudo(regra)`** (rotas de conteúdo do site e contatos): mesma ideia, regra obrigatória.
- **`exigirRegraApi(regra)`** é o que os dois usam por baixo.
- **`exigirRegraPagina(regra)`**: para página e layout do admin; sem acesso, `notFound()`.
- **`exigirContaInterna()`**: só para layouts e telas que qualquer conta interna ativa abre (visão geral, layout
  do portal). Cada seção dentro delas confere a própria permissão e some inteira se não houver: uma consulta
  negada pelo RLS volta vazia e pareceria "nenhum registro".
- `exigirPapel` e `exigirPapelApi` (`guard.ts`) seguem existindo, mas só para sessão, papel e troca de senha
  pendente. Não use direto numa rota do admin: a varredura (abaixo) falha se aparecerem.

Downloads e fotos de arquivo privado têm uma regra por tipo (`REGRA_POR_TIPO` em
`src/lib/portal/comum/arquivos.ts`): papéis externos como antes, e a equipe precisa do `.ver` do módulo dono
do arquivo (por exemplo `documentos.ver` para documento). A conferência fica dentro de
`entregarArquivoPrivado`.

### Secret key: sempre depois do guard

`createAdminClient()` ignora o RLS, então quem protege é o código. Regra: a rota chama o guard
(`autorizarPortal`/`autorizarConteudo`) **antes** de ler o corpo, de criar qualquer client ou de chamar
`createAdminClient`/`validation`. A varredura confere isso.

Além disso, conferir a permissão na rota **antes** de apagar um arquivo e depois a linha. Sem isso, quem só
tem `ver` apagaria o arquivo e a linha ficaria apontando para o nada (`documentos/service.ts` e
`fornecedor/exclusao.ts`). Em upload, `assinar` e `confirmar` exigem a permissão `.editar`.

### Escrita em bucket privado: sem política, só por rota

`documentos`, `obras` e `fornecedores` não têm política de INSERT, UPDATE nem DELETE em `storage.objects`:
**quem grava é sempre a secret key, dentro de uma rota**. Aqui a barreira não é o banco, é o código da rota
(exceção ao "o banco é a barreira real"), e cada rota tem teste. Só há política de leitura (por permissão
`.ver`; no bucket `obras`, pelo prefixo do caminho: `relatos/` pede `obras.ver` e `atualizacoes/` pede
`atualizacoes.ver`) e, no `site-publico`, de leitura (`site.ver`) e de apagar (`site.editar`).

### Colunas que o RLS não separa: triggers

O RLS decide por linha, não por coluna. Para o que precisa de permissão própria, há triggers que recusam a
mudança de quem não tem a permissão. Todos deixam passar quem não roda como `anon`/`authenticated` (secret
key, migration, script, função definer), por isso a rota que usa a secret key confere a permissão no código.

| Trigger | O que protege | Quem pode |
|---|---|---|
| `empreendimentos_proteger_liberacao` | `liberacao_automatica` e, com ela ligada (antes ou depois), `codigo_pasta` (D5) | só admin; `codigo_pasta` desligado: `servidor.regras` |
| `configuracoes_conector_proteger_liberacao` | `liberacao_automatica_geral` | só admin |
| `pasta_regras_proteger_liberacao` | criar, alterar ou apagar regra com `liberar_automatico` ligado | só admin; regra desligada: `servidor.regras` |
| `documentos_proteger_liberacao` | `liberado_cliente` (incluindo criar já liberado); as demais colunas pedem `documentos.editar` | `documentos.liberar` |
| `obras_proteger_aprovacao` | `percentual` e `situacao` da obra, que o cliente vê | `obras.aprovar` |

Os interruptores de liberação automática são só do admin porque, ligados, o conector publica sozinho para o
cliente. Apagar empreendimento, contrato e cadastro de fornecedor também é só do admin (o `DELETE` leva
vínculos em cascata). `revisar_relato_obra` é security definer e confere `obras.aprovar` no corpo.

### Contas internas: último admin, desativação e promoção

- **Último admin:** o trigger `profiles_proteger_ultimo_admin` recusa desativar, rebaixar ou apagar o último
  admin ativo, para qualquer papel de banco, inclusive a secret key. Hoje existe 1 admin; o segundo (D2) segue
  pendente (ver PLANO.md).
- **Desativar conta:** a tela Equipe marca `ativo = false` e **bloqueia o usuário no Auth** (`ban_duration`),
  o que encerra as sessões. Reativar tira o bloqueio. Conta nunca é apagada, para manter a auditoria.
- **Ninguém se promove:** `profiles.papel`, `profiles.ativo` e `equipe_permissoes` só mudam pelo admin. A tela
  Equipe cria só `equipe` (o papel vem do código, nunca do corpo) e **não cria admin**: admin novo é por
  `scripts/criar-admin.mjs`. `clientes.editar` cria só cliente, `obras.editar` só empreiteiro,
  `fornecedores.editar` só fornecedor.
- Toda concessão e remoção de permissão vai para `auditoria`, com o ator vindo do banco.
- A senha temporária é mostrada uma única vez e a troca é obrigatória no primeiro acesso.

### `e_staff()` ainda existe, mas nenhuma política a usa

A função continua no banco, sem uso em política, função ou view. O teste `etapa8_sem_e_staff.sql` falha se
alguma voltar a citá-la, e a última migration de RLS também falha se restar alguma. **Não use `e_staff()` em
código novo**: ela vale "qualquer conta interna", que é exatamente o que a Etapa 8 tirou.

### Como adicionar uma rota ou tabela nova sem abrir brecha

**Rota nova do admin ou do portal:**
1. Escolha (ou crie, no catálogo) a permissão do módulo. Leitura pede `.ver`; gravar pede `.editar`.
   Algo que só o admin deve fazer usa `"so-admin"`.
2. A primeira instrução do handler é `autorizarPortal(acao, regra)` ou `autorizarConteudo(regra)`.
   Só depois vêm `lerJsonLimitado`, `createClient`, `createAdminClient` e `validation`.
3. Rota que não é do admin (pública, cron, conector, conta própria como `trocar-senha`) entra na lista
   explícita de `scripts/testar-permissoes-rotas.mjs`, com o motivo. Sem isso o teste falha.
4. Se a rota usa a secret key, a permissão do código é a única barreira: escreva o teste de negado.
5. Inclua a rota na tabela de `scripts/testar-permissoes-http.mjs`.
6. Se for permissão nova: `src/lib/auth/permissoes.ts`, `catalogo_permissoes()` no banco (migration nova,
   nunca editar uma antiga), pré-requisitos nos dois lados, e rode `testar-permissoes-catalogo.mjs`.

**Tabela nova:** RLS ligado na mesma migration e, em cada política, `tem_permissao('módulo.ver')` para ler e
`'módulo.editar'` para escrever, nunca `e_staff()`. Se a tabela tem uma coluna que exige permissão diferente
da do resto da linha, crie um trigger como os da tabela acima, com o desvio por `current_user`. Tela que só
precisa do **nome** de outro módulo usa as funções que devolvem só nome ou id/nome (`nome_empreendimento`,
`nome_pessoa`, `nome_fornecedor`, `opcoes_*`), nunca abre a tabela inteira. Atualize o teste de matriz em
`supabase/tests/` e crie a reversão em `supabase/reversoes/` (ver [DATABASE.md](./DATABASE.md)).

### Como testar

Tudo abaixo pela raiz do projeto:

```bash
node scripts/testar-permissoes-catalogo.mjs    # catálogo do código = catálogo do banco
node scripts/testar-permissoes-selecao.mjs     # caixas de permissão da tela Equipe
node scripts/testar-regras-acesso.mjs          # regras de acesso (regras.ts)
node scripts/testar-permissoes-rotas.mjs       # varredura estática de rotas, páginas e layouts
```

A varredura de rotas não precisa do site no ar. Ela percorre `src/app/api` inteiro e as páginas e layouts de
`src/app/adm-interno/(protegido)`, e falha se: uma rota não declara a regra (a não ser que esteja na lista
explícita de públicas, cron, conector e conta própria); `PAPEIS_STAFF`, `exigirPapelApi` ou `ehStaff` aparecem
numa rota do admin; ou há leitura de corpo, `createClient`, `createAdminClient` ou `validation` antes do guard.

**Matriz HTTP** (conta × método × rota, e conta × página), contra o site local, que usa o banco de produção:

```bash
node --env-file=.env scripts/testar-permissoes-http.mjs   # com o site em localhost:3000; PAGINAS=0 pula as páginas
node --env-file=.env scripts/testar-equipe-http.mjs       # tela Equipe de ponta a ponta
```

Ambos criam contas temporárias com nome "Teste E8 ...", usam só UUIDs que não existem e corpos inválidos de
propósito, e apagam as contas no fim. Precisam de `ADMIN_PATH`, `NEXT_PUBLIC_SUPABASE_URL` e
`SUPABASE_SECRET_KEY` no `.env`.

**SQL** (usuário `postgres`; cada arquivo termina em `ROLLBACK` e imprime `OK`):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa8_permissoes.sql
```

Os arquivos da Etapa 8 são `etapa8_permissoes.sql`, `etapa8_contas_internas.sql`, `etapa8_opcoes.sql`,
`etapa8_rls_clientes_financeiro.sql`, `etapa8_rls_andamento_obras.sql`,
`etapa8_rls_documentos_servidor_site.sql` e `etapa8_sem_e_staff.sql` (nenhuma política nem função usa
`e_staff()`, e a equipe com as 22 permissões não consegue se promover). Cada arquivo traz no topo o comando
exato; também aceitam `npx.cmd supabase db query --linked -f <arquivo>`.

### Exceções e riscos aceitos

- **Chave dos comprovantes de upload.** O comprovante assinado (HMAC) que liga `assinar` a `confirmar`
  (`src/lib/portal/comum/upload.ts`) usa a própria secret key como chave. Quem vazar a secret key já tem acesso
  total ao banco, então o HMAC não piora; mesmo assim, ela não tem chave própria.
- **`validar_vinculos_portal` e os triggers de `equipe_permissoes` são security definer**, porque precisam
  enxergar linhas de outro módulo. Consequência: quem **já conhece os UUIDs** envolvidos descobre, pela mensagem
  de erro, se um vínculo é válido. Isso não permite gravar nada e não lista dados. Os triggers de permissões
  recusam quem não é admin antes de qualquer leitura, para as mensagens não revelarem nada.
- **Escrita em bucket privado sem política**: explicada acima; o controle é o código da rota.
- **`apagarArquivo` de `site-publico`** não confere se o arquivo ainda está em uso. Já era assim antes da
  Etapa 8 e não piorou.
- **Funções sem uso** (`liberar_revisao_documento`, o `EXECUTE` de `validar_lista_portal`) ficaram, só com a
  checagem trocada.
- **Uso do R2**: a rota `portal/conector/uso` exige `painel.servidor` antes de qualquer leitura, inclusive
  do cache em memória do uso do R2 (`uso-r2.ts`), que é por instância.

## Ao criar o projeto no Supabase

Na criação do projeto, ative a opção **"Enable automatic RLS"**. Ela cria
um trigger no banco que liga o RLS sozinho em qualquer tabela nova do
schema `public` — mesmo que a migration esqueça de fazer isso. Não
substitui a regra 2 (você ainda precisa escrever as políticas), mas
garante que uma tabela nova nasce trancada por padrão, nunca aberta.

## Se você é a IA lendo isto

Antes de considerar qualquer tarefa concluída, confira contra as 11
regras acima — nenhuma delas é opcional, mesmo que o pedido não
mencione segurança:

- **Tabela nova** → siga exatamente o padrão de
  `supabase/migrations/20261027120000_etapa1_base.sql`: crie a tabela,
  ative o RLS na mesma migration, escreva as políticas, e nomeie o
  arquivo com timestamp (`AAAAMMDDHHMMSS_nome.sql`, idealmente via
  `npx supabase migration new`) — sem isso o Supabase ignora a migration
  silenciosamente, ver [DATABASE.md](./DATABASE.md).
- **Variável de ambiente nova** → só leva `NEXT_PUBLIC_` se for
  literalmente pra aparecer no navegador (regra 5); nunca escrita direto
  no código (regra 6).
- **Rota nova que grava no banco** → usa o retorno de `validation()`,
  nunca o `body` bruto (regra 7).
- **Rota, página ou política nova do admin** → declara a permissão do
  catálogo (`autorizarPortal`/`autorizarConteudo`/`exigirRegraPagina`,
  `tem_permissao` no banco), nunca `e_staff()` nem um guard por papel.
  Passo a passo em "Permissões das contas internas".
- **Mensagem de erro nova** → não revela mais do que o necessário
  (regra 8), e nenhum `console.error` carrega senha ou token (regra 9).
- **Rota que recebe webhook** → confirma a origem antes de agir
  (regra 10).
- **Coluna nova com caminho de arquivo do Storage** → `text` e nome
  terminado em `_path` (regra 11), senão a limpeza de órfãos apaga o
  arquivo.
