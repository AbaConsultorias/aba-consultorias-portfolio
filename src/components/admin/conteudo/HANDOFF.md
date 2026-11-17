# C2 — telas administrativas de conteúdo

Implementadas as oito telas: topo, serviços, projetos com galeria,
depoimentos, parceiros, vídeos, configurações e contatos. Listagens de conteúdo
incluem criação, edição, publicação, ordenação e exclusão com confirmação.
Configurações permitem somente edição; contatos permitem somente leitura e
alteração de `lido`, com filtros e paginação de 50 mensagens.

## Arquivos criados

- `src/app/adm-interno/(protegido)/conteudo/{topo,servicos,projetos,depoimentos,parceiros,videos,configuracoes,contatos}/page.tsx` — oito páginas servidor, cada uma verifica o guard antes de consultar dados ou renderizar.
- `src/app/api/(modules)/adm-interno/conteudo/{banners,servicos,projetos,midias-projeto,depoimentos,parceiros,videos,configuracoes,contatos}/{route,schema,service}.ts` — 27 arquivos.
- `src/components/admin/conteudo/{ArquivoCampo,ContatosRecebidos,EditorRegistro,GaleriaProjeto,ItensCampo,ListaConteudo}.tsx`.
- `src/components/admin/conteudo/{recursos,requisicao,schemas,servidor,validacao}.ts`.

## APIs

Base externa: `/<adminPath>/api/conteudo/`; o valor configurado não é registrado
nem incluído em mensagens de erro. Todas as rotas usam `autorizarConteudo(permissao)`
(`site.ver`, `site.editar`, `contatos.ver` ou `contatos.editar`), com limite compartilhado de **120 requisições por minuto
por usuário**, falha fechada. Todas as escritas usam o cliente Supabase da sessão
e chamam `revalidatePath('/', 'layout')`.

| Recurso | Métodos | Entrada |
| --- | --- | --- |
| `banners` | GET, POST, PATCH, DELETE | Campos do topo, imagem `hero/<uuid>.<ext>`, posição permitida e botão com caminho relativo ou âncora |
| `servicos` | GET, POST, PATCH, DELETE | Frente, título, slug, textos, itens, ícone, foto e mensagem |
| `projetos` | GET, POST, PATCH, DELETE | Título, slug, cidade, categoria, descrição, data e capa; criação exige capa nula |
| `midias-projeto` | GET, POST, PATCH, DELETE | GET exige `portfolio_projeto_id` UUID; gravação exige projeto, tipo, arquivo, legenda e ordem |
| `depoimentos` | GET, POST, PATCH, DELETE | Nome, cidade, texto, origem, nota 1–5 para Google ou nula para cliente, quando |
| `parceiros` | GET, POST, PATCH, DELETE | Nome, logo e URL https opcional |
| `videos` | GET, POST, PATCH, DELETE | MP4, imagem de pôster opcional e legenda |
| `configuracoes` | GET, PATCH | Campos da linha única; WhatsApp só dígitos; URLs https; nota 0–5 com uma casa decimal |
| `contatos` | GET, PATCH | GET: `lido=todos\|lidos\|nao-lidos`, `pagina` positiva; PATCH: somente `{ id, lido }` |

POST recebe o objeto completo do schema, incluindo `ordem` e `publicado` onde
existem. PATCH recebe esse mesmo objeto completo mais `id` UUID. DELETE recebe
`{ id }`. Zod descarta campos extras; IDs, caminhos e URLs são validados no backend.
Mídias não podem ser transferidas entre projetos nem alterar mídias de loteamentos.
O backend também confere a existência do projeto e o prefixo da capa.

Respostas seguem `{ message, details }`: GET retorna `details.registros` (contatos
também `total`), POST/PATCH retornam `details.registro`, DELETE retorna
`details.arquivos` para a limpeza sequencial pelo endpoint de upload. POST usa 201;
demais sucessos usam 200. Falhas passam por `handleError`/`handleResponse`, sem erro
bruto do Supabase, segredo ou stack trace.

## Integração com C1

Uploads usam exclusivamente o endpoint contratado: POST multipart com
`arquivo`, `destino`, `tipo` e `donoId` para portfólio. A criação do projeto
acontece antes de habilitar capa e galeria. Exclusão/substituição de arquivos
usa DELETE no endpoint de upload, com `{ path }`. Cancelar o formulário remove
seus novos uploads. Falhas de limpeza oferecem nova tentativa na tela, sem
repetir a criação do registro.

Nenhum arquivo do shell, upload, loteamentos ou `admin/comum` foi alterado.

## Validação e limites da verificação

- `npm.cmd run check-types`: passou, zero erros (`tsc --noEmit`).
- `npm.cmd run lint`: passou, zero erros e avisos (`eslint`).
- 35 verificações locais de schemas passaram: UUID, caminhos, origem da mídia,
  URLs inseguras, nota, data, WhatsApp e descarte de campos extras de contatos.
- `npm.cmd` foi usado porque a política local do PowerShell bloqueia `npm.ps1`.
- Nenhum acesso ao banco, servidor de desenvolvimento, build ou dependência nova.
- A navegação integrada, os uploads do C1 e a aparência em navegador ainda precisam
  de validação no checkout do coordenador.
- Banco e Storage não compartilham transação. Se a limpeza falhar, a nova tentativa
  fica disponível enquanto a tela permanece aberta; navegar antes dela pode deixar
  um arquivo órfão. A ordenação usa gravações sequenciais; não há transação/RPC nova
  nem proteção contra edição concorrente por duas pessoas.

Não há dúvida de contrato pendente.
