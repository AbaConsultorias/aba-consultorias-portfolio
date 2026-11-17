-- Etapa 7 — correções da revisão de segurança nas revisões de documento (D7).
-- 1. A família de revisões passa a ser um campo fixo (familia_id), herdado da versão substituída na
--    criação. Apagar uma versão do meio da cadeia (substitui_id vira null) não separa mais a família.
-- 2. Liberações da mesma família são serializadas por um lock transacional: duas transações que
--    liberam versões diferentes ao mesmo tempo não deixam as duas visíveis ao cliente.

begin;

alter table public.documentos add column familia_id uuid;

with recursive cadeia as (
  select d.id, d.id as familia_id from public.documentos d where d.substitui_id is null
  union all
  select d.id, c.familia_id from public.documentos d join cadeia c on d.substitui_id = c.id
)
update public.documentos d set familia_id = c.familia_id from cadeia c where c.id = d.id;

alter table public.documentos alter column familia_id set not null;

create index documentos_familia_id_idx on public.documentos (familia_id);

create or replace function public.validar_substituicao_documento()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.familia_id is distinct from old.familia_id then
      raise exception 'A família de revisões não pode mudar.' using errcode = '23514';
    end if;
    if new.substitui_id is not distinct from old.substitui_id then
      return new;
    end if;
    -- Só pode zerar (ação ON DELETE SET NULL da FK). Reapontar poderia criar ciclo.
    if new.substitui_id is not null then
      raise exception 'Revisão não pode ser reapontada.' using errcode = '23514';
    end if;
    return new;
  end if;

  -- INSERT: a família vem sempre da versão substituída (o valor enviado é ignorado).
  new.familia_id := new.id;
  if new.substitui_id is not null then
    select d.familia_id into new.familia_id
      from public.documentos d
     where d.id = new.substitui_id and d.empreendimento_id = new.empreendimento_id;
    if not found then
      raise exception 'Revisão deve substituir documento do mesmo empreendimento.' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.ocultar_versoes_irmas_documento()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.liberado_cliente then
      return null;
    end if;
  end if;
  if not new.liberado_cliente then
    return null;
  end if;

  -- Espera outra liberação da mesma família terminar; o UPDATE abaixo já enxerga o que ela gravou.
  perform pg_advisory_xact_lock(hashtextextended('documentos_familia:' || new.familia_id::text, 0));

  update public.documentos d
     set liberado_cliente = false
   where d.familia_id = new.familia_id
     and d.id <> new.id
     and d.liberado_cliente;

  return null;
end;
$$;

create or replace function public.liberar_revisao_documento(p_documento uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

commit;
