-- Etapa 8, onda 3: os seletores mantêm o que mostravam antes da troca: cidade do empreendimento e situação
-- do fornecedor (fornecedor inativo não pode ser escolhido num item novo). Excluir projeto também confere as
-- atualizações, que como os documentos ficam soltas com on delete set null.
-- Nada de produção usa estas funções ainda. Desfazer: supabase/reversoes/20261106100000_etapa8_opcoes_detalhe.down.sql.

begin;

drop function public.opcoes_empreendimentos();
drop function public.opcoes_fornecedores();
drop function public.projeto_tem_documentos(uuid);

create function public.opcoes_empreendimentos()
returns table (id uuid, nome text, cidade text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.nome::text, e.cidade::text
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
returns table (id uuid, nome text, ativo boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, coalesce(f.nome_fantasia, f.razao_social)::text, f.ativo
  from public.fornecedores f
  where public.tem_permissao('fornecedores.ver')
     or public.tem_permissao('financeiro.ver')
  order by 2, f.id
$$;

-- Quem edita projetos pode não enxergar documentos nem atualizações: sob RLS a checagem pela sessão
-- voltaria vazia e a exclusão soltaria os registros sem aviso.
create function public.projeto_tem_vinculos(p_projeto_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.tem_permissao('empreendimentos.editar')
    and (
      exists (select 1 from public.documentos d where d.projeto_id = p_projeto_id)
      or exists (select 1 from public.atualizacoes a where a.projeto_id = p_projeto_id)
    )
$$;

revoke execute on function public.opcoes_empreendimentos() from public, anon;
revoke execute on function public.opcoes_fornecedores() from public, anon;
revoke execute on function public.projeto_tem_vinculos(uuid) from public, anon;
grant execute on function public.opcoes_empreendimentos() to authenticated;
grant execute on function public.opcoes_fornecedores() to authenticated;
grant execute on function public.projeto_tem_vinculos(uuid) to authenticated;

commit;
