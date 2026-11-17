-- Desfaz supabase/migrations/20261105110000_etapa8_contas_internas.sql, na ordem inversa.
-- Fica fora de migrations/ para não ser aplicada sozinha. Rode à mão, com o usuário postgres:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/reversoes/20261105110000_etapa8_contas_internas.down.sql
-- Só funciona enquanto nenhuma rota ou função depender de listar_contas_internas() ou de salvar_permissoes_equipe():
-- o DROP das funções não derruba quem as chama (a chamada passa a falhar em tempo de execução).
-- Apagar o trigger tira a proteção do último admin; religue-a com a migration antes de voltar a usar contas reais.

begin;

drop function if exists public.salvar_permissoes_equipe(uuid, text[]);
drop function if exists public.listar_contas_internas();

drop trigger if exists profiles_proteger_ultimo_admin on public.profiles;
drop function if exists public.proteger_ultimo_admin();

commit;
