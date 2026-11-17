-- Etapa 3 — correções da revisão de segurança.
-- 1. Constraints de link (última trava, além do Zod e do urlSegura das consultas):
--    botão do topo só caminho relativo ou âncora; demais URLs só https; WhatsApp
--    só dígitos; nota do Google 0–5 e total >= 0.
-- 2. Storage: a equipe não grava mais no bucket site-publico pela sessão. Envio
--    só com a secret key no servidor (rota de upload / URL assinada); a equipe
--    mantém leitura e exclusão.

-- O WhatsApp hoje guarda a URL completa ('https://wa.me/55...'): vira só dígitos
-- antes da constraint. Se o que sobrar não tiver 10 a 15 dígitos, vira nulo
-- (senão a constraint abaixo travaria a migration).
update public.configuracoes_site
set whatsapp = case
  when regexp_replace(whatsapp, '\D', '', 'g') ~ '^[0-9]{10,15}$'
    then regexp_replace(whatsapp, '\D', '', 'g')
  else null
end
where whatsapp is not null and whatsapp !~ '^[0-9]{10,15}$';

alter table public.banners_hero
  add constraint banners_hero_botao_href_seguro_check check (
    botao_href is null
    or (
      botao_href ~ '^(/[^/\\[:space:]]|/$|#[A-Za-z0-9_-]+$)'
      and botao_href !~ '[[:space:][:cntrl:]\\]'
    )
  );

alter table public.parceiros
  add constraint parceiros_site_url_https_check check (site_url is null or site_url ~ '^https://[^[:space:][:cntrl:]]+$');

alter table public.loteamentos
  add constraint loteamentos_maps_url_https_check check (maps_url is null or maps_url ~ '^https://[^[:space:][:cntrl:]]+$');

alter table public.configuracoes_site
  add constraint configuracoes_site_whatsapp_digitos_check check (whatsapp is null or whatsapp ~ '^[0-9]{10,15}$'),
  add constraint configuracoes_site_instagram_url_https_check check (instagram_url is null or instagram_url ~ '^https://[^[:space:][:cntrl:]]+$'),
  add constraint configuracoes_site_facebook_url_https_check check (facebook_url is null or facebook_url ~ '^https://[^[:space:][:cntrl:]]+$'),
  add constraint configuracoes_site_linkedin_url_https_check check (linkedin_url is null or linkedin_url ~ '^https://[^[:space:][:cntrl:]]+$'),
  add constraint configuracoes_site_mapa_url_https_check check (mapa_url is null or mapa_url ~ '^https://[^[:space:][:cntrl:]]+$'),
  add constraint configuracoes_site_google_avaliacoes_url_https_check check (google_avaliacoes_url is null or google_avaliacoes_url ~ '^https://[^[:space:][:cntrl:]]+$'),
  add constraint configuracoes_site_google_avaliar_url_https_check check (google_avaliar_url is null or google_avaliar_url ~ '^https://[^[:space:][:cntrl:]]+$'),
  add constraint configuracoes_site_google_nota_check check (google_nota is null or google_nota between 0 and 5),
  add constraint configuracoes_site_google_total_check check (google_total is null or google_total >= 0);

drop policy "staff envia arquivos para o site-publico" on storage.objects;
drop policy "staff atualiza arquivos do site-publico" on storage.objects;
-- Mantidas: "staff lê arquivos do site-publico" e "staff apaga arquivos do site-publico".
