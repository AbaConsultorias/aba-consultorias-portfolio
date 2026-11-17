-- Testes da Etapa 8: listas de id e nome para seletores.
-- Como rodar: npx.cmd supabase db query --linked -f supabase/tests/etapa8_opcoes.sql
-- Tudo termina em ROLLBACK. Se algo falhar, para com "FALHA: ..."; no fim imprime OK.

begin;

insert into auth.users (id, aud, role, email)
values
  ('82000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'e8o-admin@example.com'),
  ('82000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'e8o-sem@example.com'),
  ('82000000-0000-0000-0000-0000000000e2', 'authenticated', 'authenticated', 'e8o-fin@example.com'),
  ('82000000-0000-0000-0000-0000000000e3', 'authenticated', 'authenticated', 'e8o-site@example.com'),
  ('82000000-0000-0000-0000-0000000000e4', 'authenticated', 'authenticated', 'e8o-inativa@example.com'),
  ('82000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'e8o-cliente@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  ('82000000-0000-0000-0000-0000000000a1', 'admin', 'Admin E8O', true, false),
  ('82000000-0000-0000-0000-0000000000e1', 'equipe', 'Sem permissão E8O', true, false),
  ('82000000-0000-0000-0000-0000000000e2', 'equipe', 'Financeiro E8O', true, false),
  ('82000000-0000-0000-0000-0000000000e3', 'equipe', 'Site E8O', true, false),
  ('82000000-0000-0000-0000-0000000000e4', 'equipe', 'Inativa E8O', false, false),
  ('82000000-0000-0000-0000-0000000000c1', 'cliente', 'Cliente E8O', true, false);

insert into public.equipe_permissoes (profile_id, permissao)
values
  ('82000000-0000-0000-0000-0000000000e2', 'financeiro.ver'),
  ('82000000-0000-0000-0000-0000000000e3', 'site.ver'),
  ('82000000-0000-0000-0000-0000000000e4', 'financeiro.ver');

insert into public.empreendimentos (id, nome)
values ('82000000-0000-0000-0000-000000000e01', 'Empreendimento E8O');

insert into public.fornecedores (id, razao_social)
values ('82000000-0000-0000-0000-000000000f01', 'Fornecedor E8O');

create function pg_temp.contagens()
returns table (empreendimentos bigint, fornecedores bigint, loteamentos bigint)
language sql
as $$
  select
    (select count(*) from public.opcoes_empreendimentos()),
    (select count(*) from public.opcoes_fornecedores()),
    (select count(*) from public.opcoes_loteamentos())
$$;

set local role authenticated;

set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$
begin
  if (select count(*) from public.opcoes_empreendimentos() where nome = 'Empreendimento E8O') <> 1 then
    raise exception 'FALHA: admin deveria listar empreendimentos';
  end if;
  if (select count(*) from public.opcoes_fornecedores() where nome = 'Fornecedor E8O') <> 1 then
    raise exception 'FALHA: admin deveria listar fornecedores';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
do $$
begin
  if (select empreendimentos + fornecedores + loteamentos from pg_temp.contagens()) <> 0 then
    raise exception 'FALHA: equipe sem permissão não deveria listar nada';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
do $$
begin
  if (select count(*) from public.opcoes_empreendimentos() where nome = 'Empreendimento E8O') <> 1
     or (select count(*) from public.opcoes_fornecedores() where nome = 'Fornecedor E8O') <> 1 then
    raise exception 'FALHA: financeiro.ver deveria listar empreendimentos e fornecedores';
  end if;
  if (select count(*) from public.opcoes_loteamentos()) <> 0 then
    raise exception 'FALHA: financeiro.ver não deveria listar loteamentos';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-0000000000e3","role":"authenticated"}';
do $$
begin
  if (select empreendimentos + fornecedores from pg_temp.contagens()) <> 0 then
    raise exception 'FALHA: site.ver não deveria listar empreendimentos nem fornecedores';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-0000000000e4","role":"authenticated"}';
do $$
begin
  if (select empreendimentos + fornecedores + loteamentos from pg_temp.contagens()) <> 0 then
    raise exception 'FALHA: conta inativa não deveria listar nada';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
do $$
begin
  if (select empreendimentos + fornecedores + loteamentos from pg_temp.contagens()) <> 0 then
    raise exception 'FALHA: cliente não deveria listar nada';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$
begin
  if (select ativo from public.opcoes_fornecedores() where nome = 'Fornecedor E8O') is not true then
    raise exception 'FALHA: a lista de fornecedores deveria informar a situação';
  end if;
  if public.projeto_tem_vinculos('82000000-0000-0000-0000-00000000ffff') is not false then
    raise exception 'FALHA: projeto inexistente não tem vínculos';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
do $$
begin
  if public.projeto_tem_vinculos('82000000-0000-0000-0000-00000000ffff') is not false then
    raise exception 'FALHA: financeiro não deveria consultar vínculos de projeto';
  end if;
end $$;

reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.opcoes_empreendimentos();
    raise exception 'FALHA: anon executou opcoes_empreendimentos';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname, p.proargnames) not in (
        ('opcoes_empreendimentos', array['id', 'nome', 'cidade']),
        ('opcoes_fornecedores', array['id', 'nome', 'ativo']),
        ('opcoes_loteamentos', array['id', 'nome'])
      )
      and p.proname in ('opcoes_empreendimentos', 'opcoes_fornecedores', 'opcoes_loteamentos')
  ) then
    raise exception 'FALHA: as funções de opções só podem devolver os campos combinados';
  end if;
end $$;

select 'OK: listas de seletores da Etapa 8 passaram nos testes' as resultado;

rollback;
