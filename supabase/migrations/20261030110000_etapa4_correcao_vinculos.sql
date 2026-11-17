begin;

-- O PL/pgSQL não faz curto-circuito ao montar a expressão: citar new.categoria_id numa linha de
-- atualizacoes (ou new.etapa_id em documentos) quebra o INSERT. Cada tabela calcula a sua mudança.
create or replace function public.validar_vinculos_portal()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  revalidar boolean;
begin
  if tg_table_name = 'empreendimento_clientes' then
    if not exists (select 1 from public.profiles where id = new.profile_id and papel = 'cliente') then
      raise exception 'Vínculo exige cliente.' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and (new.empreendimento_id <> old.empreendimento_id or new.profile_id <> old.profile_id) then
      raise exception 'Vínculo não pode ser transferido.' using errcode = '23514';
    end if;
  elsif tg_table_name = 'projetos' then
    if tg_op = 'UPDATE' and (new.empreendimento_id <> old.empreendimento_id or (new.modelo_origem_id is not null and new.modelo_origem_id is distinct from old.modelo_origem_id)) then
      raise exception 'Projeto não pode ser transferido.' using errcode = '23514';
    end if;
    if tg_op = 'INSERT' and new.modelo_origem_id is not null then
      perform 1 from public.modelos_etapas where id = new.modelo_origem_id and ativo for share;
      if not found then raise exception 'Modelo inativo ou indisponível.' using errcode = '23514'; end if;
    end if;
    if new.etapa_atual_id is not null and not exists (select 1 from public.projeto_etapas where id = new.etapa_atual_id and projeto_id = new.id) then
      raise exception 'Etapa atual não pertence ao projeto.' using errcode = '23514';
    end if;
  elsif tg_table_name in ('projeto_etapas', 'projeto_categorias_documento') then
    if tg_op = 'UPDATE' and new.projeto_id <> old.projeto_id then
      raise exception 'Filho não pode ser transferido.' using errcode = '23514';
    end if;
    perform 1 from public.projetos where id = new.projeto_id for update;
  else
    if tg_op = 'UPDATE' then
      -- Reclassificar entre projetos do mesmo empreendimento é permitido: o projeto novo e a
      -- etapa/categoria são validados abaixo. O empreendimento nunca muda.
      if new.empreendimento_id <> old.empreendimento_id then
        raise exception 'Registro não pode ser transferido.' using errcode = '23514';
      end if;
      -- A FK do projeto pode executar SET NULL antes da FK da etapa/categoria.
      if old.projeto_id is not null and new.projeto_id is null and not exists (select 1 from public.projetos where id = old.projeto_id) then
        if tg_table_name = 'atualizacoes' then new.etapa_id := null; else new.categoria_id := null; end if;
      end if;
    end if;

    -- Na exclusão do projeto, a FK da etapa/categoria pode rodar SET NULL depois de o projeto
    -- sumir: sem mudança para um valor novo, não há o que revalidar nem projeto a trancar.
    if new.projeto_id is null then
      revalidar := false;
    elsif tg_op = 'INSERT' then
      revalidar := true;
    elsif new.projeto_id is distinct from old.projeto_id then
      revalidar := true;
    elsif tg_table_name = 'atualizacoes' then
      revalidar := new.etapa_id is not null and new.etapa_id is distinct from old.etapa_id;
    else
      revalidar := new.categoria_id is not null and new.categoria_id is distinct from old.categoria_id;
    end if;

    if revalidar then
      perform 1 from public.projetos where id = new.projeto_id and empreendimento_id = new.empreendimento_id for update;
      if not found then raise exception 'Projeto não pertence ao empreendimento.' using errcode = '23514'; end if;
    end if;

    if tg_table_name = 'atualizacoes' then
      if new.etapa_id is not null and (new.projeto_id is null or not exists (select 1 from public.projeto_etapas where id = new.etapa_id and projeto_id = new.projeto_id)) then
        raise exception 'Etapa não pertence ao projeto.' using errcode = '23514';
      end if;
    elsif new.categoria_id is not null and (new.projeto_id is null or not exists (select 1 from public.projeto_categorias_documento where id = new.categoria_id and projeto_id = new.projeto_id)) then
      raise exception 'Categoria não pertence ao projeto.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.validar_vinculos_portal() from public, anon, authenticated;

commit;
