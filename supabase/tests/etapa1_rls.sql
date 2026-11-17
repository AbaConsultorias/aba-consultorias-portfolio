-- Testes de RLS da Etapa 1.
-- Como rodar: cole no SQL Editor do Supabase ou use
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa1_rls.sql
-- Rode com o usuário postgres. Tudo acontece dentro de uma transação que termina
-- em ROLLBACK, então nada fica no banco. Se alguma verificação falhar, o script
-- para com "FALHA: ..."; se chegar ao fim, imprime "OK" no último select.

begin;

-- Fixture: três contas fake (cliente, admin e equipe inativa) e seus perfis.
-- Os perfis são criados como postgres, que é quem pode escrever neles.
insert into auth.users (id, aud, role, email)
values
  ('00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'cliente-teste@example.com'),
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'admin-teste@example.com'),
  ('00000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'equipe-inativa-teste@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', 'admin-pendente-teste@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  ('00000000-0000-0000-0000-0000000000c1', 'cliente', 'Cliente Teste', true, false),
  ('00000000-0000-0000-0000-0000000000a1', 'admin', 'Admin Teste', true, false),
  ('00000000-0000-0000-0000-0000000000e1', 'equipe', 'Equipe Inativa Teste', false, false),
  ('00000000-0000-0000-0000-0000000000a2', 'admin', 'Admin Senha Pendente Teste', true, true);

-- Etapa 8: esta suíte testa a conta de equipe com todas as permissões.
insert into public.equipe_permissoes (profile_id, permissao)
select p.id, c.permissao
from unnest(array['00000000-0000-0000-0000-0000000000e1']::uuid[]) as p(id)
cross join unnest(public.catalogo_permissoes()) with ordinality as c(permissao, ordem)
order by p.id, c.ordem;

-- Auditoria: um update feito como postgres (sem auth.uid()) precisa gerar
-- linha UPDATE com antes/depois e ator_id nulo; o insert acima já gerou INSERT.
update public.profiles set nome = 'Cliente Teste Editado', atualizado_em = '2000-01-01'
where id = '00000000-0000-0000-0000-0000000000c1';

do $$
declare
  v_linha public.auditoria;
begin
  select * into v_linha
  from public.auditoria
  where tabela = 'profiles'
    and registro_id = '00000000-0000-0000-0000-0000000000c1'
    and acao = 'UPDATE';

  if not found then
    raise exception 'FALHA: update em profiles não gerou linha de auditoria';
  end if;
  if v_linha.ator_id is not null then
    raise exception 'FALHA: ator_id deveria ser nulo para escrita feita como postgres';
  end if;
  if v_linha.antes ->> 'nome' <> 'Cliente Teste' or v_linha.depois ->> 'nome' <> 'Cliente Teste Editado' then
    raise exception 'FALHA: antes/depois da auditoria não refletem a alteração';
  end if;
  if not exists (
    select 1 from public.auditoria
    where tabela = 'profiles'
      and registro_id = '00000000-0000-0000-0000-0000000000c1'
      and acao = 'INSERT'
  ) then
    raise exception 'FALHA: insert em profiles não gerou linha de auditoria';
  end if;
  if (select atualizado_em from public.profiles where id = '00000000-0000-0000-0000-0000000000c1') < '2001-01-01' then
    raise exception 'FALHA: trigger não sobrescreveu atualizado_em';
  end if;
end $$;

-- Cliente: só enxerga o próprio perfil e não enxerga a auditoria.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'FALHA: cliente deveria ver exatamente 1 perfil, viu %', (select count(*) from public.profiles);
  end if;
  if not exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-0000000000c1') then
    raise exception 'FALHA: cliente não vê o próprio perfil';
  end if;
  if public.papel_atual() is distinct from 'cliente' then
    raise exception 'FALHA: papel_atual() do cliente deveria ser cliente';
  end if;
  if public.e_staff() or public.e_admin() then
    raise exception 'FALHA: cliente não pode ser staff nem admin';
  end if;
  if (select count(*) from public.auditoria) <> 0 then
    raise exception 'FALHA: cliente não deveria ver linhas de auditoria';
  end if;
end $$;

-- Cliente: não consegue escrever em profiles (nem se promover a admin).
-- Sem privilégio ou sem política a escrita falha com insufficient_privilege (42501)
-- ou atinge 0 linhas; qualquer outro resultado é falha.
do $$
declare
  v_linhas int;
begin
  begin
    update public.profiles set papel = 'admin'
    where id = '00000000-0000-0000-0000-0000000000c1';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: cliente conseguiu dar update em profiles';
    end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.profiles (id, papel, nome)
    values (gen_random_uuid(), 'admin', 'Intruso');
    raise exception 'FALHA: cliente conseguiu inserir em profiles';
  exception when insufficient_privilege then
    null;
  end;

  begin
    delete from public.profiles where id = '00000000-0000-0000-0000-0000000000c1';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: cliente conseguiu apagar em profiles';
    end if;
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- Cliente (authenticated): não pode chamar verificar_rate_limit nem ler rate_limits
-- nem escrever na auditoria.
do $$
begin
  begin
    perform public.verificar_rate_limit('teste-authenticated', 5, 60);
    raise exception 'FALHA: authenticated conseguiu chamar verificar_rate_limit';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform 1 from public.rate_limits;
    raise exception 'FALHA: authenticated conseguiu ler rate_limits';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.auditoria (tabela, acao) values ('profiles', 'INSERT');
    raise exception 'FALHA: authenticated conseguiu inserir em auditoria';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- Admin (staff): enxerga todos os perfis e a auditoria.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

do $$
begin
  if (
    select count(*) from public.profiles
    where id in (
      '00000000-0000-0000-0000-0000000000c1',
      '00000000-0000-0000-0000-0000000000a1',
      '00000000-0000-0000-0000-0000000000e1'
    )
  ) <> 3 then
    raise exception 'FALHA: admin deveria ver os 3 perfis de teste';
  end if;
  if public.papel_atual() is distinct from 'admin' or not public.e_staff() or not public.e_admin() then
    raise exception 'FALHA: funções de papel do admin retornaram valor errado';
  end if;
  if not exists (
    select 1 from public.auditoria
    where tabela = 'profiles'
      and registro_id = '00000000-0000-0000-0000-0000000000c1'
      and acao = 'UPDATE'
  ) then
    raise exception 'FALHA: admin não vê a linha de auditoria do update';
  end if;
end $$;

-- Equipe inativa: papel_atual() é nulo, não é staff e só vê o próprio perfil.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

do $$
begin
  if public.papel_atual() is not null then
    raise exception 'FALHA: papel_atual() de conta inativa deveria ser nulo';
  end if;
  if public.e_staff() or public.e_admin() then
    raise exception 'FALHA: conta inativa não pode ser staff nem admin';
  end if;
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'FALHA: conta inativa deveria ver só o próprio perfil';
  end if;
end $$;

-- Admin com troca de senha pendente: sem papel até trocar a senha, mas ainda
-- lê o próprio perfil (o guard precisa disso para mandar para /trocar-senha).
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';

do $$
begin
  if public.papel_atual() is not null then
    raise exception 'FALHA: papel_atual() com troca de senha pendente deveria ser nulo';
  end if;
  if public.e_staff() or public.e_admin() then
    raise exception 'FALHA: troca de senha pendente não pode ser staff nem admin';
  end if;
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'FALHA: troca de senha pendente deveria ver só o próprio perfil';
  end if;
  if (select count(*) from public.auditoria) <> 0 then
    raise exception 'FALHA: troca de senha pendente não pode ler a auditoria';
  end if;
end $$;

-- Anônimo: não enxerga nada e não chama nenhuma função de negócio.
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
begin
  begin
    perform 1 from public.profiles;
    raise exception 'FALHA: anon conseguiu ler profiles';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform 1 from public.auditoria;
    raise exception 'FALHA: anon conseguiu ler auditoria';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform 1 from public.rate_limits;
    raise exception 'FALHA: anon conseguiu ler rate_limits';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.verificar_rate_limit('teste-anon', 5, 60);
    raise exception 'FALHA: anon conseguiu chamar verificar_rate_limit';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.papel_atual();
    raise exception 'FALHA: anon conseguiu chamar papel_atual';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- service_role: pode chamar verificar_rate_limit. Limite 2 por janela de 60 s:
-- 1ª e 2ª permitidas, 3ª bloqueada.
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

do $$
begin
  if not public.verificar_rate_limit('teste-chave', 2, 60) then
    raise exception 'FALHA: 1ª chamada deveria ser permitida';
  end if;
  if not public.verificar_rate_limit('teste-chave', 2, 60) then
    raise exception 'FALHA: 2ª chamada deveria ser permitida';
  end if;
  if public.verificar_rate_limit('teste-chave', 2, 60) then
    raise exception 'FALHA: 3ª chamada deveria ser bloqueada';
  end if;
end $$;

-- Janela vencida: volta como postgres, envelhece a janela e confirma que o
-- próximo upsert reinicia a contagem.
reset role;

update public.rate_limits
set janela_inicio = now() - interval '2 minutes'
where chave = 'teste-chave';

set local role service_role;

do $$
begin
  if not public.verificar_rate_limit('teste-chave', 2, 60) then
    raise exception 'FALHA: após a janela vencer a chamada deveria ser permitida';
  end if;
end $$;

reset role;

do $$
begin
  if (select contagem from public.rate_limits where chave = 'teste-chave') <> 1 then
    raise exception 'FALHA: contagem deveria ter sido reiniciada para 1';
  end if;
end $$;

select 'OK: todas as verificações de RLS da Etapa 1 passaram' as resultado;

rollback;
