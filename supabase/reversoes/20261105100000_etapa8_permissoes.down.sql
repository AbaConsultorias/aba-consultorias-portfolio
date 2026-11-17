-- Desfaz supabase/migrations/20261105100000_etapa8_permissoes.sql, na ordem inversa.
-- Fica fora de migrations/ para não ser aplicada sozinha. Rode à mão, com o usuário postgres:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/reversoes/20261105100000_etapa8_permissoes.down.sql
-- Só funciona enquanto nenhuma política, função ou rota depender de tem_permissao() ou de equipe_permissoes:
-- o DROP falha se algo ainda usar. As linhas antigas em public.auditoria (tabela = 'equipe_permissoes') ficam.

begin;

drop function if exists public.minhas_permissoes();
drop function if exists public.tem_permissao(text);

-- Apagar a tabela leva junto as políticas e os quatro triggers.
drop table if exists public.equipe_permissoes;

drop function if exists public.bloquear_alteracao_equipe_permissao();
drop function if exists public.validar_remocao_equipe_permissao();
drop function if exists public.validar_insercao_equipe_permissao();

drop function if exists public.prerequisitos_permissao(text);
drop function if exists public.catalogo_permissoes();

commit;
