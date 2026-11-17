-- Etapa 8, onda 3: listas de id e nome para seletores, sem abrir a tabela de outro módulo (contrato §4).
-- Aditiva: nada existente muda. Desfazer: supabase/reversoes/20261105120000_etapa8_opcoes.down.sql.
-- Security definer porque a tela de um módulo não lê a tabela do outro; o corpo devolve só id e nome.

begin;

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

create function public.opcoes_loteamentos()
returns table (id uuid, nome text)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.nome::text
  from public.loteamentos l
  where public.tem_permissao('empreendimentos.ver')
     or public.tem_permissao('site.ver')
  order by l.nome, l.id
$$;

-- Excluir projeto solta os documentos dele (on delete set null). Quem edita projetos pode não enxergar
-- documentos: sob RLS a checagem pela sessão voltaria vazia e a exclusão passaria sem aviso.
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

revoke execute on function public.projeto_tem_documentos(uuid) from public, anon;
grant execute on function public.projeto_tem_documentos(uuid) to authenticated;

revoke execute on function public.opcoes_empreendimentos() from public, anon;
revoke execute on function public.opcoes_fornecedores() from public, anon;
revoke execute on function public.opcoes_loteamentos() from public, anon;
grant execute on function public.opcoes_empreendimentos() to authenticated;
grant execute on function public.opcoes_fornecedores() to authenticated;
grant execute on function public.opcoes_loteamentos() to authenticated;

commit;
