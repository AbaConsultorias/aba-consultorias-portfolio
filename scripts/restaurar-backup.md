# Backup e restauração

Guia para o dono. O backup guarda duas coisas: o **banco** (contas, obras, financeiro, textos do site)
e os **arquivos** (fotos, PDFs, contratos, vídeos). Os dois ficam numa pasta no seu computador.

## 1. Preparar (uma vez só)

1. Instale o **cliente do PostgreSQL 17** para Windows: <https://www.postgresql.org/download/windows/>.
   No instalador, marque só **Command Line Tools** (não precisa do servidor).
2. Coloque a pasta `bin` dele no PATH do Windows (normalmente `C:\Program Files\PostgreSQL\17\bin`).
   Abra um terminal novo e confira: `pg_dump --version` deve mostrar a versão 17.
3. No `.env` do projeto, preencha:
   - `SUPABASE_DB_URL`: no painel do Supabase, **Connect** > **Session pooler** > copie a string de
     conexão e troque `[YOUR-PASSWORD]` pela senha do banco. Se a senha tiver caracteres especiais,
     troque-os pelo código deles (`@` vira `%40`, `#` vira `%23`, `/` vira `%2F`).
   - `BACKUP_DIR` (opcional): a pasta onde os backups ficam. Se deixar vazio, vai para `..\backups-aba`,
     ao lado da pasta do projeto. Prefira um lugar que também tenha cópia (um HD externo, por exemplo), mas leia o
     aviso logo abaixo sobre onde **não** guardar.
     A pasta precisa ficar **fora** da pasta do projeto: se `BACKUP_DIR` apontar para dentro dela, o
     script não roda (o backup acabaria indo para o git).
   - **Cuidado com onde guardar:** o backup **não é criptografado**. Quem abrir a pasta lê os dados de
     clientes, contratos e as contas. Não deixe a pasta numa área sincronizada com a nuvem (OneDrive,
     Google Drive, Dropbox, **Área de Trabalho** e **Documentos** do Windows costumam sincronizar sozinhas)
     nem num pen drive solto. Prefira um disco com **BitLocker** ligado (HD externo ou outra unidade do
     PC) e guarde o HD em lugar seguro.

## 2. Fazer um backup

No terminal, dentro da pasta do projeto:

```
node --env-file=.env scripts/backup.mjs
```

Opções: `--so-banco` (só o banco), `--so-arquivos` (só os arquivos e o espelho do R2), `--so-r2` (só o
espelho do R2) e `--sem-r2` (tudo, menos o espelho do R2).

Cada execução cria uma pasta `AAAA-MM-DD_HHmm` (ex.: `2026-11-08_2200`) com:

- `banco.dump`: o banco inteiro;
- `arquivos\<bucket>\...`: os arquivos, com as mesmas pastas e nomes do Supabase;
- `manifesto.json`: data, quantidades, tamanhos e uma "impressão digital" (sha256) de cada arquivo, mais
  o resumo do espelho dos PDFs do portal (campo `r2`, veja 4.5).

Os PDFs do portal (R2) não ficam dentro dessa pasta: vão para `r2-espelho\<balde>\<chave>`, ao lado dos
backups, e não entram na rotação abaixo.

Só os **14 backups completos mais novos** ficam guardados; os completos mais antigos são apagados
sozinhos, e o completo mais recente nunca é apagado. Backups parciais (`--so-banco` ou `--so-arquivos`)
não contam nesses 14 e só são apagados depois de 30 dias. Se o script terminar com erro, ele avisa o
motivo e não deixa backup pela metade. A string de conexão nunca aparece na tela, e a senha do banco
vai para o `pg_dump` por variável de ambiente, não pela linha de comando.

## 3. Agendar para todo dia às 20:00

No PC do dono a tarefa "Backup ABA" já existe (criada em 03/11/2026). Se o PC estiver desligado no
horário, o Windows roda o backup assim que ele for ligado. Para recriar em outro computador, abra o
**PowerShell** e rode (troque os dois caminhos):

```
$acao = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c node scripts\backup.mjs >> "C:\caminho\backups-aba\backup.log" 2>&1' -WorkingDirectory 'C:\caminho\do\projeto'
$gatilho = New-ScheduledTaskTrigger -Daily -At 20:00
$conf = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName 'Backup ABA' -Action $acao -Trigger $gatilho -Settings $conf
```

O script lê o `.env` sozinho, por isso não precisa do `--env-file` aqui. O resultado de cada execução
fica em `backup.log`, na pasta dos backups (sem segredos). Para conferir, rode `schtasks /Query /TN "Backup ABA"`;
para rodar na hora, `schtasks /Run /TN "Backup ABA"`; para remover, `schtasks /Delete /TN "Backup ABA" /F`.

De vez em quando, abra a pasta de backups e veja se tem um backup de hoje ou de ontem. Para trocar a
tarefa que já existe de semanal para diária, rode `Unregister-ScheduledTask -TaskName 'Backup ABA' -Confirm:$false`
e recrie com os comandos acima.

## 4. Restaurar num projeto Supabase novo

Use quando o projeto antigo foi perdido ou estragado. Antes de confiar neste roteiro, **ensaie uma vez**
num projeto de teste descartável.

### 4.1 Preparar o projeto novo

1. Crie um projeto novo no Supabase (mesma região, de preferência) e anote: URL, publishable key, secret
   key e a string de conexão do banco (como no passo 1.3).
2. Aplique as migrations do projeto, **na ordem dos nomes**, em `supabase/migrations/` (pelo SQL Editor
   do painel, uma por vez, ou com o Supabase CLI). Isso recria as tabelas, as regras de acesso, os
   buckets e as políticas de arquivos.
3. No painel, em **Authentication**, deixe o cadastro público desligado (como no projeto antigo).

### 4.2 Voltar o banco

Escolha a pasta do backup (ex.: `2026-11-08_2200`) e use a string de conexão do projeto **novo** no lugar
de `STRING_DO_PROJETO_NOVO`. O `PGOPTIONS` evita que os gatilhos (auditoria, carimbos) disparem enquanto
os dados entram.

Antes de tudo, esvazie as tabelas que as próprias migrations já deixaram preenchidas no projeto novo
(os textos-padrão do site e os modelos de etapas). Se não fizer isso, o `pg_restore` tenta gravar por
cima de linhas que já existem, dá erro de "chave duplicada" nessas tabelas e a restauração fica pela
metade. O backup traz a versão certa dessas linhas, então não se perde nada. Rode no **SQL Editor** do
projeto novo. Só faça isso num projeto recém-criado, com as migrations aplicadas e nenhum dado seu: o
`cascade` esvazia também o que depende desses modelos (projetos, etapas), e isso só é seguro enquanto
essas tabelas ainda estão vazias.

```sql
truncate table public.configuracoes_site, public.modelos_etapas,
  public.modelo_etapas_itens, public.modelo_categorias_documento cascade;
```

Depois, no terminal:

```
set PGOPTIONS=-c session_replication_role=replica
pg_restore --data-only --no-owner --no-privileges --schema=public --dbname="STRING_DO_PROJETO_NOVO" "C:\caminho\backups-aba\2026-11-08_2200\banco.dump"
pg_restore --data-only --no-owner --no-privileges --table=auth.users --table=auth.identities --dbname="STRING_DO_PROJETO_NOVO" "C:\caminho\backups-aba\2026-11-08_2200\banco.dump"
```

O primeiro comando devolve os dados do site, e o segundo as contas (com as senhas, que ficam
criptografadas). Os arquivos do Storage **não** voltam por aqui; eles vão no passo seguinte. Se aparecer
erro, não repita no escuro: guarde a mensagem (sem a senha) e peça ajuda.

### 4.3 Voltar os arquivos

1. Troque, no `.env`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` e
   `SUPABASE_SECRET_KEY` pelos do projeto novo.
2. Salve o trecho abaixo como `scripts/reenviar-arquivos.mjs` (não faz parte do site; apague depois) e
   rode, trocando a pasta pela do backup:

```
node --env-file=.env scripts/reenviar-arquivos.mjs "C:\caminho\backups-aba\2026-11-08_2200"
```

```js
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { argv, exit } from "node:process";

const pasta = argv[2];
if (!pasta) {
  console.error("Informe a pasta do backup.");
  exit(1);
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const manifesto = JSON.parse(await readFile(join(pasta, "manifesto.json"), "utf8"));
if (!manifesto.arquivos) {
  console.error("Este backup não tem arquivos (foi feito com --so-banco).");
  exit(1);
}

let enviados = 0;
for (const item of manifesto.arquivos.itens) {
  const conteudo = await readFile(join(pasta, "arquivos", item.bucket, ...item.caminho.split("/")));
  if (createHash("sha256").update(conteudo).digest("hex") !== item.sha256) {
    console.error(`Arquivo corrompido no backup: ${item.bucket}/${item.caminho}`);
    exit(1);
  }
  const { error } = await supabase.storage
    .from(item.bucket)
    .upload(item.caminho, conteudo, { contentType: item.tipo ?? undefined, upsert: true });
  if (error) {
    console.error(`Falha ao enviar ${item.bucket}/${item.caminho}: ${error.message}`);
    exit(1);
  }
  enviados += 1;
}
console.log(`${enviados} arquivo(s) enviado(s).`);
```

### 4.4 Conferir e voltar ao ar

1. Compare as contagens: `manifesto.json` (campo `arquivos.total`) com o número de arquivos que o script
   acabou de enviar, e entre no site com uma conta de cada tipo (cliente, empreiteiro, fornecedor, admin).
2. Atualize as variáveis do projeto novo na Vercel (`NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`) e publique de novo.
3. Refaça no projeto novo o que não vem no backup: SMTP (Resend) em **Authentication**, Site URL e
   Redirect URLs, e confira o cadastro público desligado.
4. Apague `scripts/reenviar-arquivos.mjs`.

### 4.5 PDFs do portal (R2)

Os PDFs do portal ficam no Cloudflare R2, não no Supabase. O backup os copia para
`<pasta dos backups>\r2-espelho\<balde>\<chave>`. Essa pasta fica fora da rotação dos 14 backups: só
cresce, nada é apagado nela (um PDF removido do balde continua no espelho). Cada backup diário registra
no `manifesto.json` (campo `r2`) quantos objetos o balde tem, quantos foram baixados, os bytes e os erros.
O backup precisa de uma chave R2 **só de leitura** (`R2_BACKUP_*` no `.env`, veja `.env.example`).

Para restaurar, crie (ou reaproveite) o balde de destino e envie os objetos **com a mesma chave**: o banco
guarda a chave de cada PDF, então qualquer mudança de nome quebra o link. A chave é o caminho do arquivo
dentro da pasta do balde, com `/` entre as pastas. Use uma chave de API do R2 com escrita (Object Read &
Write) no balde de destino e **ajuste `R2_BUCKET_DOCUMENTOS`, `R2_ACCOUNT_ID` e as chaves na Vercel** se o balde
ou a conta forem outros.

Opção A, tudo de uma vez com o `rclone` (<https://rclone.org/>). Configure um remote do tipo S3 chamado
`r2` (provider `Cloudflare`, endpoint `https://<conta>.r2.cloudflarestorage.com`) e rode:

```
rclone copy "C:\caminho\backups-aba\r2-espelho\NOME-DO-BALDE" r2:NOME-DO-BALDE-DESTINO --checksum --progress
```

Opção B, um a um com o `wrangler` (<https://developers.cloudflare.com/r2/>), trocando a chave e o arquivo:

```
npx wrangler r2 object put NOME-DO-BALDE-DESTINO/CHAVE-DO-OBJETO --file "C:\caminho\backups-aba\r2-espelho\NOME-DO-BALDE\CHAVE-DO-OBJETO" --content-type application/pdf --remote
```

Confira no fim: o número de arquivos do espelho (campo `r2.objetos_no_balde` do último manifesto, mais
`r2.no_espelho_e_nao_no_balde`) deve bater com o que está no balde de destino, e abra alguns PDFs pelo portal.

## 5. O que o backup não cobre

- O que foi feito depois do último backup (por isso o backup é diário e o painel do Supabase continua
  sendo a fonte da verdade).
- O código do site: ele está no GitHub.
- Configurações do painel do Supabase e da Vercel (chaves, SMTP, domínio): anote-as em lugar seguro.
