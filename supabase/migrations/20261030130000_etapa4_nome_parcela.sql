begin;

-- Nome opcional da parcela ("Assinatura do contrato"). Vazio, a tela mostra a posição ("1ª parcela").
alter table public.parcelas
  add column nome text check (nome is null or char_length(btrim(nome)) between 1 and 120);

commit;
