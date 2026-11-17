-- Desfaz supabase/migrations/20261106100000_etapa8_opcoes_detalhe.sql: volta às formas de 20261105120000_etapa8_opcoes.sql.
-- O código que chama estas funções precisa voltar junto. Rode à mão, com o usuário postgres.

begin;

drop function public.projeto_tem_vinculos(uuid);
drop function public.opcoes_fornecedores();
drop function public.opcoes_empreendimentos();

create function public.opcoes_empreendimentos()
returns table (id uuid, nome text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.nome::text
  from public.empreendimentos e
  where public.tem_permissao('empreendimentos.ver')
     or public.tem_permissao('clientes.ver')
     or public.tem_permissao('atualizacoes.ver')
     or public.tem_permissao('documentos.ver')
     or public.tem_permissao('financeiro.ver')
     or public.tem_permissao('obras.ver')
     or public.tem_permissao('fornecedores.ver')
     or public.tem_permissao('painel.servidor')
  order by e.nome, e.id
$$;

create function public.opcoes_fornecedores()
returns table (id uuid, nome text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, coalesce(f.nome_fantasia, f.razao_social)::text
  from public.fornecedores f
  where public.tem_permissao('fornecedores.ver')
     or public.tem_permissao('financeiro.ver')
  order by 2, f.id
$$;

create function public.projeto_tem_documentos(p_projeto_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.tem_permissao('empreendimentos.editar')
    and exists (select 1 from public.documentos d where d.projeto_id = p_projeto_id)
$$;

revoke execute on function public.opcoes_empreendimentos() from public, anon;
revoke execute on function public.opcoes_fornecedores() from public, anon;
revoke execute on function public.projeto_tem_documentos(uuid) from public, anon;
grant execute on function public.opcoes_empreendimentos() to authenticated;
grant execute on function public.opcoes_fornecedores() to authenticated;
grant execute on function public.projeto_tem_documentos(uuid) to authenticated;

commit;
