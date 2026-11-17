-- Desfaz supabase/migrations/20261105120000_etapa8_opcoes.sql. Rode à mão, com o usuário postgres.

begin;

drop function if exists public.projeto_tem_documentos(uuid);
drop function if exists public.opcoes_loteamentos();
drop function if exists public.opcoes_fornecedores();
drop function if exists public.opcoes_empreendimentos();

commit;
