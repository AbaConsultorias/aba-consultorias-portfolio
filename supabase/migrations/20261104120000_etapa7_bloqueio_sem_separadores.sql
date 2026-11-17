-- Etapa 7 — a lista de bloqueio do banco (segunda barreira de pasta_regras) passa a ignorar espaços, hífens,
-- sublinhados e acentos comuns, como o site e o programa do servidor: "Notas  Fiscais", "NOTAS-FISCAIS" ou
-- "Comprovánte" não escapam mais do CHECK. A primeira barreira continua no código (src/lib/conector/regras.ts).
begin;

alter table public.pasta_regras drop constraint pasta_regras_bloqueio_check;

alter table public.pasta_regras add constraint pasta_regras_bloqueio_check check (
  regexp_replace(
    translate(upper(caminho_prefixo), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'AAAAAEEEEIIIIOOOOOUUUUCN'),
    '[^A-Z0-9]', '', 'g'
  ) !~ '(DADOSDOEMPREENDEDOR|COMPROVANTE|NOTASFISCAIS|PLANILHA)'
);

commit;
