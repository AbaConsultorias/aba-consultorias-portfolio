-- Etapa 7, frente C — colunas que a API do conector precisa em conector_envios.
-- Contrato: docs/ETAPA-7-API-CONECTOR.md (§3 e §5) e docs/ETAPA-7-CONTRATO.md (§5).
-- Autorizar um envio planeja o documento (id e chave no R2) antes de ele existir; confirmar cria o documento
-- com exatamente esse id. Só a API (secret key) escreve aqui; as políticas e os grants não mudam.
begin;

alter table public.conector_envios
  -- Chave planejada no R2: <empreendimento_id>/<documento_planejado_id>.pdf. Fica em coluna _path (regra 11 do
  -- SECURITY.md): é a mesma convenção de documentos.storage_path, e o objeto de uma autorização nunca confirmada
  -- é apagado pela limpeza de órfãos do R2 depois de 24 h.
  add column storage_path text,
  -- Id que o documento terá ao ser confirmado. Não é FK: o documento ainda não existe.
  add column documento_planejado_id uuid,
  -- Data de modificação do arquivo no servidor; vai para documento_origens.mtime na confirmação.
  add column mtime timestamptz,
  add column confirmado_em timestamptz,
  add constraint conector_envios_storage_path_check check (
    (storage_path is null and documento_planejado_id is null)
    or (
      storage_path is not null
      and documento_planejado_id is not null
      and storage_path = empreendimento_id::text || '/' || documento_planejado_id::text || '.pdf'
    )
  ),
  add constraint conector_envios_confirmado_em_check check (confirmado_em is null or estado = 'confirmado');

-- Um id planejado serve a uma única autorização (a chave do R2 nunca é reaproveitada).
create unique index conector_envios_documento_planejado_id_idx
  on public.conector_envios (documento_planejado_id) where documento_planejado_id is not null;

-- Último envio confirmado de um caminho no empreendimento (ja_enviado e revisão), sem diferenciar caixa.
create index conector_envios_caminho_confirmado_idx
  on public.conector_envios (empreendimento_id, lower(caminho_relativo), em desc) where estado = 'confirmado';

commit;
