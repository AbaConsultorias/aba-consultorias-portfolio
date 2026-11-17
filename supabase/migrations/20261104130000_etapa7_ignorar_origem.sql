-- Etapa 7 — "Ignorar" na fila "Chegaram do servidor" (contrato §7 item 2): o documento continua oculto e no banco,
-- só sai da fila. A marca fica em documento_origens, que só a equipe lê (o cliente lê linhas de documentos).
-- A equipe só pode gravar ignorado_em; nada mais da origem é alterável por usuário.
begin;

alter table public.documento_origens add column ignorado_em timestamptz;
alter table public.documento_origens add column ignorado_por uuid references public.profiles (id) on delete set null;

-- Quem ignorou e quando vêm do banco, nunca do navegador: o trigger carimba (ou limpa) os dois.
create or replace function public.carimbar_origem_ignorada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ignorado_em is not null and old.ignorado_em is null then
    new.ignorado_em := pg_catalog.now();
    new.ignorado_por := (select auth.uid());
  elsif new.ignorado_em is null then
    new.ignorado_por := null;
  else
    new.ignorado_em := old.ignorado_em;
    new.ignorado_por := old.ignorado_por;
  end if;
  return new;
end;
$$;

revoke execute on function public.carimbar_origem_ignorada() from public, anon, authenticated;

create trigger documento_origens_carimbar_ignorada
  before update of ignorado_em on public.documento_origens
  for each row execute function public.carimbar_origem_ignorada();

grant update (ignorado_em) on table public.documento_origens to authenticated;

create policy "staff marca origem como ignorada"
  on public.documento_origens
  for update
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

commit;
