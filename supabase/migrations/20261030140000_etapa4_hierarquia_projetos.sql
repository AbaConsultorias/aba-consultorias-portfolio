begin;

-- Um único "Depende de" por projeto: organiza e avisa, não trava o andamento. Staff grava
-- (política "staff gerencia projetos" e grants da tabela já cobrem a coluna nova); cliente
-- continua só lendo os projetos dos empreendimentos vinculados.
alter table public.projetos
  add column projeto_pai_id uuid references public.projetos (id) on delete set null,
  add constraint projetos_pai_diferente_check check (projeto_pai_id is null or projeto_pai_id <> id);

create index projetos_projeto_pai_idx on public.projetos (projeto_pai_id);

-- Variáveis com prefixo v_ para nunca colidir com colunas/aliases; cada linha da cadeia é
-- trancada na subida, então dois ciclos concorrentes (A->B e B->A) terminam em deadlock de um
-- deles, nunca em ciclo gravado.
create function public.validar_hierarquia_projetos()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_empreendimento uuid;
  v_proximo uuid;
  v_profundidade int := 0;
begin
  if new.projeto_pai_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.projeto_pai_id is not distinct from old.projeto_pai_id then
      return new;
    end if;
  end if;

  if new.projeto_pai_id = new.id then
    raise exception 'Um projeto não pode depender de si mesmo.' using errcode = '23514';
  end if;

  select p.empreendimento_id, p.projeto_pai_id into v_empreendimento, v_proximo
  from public.projetos p
  where p.id = new.projeto_pai_id
  for update;
  if not found then
    raise exception 'O projeto do qual este depende não existe.' using errcode = '23514';
  end if;
  if v_empreendimento <> new.empreendimento_id then
    raise exception 'O projeto do qual este depende precisa ser do mesmo empreendimento.' using errcode = '23514';
  end if;

  loop
    exit when v_proximo is null;
    if v_proximo = new.id then
      raise exception 'Esta dependência criaria um ciclo entre projetos.' using errcode = '23514';
    end if;
    v_profundidade := v_profundidade + 1;
    if v_profundidade >= 20 then
      raise exception 'A cadeia de dependências entre projetos é longa demais.' using errcode = '23514';
    end if;
    select p.projeto_pai_id into v_proximo
    from public.projetos p
    where p.id = v_proximo
    for update;
  end loop;

  return new;
end $$;
revoke execute on function public.validar_hierarquia_projetos() from public, anon, authenticated;

create trigger projetos_validar_hierarquia
  before insert or update of projeto_pai_id on public.projetos
  for each row execute function public.validar_hierarquia_projetos();

commit;
