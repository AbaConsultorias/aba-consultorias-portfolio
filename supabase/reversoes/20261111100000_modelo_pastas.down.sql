-- Desfaz supabase/migrations/20261111100000_modelo_pastas.sql: tira a função de montagem, a chave "Ler projetos
-- complementares" e o catálogo de pastas (tabela, funções de validação e seed).
-- O código que lê o catálogo e a coluna (rotas pasta-montagem e catalogo-pastas, tela "Montar a partir do servidor",
-- aviso de complementares) precisa voltar junto: ele consulta as duas coisas. Rode à mão, com o usuário postgres.
-- Perda de dado: o catálogo editado pelo admin e o estado da chave de cada empreendimento são descartados. Projetos e
-- regras já criados pela montagem ficam (são linhas comuns de projetos e pasta_regras). A tabela auditoria mantém as linhas antigas.

begin;

drop function public.montar_empreendimento_de_pastas(uuid, jsonb);

alter table public.empreendimentos
  drop column ler_complementares;

drop table public.catalogo_pastas;

drop function public.catalogo_subpastas_validas(jsonb);
drop function public.catalogo_termos_validos(text[], integer);

commit;
