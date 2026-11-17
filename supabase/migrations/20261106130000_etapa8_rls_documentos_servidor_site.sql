-- Etapa 8, onda 4 (3 de 3) — RLS de documentos, fornecedores, servidor, site e storage sai de e_staff() para tem_permissao().
-- Contrato: docs/ETAPA-8-CONTRATO.md §3 e §4; anexo: Resoluções R2, R3, R11, R12, R36, R37, R38, R41 e Parte D (D5).
-- Cobre: documentos, documento_origens, fornecedores, fornecedor_contratos, fornecedor_documentos,
-- fornecedor_usuarios, conectores, configuracoes_conector, conector_envios, pasta_regras, contatos,
-- as tabelas do site, as 5 políticas de storage.objects e as funções liberar_documento_do_servidor
-- e liberar_revisao_documento. Políticas públicas (anon) e ramos de cliente e fornecedor ficam como estavam.
-- Já eram só do admin e não mudam: auditoria, downloads_log, emissão e revogação de conector,
-- apagar contatos e apagar documentos de fornecedor.
-- Desfazer: supabase/reversoes/20261106130000_etapa8_rls_documentos_servidor_site.down.sql.
--
-- Esta é a última das três: o bloco final falha (e desfaz tudo) se restar a checagem antiga em
-- alguma política ou função de public e storage. A função de papel antiga continua existindo.

begin;

-- ---------------------------------------------------------------------------
-- documentos (R12, R41)
-- ---------------------------------------------------------------------------

drop policy "staff e clientes do empreendimento leem documentos liberados" on public.documentos;
drop policy "staff insere documentos" on public.documentos;
drop policy "staff atualiza documentos" on public.documentos;
drop policy "staff apaga documentos" on public.documentos;

create policy "documentos.ver ou cliente do empreendimento lê documentos"
  on public.documentos
  for select
  to authenticated
  using (
    (select public.tem_permissao('documentos.ver'))
    or (liberado_cliente and public.cliente_do_empreendimento(empreendimento_id))
  );

create policy "documentos.editar insere documentos"
  on public.documentos
  for insert
  to authenticated
  with check ((select public.tem_permissao('documentos.editar')));

create policy "documentos.editar ou liberar atualiza documentos"
  on public.documentos
  for update
  to authenticated
  using (
    (select public.tem_permissao('documentos.editar'))
    or (select public.tem_permissao('documentos.liberar'))
  )
  with check (
    (select public.tem_permissao('documentos.editar'))
    or (select public.tem_permissao('documentos.liberar'))
  );

create policy "documentos.editar apaga documentos (liberado exige liberar)"
  on public.documentos
  for delete
  to authenticated
  using (
    (select public.tem_permissao('documentos.editar'))
    and (not liberado_cliente or (select public.tem_permissao('documentos.liberar')))
  );

-- O RLS não separa colunas: a política de update deixa passar quem tem editar ou liberar, e este trigger
-- diz qual das duas vale para o que mudou. Mudar liberado_cliente (e criar já liberado) exige liberar;
-- mudar qualquer outra coluna exige editar. liberado_por, liberado_em e atualizado_em são carimbados
-- por outros triggers e não contam. Secret key, migration, script, função definer e ação de FK
-- rodam fora de anon/authenticated e passam direto (a rota que usa secret key confere no código).
create function public.proteger_liberacao_documento()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_carimbadas constant text[] := array['liberado_cliente', 'liberado_por', 'liberado_em', 'atualizado_em'];
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.liberado_cliente and not (select public.tem_permissao('documentos.liberar')) then
      raise exception 'Liberar documento para o cliente exige a permissão de liberar documentos.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.liberado_cliente is distinct from old.liberado_cliente
     and not (select public.tem_permissao('documentos.liberar')) then
    raise exception 'Liberar documento para o cliente exige a permissão de liberar documentos.'
      using errcode = '42501';
  end if;

  if (to_jsonb(new) - v_carimbadas) is distinct from (to_jsonb(old) - v_carimbadas)
     and not (select public.tem_permissao('documentos.editar')) then
    raise exception 'Alterar um documento exige a permissão de editar documentos.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.proteger_liberacao_documento() from public, anon, authenticated;

create trigger documentos_proteger_liberacao
  before insert or update on public.documentos
  for each row execute function public.proteger_liberacao_documento();

-- ---------------------------------------------------------------------------
-- documento_origens (R37): o caminho relativo tem nomes de pessoas. O grant de update é só de ignorado_em.
-- ---------------------------------------------------------------------------

drop policy "staff lê origens de documentos" on public.documento_origens;
drop policy "staff marca origem como ignorada" on public.documento_origens;

create policy "documentos.liberar lê origens de documentos"
  on public.documento_origens
  for select
  to authenticated
  using ((select public.tem_permissao('documentos.liberar')));

create policy "documentos.liberar marca origem como ignorada"
  on public.documento_origens
  for update
  to authenticated
  using ((select public.tem_permissao('documentos.liberar')))
  with check ((select public.tem_permissao('documentos.liberar')));

-- ---------------------------------------------------------------------------
-- Funções de liberação (definer: o corpo é a única barreira)
-- ---------------------------------------------------------------------------

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
  if not (select public.tem_permissao('documentos.liberar')) then
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
  if not (select public.tem_permissao('documentos.liberar')) then
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

-- ---------------------------------------------------------------------------
-- fornecedores (R11: apagar fornecedor, contrato e documento é só do admin)
-- ---------------------------------------------------------------------------

drop policy "staff gerencia fornecedores" on public.fornecedores;

create policy "fornecedores.ver lê fornecedores"
  on public.fornecedores
  for select
  to authenticated
  using ((select public.tem_permissao('fornecedores.ver')));

create policy "fornecedores.editar insere fornecedores"
  on public.fornecedores
  for insert
  to authenticated
  with check ((select public.tem_permissao('fornecedores.editar')));

create policy "fornecedores.editar atualiza fornecedores"
  on public.fornecedores
  for update
  to authenticated
  using ((select public.tem_permissao('fornecedores.editar')))
  with check ((select public.tem_permissao('fornecedores.editar')));

create policy "só o administrador apaga fornecedores"
  on public.fornecedores
  for delete
  to authenticated
  using ((select public.e_admin()));

drop policy "staff gerencia usuários de fornecedor" on public.fornecedor_usuarios;

create policy "fornecedores.ver lê usuários de fornecedor"
  on public.fornecedor_usuarios
  for select
  to authenticated
  using ((select public.tem_permissao('fornecedores.ver')));

create policy "fornecedores.editar insere usuários de fornecedor"
  on public.fornecedor_usuarios
  for insert
  to authenticated
  with check ((select public.tem_permissao('fornecedores.editar')));

create policy "fornecedores.editar atualiza usuários de fornecedor"
  on public.fornecedor_usuarios
  for update
  to authenticated
  using ((select public.tem_permissao('fornecedores.editar')))
  with check ((select public.tem_permissao('fornecedores.editar')));

create policy "fornecedores.editar apaga usuários de fornecedor"
  on public.fornecedor_usuarios
  for delete
  to authenticated
  using ((select public.tem_permissao('fornecedores.editar')));

drop policy "staff e usuários do fornecedor leem contratos" on public.fornecedor_contratos;
drop policy "staff insere contratos de fornecedor" on public.fornecedor_contratos;
drop policy "staff atualiza contratos de fornecedor" on public.fornecedor_contratos;
drop policy "staff apaga contratos de fornecedor" on public.fornecedor_contratos;

create policy "fornecedores.ver e usuários do fornecedor leem contratos"
  on public.fornecedor_contratos
  for select
  to authenticated
  using (
    (select public.tem_permissao('fornecedores.ver'))
    or public.usuario_do_fornecedor(fornecedor_id)
  );

create policy "fornecedores.editar insere contratos de fornecedor"
  on public.fornecedor_contratos
  for insert
  to authenticated
  with check ((select public.tem_permissao('fornecedores.editar')));

create policy "fornecedores.editar atualiza contratos de fornecedor"
  on public.fornecedor_contratos
  for update
  to authenticated
  using ((select public.tem_permissao('fornecedores.editar')))
  with check ((select public.tem_permissao('fornecedores.editar')));

create policy "só o administrador apaga contratos de fornecedor"
  on public.fornecedor_contratos
  for delete
  to authenticated
  using ((select public.e_admin()));

drop policy "staff e usuários do fornecedor leem documentos do fornecedor" on public.fornecedor_documentos;
drop policy "staff insere documentos de fornecedor" on public.fornecedor_documentos;
drop policy "staff atualiza documentos de fornecedor" on public.fornecedor_documentos;

create policy "fornecedores.ver e usuários do fornecedor leem documentos"
  on public.fornecedor_documentos
  for select
  to authenticated
  using (
    (select public.tem_permissao('fornecedores.ver'))
    or public.usuario_do_fornecedor(fornecedor_id)
  );

create policy "fornecedores.editar insere documentos de fornecedor"
  on public.fornecedor_documentos
  for insert
  to authenticated
  with check ((select public.tem_permissao('fornecedores.editar')));

create policy "fornecedores.editar atualiza documentos de fornecedor"
  on public.fornecedor_documentos
  for update
  to authenticated
  using ((select public.tem_permissao('fornecedores.editar')))
  with check ((select public.tem_permissao('fornecedores.editar')));

-- ---------------------------------------------------------------------------
-- Servidor: conectores, configuração, envios e regras de pasta (R3, R36)
-- ---------------------------------------------------------------------------

drop policy "staff lê conectores" on public.conectores;

create policy "painel.servidor ou servidor.regras lê conectores"
  on public.conectores
  for select
  to authenticated
  using (
    (select public.tem_permissao('painel.servidor'))
    or (select public.tem_permissao('servidor.regras'))
  );

drop policy "staff lê a configuração do conector" on public.configuracoes_conector;
drop policy "staff altera a configuração do conector" on public.configuracoes_conector;

create policy "painel.servidor ou servidor.regras lê a configuração"
  on public.configuracoes_conector
  for select
  to authenticated
  using (
    (select public.tem_permissao('painel.servidor'))
    or (select public.tem_permissao('servidor.regras'))
  );

-- O grant de update é só de liberacao_automatica_geral, o interruptor geral: só o admin liga ou desliga.
create policy "só o administrador altera a configuração do conector"
  on public.configuracoes_conector
  for update
  to authenticated
  using ((select public.e_admin()))
  with check ((select public.e_admin()));

drop policy "staff lê envios do conector" on public.conector_envios;

create policy "painel.servidor lê envios do conector"
  on public.conector_envios
  for select
  to authenticated
  using ((select public.tem_permissao('painel.servidor')));

-- D5: os dois triggers abaixo seguem o mesmo desenho do de empreendimentos (migration anterior):
-- só valem para anon/authenticated, e a checagem de admin usa e_admin() porque o interruptor não se concede.
-- A segunda barreira da configuração é redundante com a política; fica para o dia em que ela se abrir.
create function public.proteger_liberacao_conector()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if new.liberacao_automatica_geral is distinct from old.liberacao_automatica_geral
     and not (select public.e_admin()) then
    raise exception 'Só o administrador altera a liberação automática geral.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.proteger_liberacao_conector() from public, anon, authenticated;

create trigger configuracoes_conector_proteger_liberacao
  before update on public.configuracoes_conector
  for each row execute function public.proteger_liberacao_conector();

-- R3: regra com liberação automática ligada só o admin cria, altera ou apaga; apagar regra desligada é
-- de servidor.regras. A ação de FK (apagar projeto ou empreendimento) roda como dono da tabela e passa
-- direto: ela só remove o destino da regra, nunca publica nada.
create function public.proteger_liberacao_pasta_regra()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_exige_admin boolean;
begin
  if current_user not in ('anon', 'authenticated') then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    v_exige_admin := old.liberar_automatico;
  elsif tg_op = 'INSERT' then
    v_exige_admin := new.liberar_automatico;
  else
    v_exige_admin := new.liberar_automatico is distinct from old.liberar_automatico
      or old.liberar_automatico;
  end if;

  if v_exige_admin and not (select public.e_admin()) then
    raise exception 'Só o administrador cria, altera ou apaga uma regra de pasta com liberação automática.'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.proteger_liberacao_pasta_regra() from public, anon, authenticated;

create trigger pasta_regras_proteger_liberacao
  before insert or update or delete on public.pasta_regras
  for each row execute function public.proteger_liberacao_pasta_regra();

drop policy "staff gerencia regras de pasta" on public.pasta_regras;

create policy "servidor.regras lê regras de pasta"
  on public.pasta_regras
  for select
  to authenticated
  using ((select public.tem_permissao('servidor.regras')));

create policy "servidor.regras insere regras de pasta"
  on public.pasta_regras
  for insert
  to authenticated
  with check ((select public.tem_permissao('servidor.regras')));

create policy "servidor.regras atualiza regras de pasta"
  on public.pasta_regras
  for update
  to authenticated
  using ((select public.tem_permissao('servidor.regras')))
  with check ((select public.tem_permissao('servidor.regras')));

create policy "servidor.regras apaga regras de pasta"
  on public.pasta_regras
  for delete
  to authenticated
  using ((select public.tem_permissao('servidor.regras')));

-- ---------------------------------------------------------------------------
-- contatos: o grant de update é só da coluna lido
-- ---------------------------------------------------------------------------

drop policy "staff lê contatos" on public.contatos;
drop policy "staff marca contatos como lidos" on public.contatos;

create policy "contatos.ver lê contatos"
  on public.contatos
  for select
  to authenticated
  using ((select public.tem_permissao('contatos.ver')));

create policy "contatos.editar marca contatos como lidos"
  on public.contatos
  for update
  to authenticated
  using ((select public.tem_permissao('contatos.editar')))
  with check ((select public.tem_permissao('contatos.editar')));

-- ---------------------------------------------------------------------------
-- Site: a leitura pública de publicados (anon e authenticated) não muda
-- ---------------------------------------------------------------------------

drop policy "staff atualiza as configurações do site" on public.configuracoes_site;

create policy "site.editar atualiza as configurações do site"
  on public.configuracoes_site
  for update
  to authenticated
  using ((select public.tem_permissao('site.editar')))
  with check ((select public.tem_permissao('site.editar')));

drop policy "staff gerencia banners do topo" on public.banners_hero;

create policy "site.ver lê banners do topo"
  on public.banners_hero
  for select
  to authenticated
  using ((select public.tem_permissao('site.ver')));

create policy "site.editar insere banners do topo"
  on public.banners_hero
  for insert
  to authenticated
  with check ((select public.tem_permissao('site.editar')));

create policy "site.editar atualiza banners do topo"
  on public.banners_hero
  for update
  to authenticated
  using ((select public.tem_permissao('site.editar')))
  with check ((select public.tem_permissao('site.editar')));

create policy "site.editar apaga banners do topo"
  on public.banners_hero
  for delete
  to authenticated
  using ((select public.tem_permissao('site.editar')));

drop policy "staff gerencia depoimentos" on public.depoimentos;

create policy "site.ver lê depoimentos"
  on public.depoimentos
  for select
  to authenticated
  using ((select public.tem_permissao('site.ver')));

create policy "site.editar insere depoimentos"
  on public.depoimentos
  for insert
  to authenticated
  with check ((select public.tem_permissao('site.editar')));

create policy "site.editar atualiza depoimentos"
  on public.depoimentos
  for update
  to authenticated
  using ((select public.tem_permissao('site.editar')))
  with check ((select public.tem_permissao('site.editar')));

create policy "site.editar apaga depoimentos"
  on public.depoimentos
  for delete
  to authenticated
  using ((select public.tem_permissao('site.editar')));

drop policy "staff gerencia loteamentos" on public.loteamentos;

create policy "site.ver lê loteamentos"
  on public.loteamentos
  for select
  to authenticated
  using ((select public.tem_permissao('site.ver')));

create policy "site.editar insere loteamentos"
  on public.loteamentos
  for insert
  to authenticated
  with check ((select public.tem_permissao('site.editar')));

create policy "site.editar atualiza loteamentos"
  on public.loteamentos
  for update
  to authenticated
  using ((select public.tem_permissao('site.editar')))
  with check ((select public.tem_permissao('site.editar')));

create policy "site.editar apaga loteamentos"
  on public.loteamentos
  for delete
  to authenticated
  using ((select public.tem_permissao('site.editar')));

drop policy "staff gerencia lotes" on public.lotes;

create policy "site.ver lê lotes"
  on public.lotes
  for select
  to authenticated
  using ((select public.tem_permissao('site.ver')));

create policy "site.editar insere lotes"
  on public.lotes
  for insert
  to authenticated
  with check ((select public.tem_permissao('site.editar')));

create policy "site.editar atualiza lotes"
  on public.lotes
  for update
  to authenticated
  using ((select public.tem_permissao('site.editar')))
  with check ((select public.tem_permissao('site.editar')));

create policy "site.editar apaga lotes"
  on public.lotes
  for delete
  to authenticated
  using ((select public.tem_permissao('site.editar')));

drop policy "staff gerencia mídias" on public.midias;

create policy "site.ver lê mídias"
  on public.midias
  for select
  to authenticated
  using ((select public.tem_permissao('site.ver')));

create policy "site.editar insere mídias"
  on public.midias
  for insert
  to authenticated
  with check ((select public.tem_permissao('site.editar')));

create policy "site.editar atualiza mídias"
  on public.midias
  for update
  to authenticated
  using ((select public.tem_permissao('site.editar')))
  with check ((select public.tem_permissao('site.editar')));

create policy "site.editar apaga mídias"
  on public.midias
  for delete
  to authenticated
  using ((select public.tem_permissao('site.editar')));

drop policy "staff gerencia parceiros" on public.parceiros;

create policy "site.ver lê parceiros"
  on public.parceiros
  for select
  to authenticated
  using ((select public.tem_permissao('site.ver')));

create policy "site.editar insere parceiros"
  on public.parceiros
  for insert
  to authenticated
  with check ((select public.tem_permissao('site.editar')));

create policy "site.editar atualiza parceiros"
  on public.parceiros
  for update
  to authenticated
  using ((select public.tem_permissao('site.editar')))
  with check ((select public.tem_permissao('site.editar')));

create policy "site.editar apaga parceiros"
  on public.parceiros
  for delete
  to authenticated
  using ((select public.tem_permissao('site.editar')));

drop policy "staff gerencia projetos do portfólio" on public.portfolio_projetos;

create policy "site.ver lê projetos do portfólio"
  on public.portfolio_projetos
  for select
  to authenticated
  using ((select public.tem_permissao('site.ver')));

create policy "site.editar insere projetos do portfólio"
  on public.portfolio_projetos
  for insert
  to authenticated
  with check ((select public.tem_permissao('site.editar')));

create policy "site.editar atualiza projetos do portfólio"
  on public.portfolio_projetos
  for update
  to authenticated
  using ((select public.tem_permissao('site.editar')))
  with check ((select public.tem_permissao('site.editar')));

create policy "site.editar apaga projetos do portfólio"
  on public.portfolio_projetos
  for delete
  to authenticated
  using ((select public.tem_permissao('site.editar')));

drop policy "staff gerencia serviços" on public.servicos;

create policy "site.ver lê serviços"
  on public.servicos
  for select
  to authenticated
  using ((select public.tem_permissao('site.ver')));

create policy "site.editar insere serviços"
  on public.servicos
  for insert
  to authenticated
  with check ((select public.tem_permissao('site.editar')));

create policy "site.editar atualiza serviços"
  on public.servicos
  for update
  to authenticated
  using ((select public.tem_permissao('site.editar')))
  with check ((select public.tem_permissao('site.editar')));

create policy "site.editar apaga serviços"
  on public.servicos
  for delete
  to authenticated
  using ((select public.tem_permissao('site.editar')));

drop policy "staff gerencia vídeos do instagram" on public.videos_instagram;

create policy "site.ver lê vídeos do instagram"
  on public.videos_instagram
  for select
  to authenticated
  using ((select public.tem_permissao('site.ver')));

create policy "site.editar insere vídeos do instagram"
  on public.videos_instagram
  for insert
  to authenticated
  with check ((select public.tem_permissao('site.editar')));

create policy "site.editar atualiza vídeos do instagram"
  on public.videos_instagram
  for update
  to authenticated
  using ((select public.tem_permissao('site.editar')))
  with check ((select public.tem_permissao('site.editar')));

create policy "site.editar apaga vídeos do instagram"
  on public.videos_instagram
  for delete
  to authenticated
  using ((select public.tem_permissao('site.editar')));

-- ---------------------------------------------------------------------------
-- storage.objects: só leitura (e apagar no site-publico) tem política. Escrever nos buckets privados é
-- sempre pela secret key, então ali a barreira é a rota, não o banco (exceção do contrato §1.2).
-- Layout do bucket obras: relatos/<obra>/<relato>/<arquivo> e atualizacoes/<empreendimento>/<atualização>/<arquivo>.
-- ---------------------------------------------------------------------------

drop policy "documentos: staff lê" on storage.objects;
drop policy "fornecedores: staff lê" on storage.objects;
drop policy "obras: staff lê" on storage.objects;
drop policy "staff apaga arquivos do site-publico" on storage.objects;
drop policy "staff lê arquivos do site-publico" on storage.objects;

create policy "documentos: documentos.ver lê"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'documentos'
    and (select public.tem_permissao('documentos.ver'))
  );

create policy "fornecedores: fornecedores.ver lê"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'fornecedores'
    and (select public.tem_permissao('fornecedores.ver'))
  );

create policy "obras: equipe lê por prefixo do caminho"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'obras'
    and (
      ((storage.foldername(name))[1] = 'relatos' and (select public.tem_permissao('obras.ver')))
      or ((storage.foldername(name))[1] = 'atualizacoes' and (select public.tem_permissao('atualizacoes.ver')))
    )
  );

create policy "site-publico: site.editar apaga arquivos"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'site-publico'
    and (select public.tem_permissao('site.editar'))
  );

create policy "site-publico: site.ver lê arquivos"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'site-publico'
    and (select public.tem_permissao('site.ver'))
  );

-- ---------------------------------------------------------------------------
-- Conferência final (contrato §6): nenhuma política nem função de public e storage pode ainda
-- depender da checagem de "qualquer interno", exceto a própria função de papel.
-- ---------------------------------------------------------------------------

do $conferir$
declare
  v_restos text;
begin
  select string_agg(r.item, ', ' order by r.item)
    into v_restos
    from (
      select 'política ' || p.schemaname || '.' || p.tablename || ' "' || p.policyname || '"' as item
        from pg_policies p
       where p.schemaname in ('public', 'storage')
         and coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') like '%e\_staff%'
      union all
      select 'função public.' || f.proname
        from pg_proc f
        join pg_namespace n on n.oid = f.pronamespace
       where n.nspname = 'public'
         and f.proname <> 'e_staff'
         and f.prosrc like '%e\_staff%'
    ) r;

  if v_restos is not null then
    raise exception 'Ainda dependem da checagem antiga de equipe: %', v_restos;
  end if;
end
$conferir$;

commit;
