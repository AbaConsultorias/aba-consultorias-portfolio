-- Desfaz supabase/migrations/20261106130000_etapa8_rls_documentos_servidor_site.sql.
-- Políticas, funções e triggers voltam ao texto de produção de docs/etapa8-estado-banco-antes-rls.json.

begin;

-- storage.objects

drop policy "documentos: documentos.ver lê" on storage.objects;
drop policy "fornecedores: fornecedores.ver lê" on storage.objects;
drop policy "obras: equipe lê por prefixo do caminho" on storage.objects;
drop policy "site-publico: site.editar apaga arquivos" on storage.objects;
drop policy "site-publico: site.ver lê arquivos" on storage.objects;

create policy "documentos: staff lê"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'documentos' and (select public.e_staff()));

create policy "fornecedores: staff lê"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'fornecedores' and (select public.e_staff()));

create policy "obras: staff lê"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'obras' and (select public.e_staff()));

create policy "staff apaga arquivos do site-publico"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'site-publico' and (select public.e_staff()));

create policy "staff lê arquivos do site-publico"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'site-publico' and (select public.e_staff()));

-- Site

drop policy "site.ver lê vídeos do instagram" on public.videos_instagram;
drop policy "site.editar insere vídeos do instagram" on public.videos_instagram;
drop policy "site.editar atualiza vídeos do instagram" on public.videos_instagram;
drop policy "site.editar apaga vídeos do instagram" on public.videos_instagram;

create policy "staff gerencia vídeos do instagram"
  on public.videos_instagram
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

drop policy "site.ver lê serviços" on public.servicos;
drop policy "site.editar insere serviços" on public.servicos;
drop policy "site.editar atualiza serviços" on public.servicos;
drop policy "site.editar apaga serviços" on public.servicos;

create policy "staff gerencia serviços"
  on public.servicos
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

drop policy "site.ver lê projetos do portfólio" on public.portfolio_projetos;
drop policy "site.editar insere projetos do portfólio" on public.portfolio_projetos;
drop policy "site.editar atualiza projetos do portfólio" on public.portfolio_projetos;
drop policy "site.editar apaga projetos do portfólio" on public.portfolio_projetos;

create policy "staff gerencia projetos do portfólio"
  on public.portfolio_projetos
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

drop policy "site.ver lê parceiros" on public.parceiros;
drop policy "site.editar insere parceiros" on public.parceiros;
drop policy "site.editar atualiza parceiros" on public.parceiros;
drop policy "site.editar apaga parceiros" on public.parceiros;

create policy "staff gerencia parceiros"
  on public.parceiros
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

drop policy "site.ver lê mídias" on public.midias;
drop policy "site.editar insere mídias" on public.midias;
drop policy "site.editar atualiza mídias" on public.midias;
drop policy "site.editar apaga mídias" on public.midias;

create policy "staff gerencia mídias"
  on public.midias
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

drop policy "site.ver lê lotes" on public.lotes;
drop policy "site.editar insere lotes" on public.lotes;
drop policy "site.editar atualiza lotes" on public.lotes;
drop policy "site.editar apaga lotes" on public.lotes;

create policy "staff gerencia lotes"
  on public.lotes
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

drop policy "site.ver lê loteamentos" on public.loteamentos;
drop policy "site.editar insere loteamentos" on public.loteamentos;
drop policy "site.editar atualiza loteamentos" on public.loteamentos;
drop policy "site.editar apaga loteamentos" on public.loteamentos;

create policy "staff gerencia loteamentos"
  on public.loteamentos
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

drop policy "site.ver lê depoimentos" on public.depoimentos;
drop policy "site.editar insere depoimentos" on public.depoimentos;
drop policy "site.editar atualiza depoimentos" on public.depoimentos;
drop policy "site.editar apaga depoimentos" on public.depoimentos;

create policy "staff gerencia depoimentos"
  on public.depoimentos
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

drop policy "site.ver lê banners do topo" on public.banners_hero;
drop policy "site.editar insere banners do topo" on public.banners_hero;
drop policy "site.editar atualiza banners do topo" on public.banners_hero;
drop policy "site.editar apaga banners do topo" on public.banners_hero;

create policy "staff gerencia banners do topo"
  on public.banners_hero
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

drop policy "site.editar atualiza as configurações do site" on public.configuracoes_site;

create policy "staff atualiza as configurações do site"
  on public.configuracoes_site
  for update
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

-- contatos

drop policy "contatos.ver lê contatos" on public.contatos;
drop policy "contatos.editar marca contatos como lidos" on public.contatos;

create policy "staff lê contatos"
  on public.contatos
  for select
  to authenticated
  using ((select public.e_staff()));

create policy "staff marca contatos como lidos"
  on public.contatos
  for update
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

-- Servidor

drop policy "servidor.regras lê regras de pasta" on public.pasta_regras;
drop policy "servidor.regras insere regras de pasta" on public.pasta_regras;
drop policy "servidor.regras atualiza regras de pasta" on public.pasta_regras;
drop policy "servidor.regras apaga regras de pasta" on public.pasta_regras;

drop trigger pasta_regras_proteger_liberacao on public.pasta_regras;
drop function public.proteger_liberacao_pasta_regra();

create policy "staff gerencia regras de pasta"
  on public.pasta_regras
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

drop trigger configuracoes_conector_proteger_liberacao on public.configuracoes_conector;
drop function public.proteger_liberacao_conector();

drop policy "painel.servidor lê envios do conector" on public.conector_envios;

create policy "staff lê envios do conector"
  on public.conector_envios
  for select
  to authenticated
  using ((select public.e_staff()));

drop policy "painel.servidor ou servidor.regras lê a configuração" on public.configuracoes_conector;
drop policy "só o administrador altera a configuração do conector" on public.configuracoes_conector;

create policy "staff lê a configuração do conector"
  on public.configuracoes_conector
  for select
  to authenticated
  using ((select public.e_staff()));

create policy "staff altera a configuração do conector"
  on public.configuracoes_conector
  for update
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

drop policy "painel.servidor ou servidor.regras lê conectores" on public.conectores;

create policy "staff lê conectores"
  on public.conectores
  for select
  to authenticated
  using ((select public.e_staff()));

-- Fornecedores

drop policy "fornecedores.ver e usuários do fornecedor leem documentos" on public.fornecedor_documentos;
drop policy "fornecedores.editar insere documentos de fornecedor" on public.fornecedor_documentos;
drop policy "fornecedores.editar atualiza documentos de fornecedor" on public.fornecedor_documentos;

create policy "staff e usuários do fornecedor leem documentos do fornecedor"
  on public.fornecedor_documentos
  for select
  to authenticated
  using ((select public.e_staff()) or public.usuario_do_fornecedor(fornecedor_id));

create policy "staff insere documentos de fornecedor"
  on public.fornecedor_documentos
  for insert
  to authenticated
  with check ((select public.e_staff()));

create policy "staff atualiza documentos de fornecedor"
  on public.fornecedor_documentos
  for update
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

drop policy "fornecedores.ver e usuários do fornecedor leem contratos" on public.fornecedor_contratos;
drop policy "fornecedores.editar insere contratos de fornecedor" on public.fornecedor_contratos;
drop policy "fornecedores.editar atualiza contratos de fornecedor" on public.fornecedor_contratos;
drop policy "só o administrador apaga contratos de fornecedor" on public.fornecedor_contratos;

create policy "staff e usuários do fornecedor leem contratos"
  on public.fornecedor_contratos
  for select
  to authenticated
  using ((select public.e_staff()) or public.usuario_do_fornecedor(fornecedor_id));

create policy "staff insere contratos de fornecedor"
  on public.fornecedor_contratos
  for insert
  to authenticated
  with check ((select public.e_staff()));

create policy "staff atualiza contratos de fornecedor"
  on public.fornecedor_contratos
  for update
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "staff apaga contratos de fornecedor"
  on public.fornecedor_contratos
  for delete
  to authenticated
  using ((select public.e_staff()));

drop policy "fornecedores.ver lê usuários de fornecedor" on public.fornecedor_usuarios;
drop policy "fornecedores.editar insere usuários de fornecedor" on public.fornecedor_usuarios;
drop policy "fornecedores.editar atualiza usuários de fornecedor" on public.fornecedor_usuarios;
drop policy "fornecedores.editar apaga usuários de fornecedor" on public.fornecedor_usuarios;

create policy "staff gerencia usuários de fornecedor"
  on public.fornecedor_usuarios
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

drop policy "fornecedores.ver lê fornecedores" on public.fornecedores;
drop policy "fornecedores.editar insere fornecedores" on public.fornecedores;
drop policy "fornecedores.editar atualiza fornecedores" on public.fornecedores;
drop policy "só o administrador apaga fornecedores" on public.fornecedores;

create policy "staff gerencia fornecedores"
  on public.fornecedores
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

-- Funções de liberação

create or replace function public.liberar_revisao_documento(p_documento uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_substitui uuid;
  v_familia uuid;
  v_liberado boolean;
begin
  if not (select public.e_staff()) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;

  select d.substitui_id, d.familia_id, d.liberado_cliente
    into v_substitui, v_familia, v_liberado
    from public.documentos d
   where d.id = p_documento
   for update;

  if not found then
    raise exception 'Documento não encontrado.' using errcode = 'P0002';
  end if;
  -- Revisão cuja anterior foi apagada continua sendo revisão (familia_id aponta para a raiz).
  if v_substitui is null and v_familia = p_documento then
    raise exception 'O documento não é uma revisão.' using errcode = '23514';
  end if;
  if v_liberado then
    return;
  end if;

  -- O trigger documentos_ocultar_versoes_irmas oculta as outras versões da família neste UPDATE.
  update public.documentos
     set liberado_cliente = true
   where id = p_documento;
end;
$function$;

create or replace function public.liberar_documento_do_servidor(p_documento uuid)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_familia uuid;
  v_criado timestamptz;
  v_liberado boolean;
  v_mime text;
begin
  if not (select public.e_staff()) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;

  select d.familia_id into v_familia from public.documentos d where d.id = p_documento;
  if not found then
    return 'fora_da_fila';
  end if;

  -- Mesmo lock do trigger documentos_ocultar_versoes_irmas (que a liberação automática do conector também usa).
  perform pg_advisory_xact_lock(hashtextextended('documentos_familia:' || v_familia::text, 0));

  select d.criado_em, d.liberado_cliente, d.mime
    into v_criado, v_liberado, v_mime
    from public.documentos d
   where d.id = p_documento
   for update;
  if not found then
    return 'fora_da_fila';
  end if;
  if v_liberado then
    return 'ja_liberado';
  end if;
  if v_mime <> 'application/pdf' or not exists (
    select 1 from public.documento_origens o where o.documento_id = p_documento and o.ignorado_em is null
  ) then
    return 'fora_da_fila';
  end if;
  if exists (
    select 1 from public.documentos d
     where d.familia_id = v_familia
       and d.id <> p_documento
       and (d.criado_em > v_criado or (d.criado_em = v_criado and d.id > p_documento))
  ) then
    return 'versao_mais_nova';
  end if;

  -- O trigger oculta as outras versões da família neste UPDATE.
  update public.documentos set liberado_cliente = true where id = p_documento;
  return 'liberado';
end;
$function$;

-- documento_origens

drop policy "documentos.liberar lê origens de documentos" on public.documento_origens;
drop policy "documentos.liberar marca origem como ignorada" on public.documento_origens;

create policy "staff lê origens de documentos"
  on public.documento_origens
  for select
  to authenticated
  using ((select public.e_staff()));

create policy "staff marca origem como ignorada"
  on public.documento_origens
  for update
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

-- documentos

drop trigger documentos_proteger_liberacao on public.documentos;
drop function public.proteger_liberacao_documento();

drop policy "documentos.ver ou cliente do empreendimento lê documentos" on public.documentos;
drop policy "documentos.editar insere documentos" on public.documentos;
drop policy "documentos.editar ou liberar atualiza documentos" on public.documentos;
drop policy "documentos.editar apaga documentos (liberado exige liberar)" on public.documentos;

create policy "staff e clientes do empreendimento leem documentos liberados"
  on public.documentos
  for select
  to authenticated
  using (
    (select public.e_staff())
    or (liberado_cliente and public.cliente_do_empreendimento(empreendimento_id))
  );

create policy "staff insere documentos"
  on public.documentos
  for insert
  to authenticated
  with check ((select public.e_staff()));

create policy "staff atualiza documentos"
  on public.documentos
  for update
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "staff apaga documentos"
  on public.documentos
  for delete
  to authenticated
  using ((select public.e_staff()));

commit;
