-- Conta com troca de senha pendente não tem papel: as políticas de RLS que
-- usam papel_atual()/e_staff()/e_admin() ficam fechadas até a senha ser trocada.
create or replace function public.papel_atual()
returns public.papel_usuario
language sql
stable
security definer
set search_path = ''
as $$
  select p.papel
  from public.profiles p
  where p.id = (select auth.uid())
    and p.ativo
    and not p.precisa_trocar_senha
$$;

revoke execute on function public.papel_atual() from public, anon;
grant execute on function public.papel_atual() to authenticated;
