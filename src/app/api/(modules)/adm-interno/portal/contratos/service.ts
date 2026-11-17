import "server-only";
import z from "zod";
import { createClient } from "@/lib/supabase/server";
import { conferirErro } from "@/lib/portal/financeiro/erros";
import { InternalServerError } from "@/app/api/HttpErrors";
import type { AtualizarInput, CriarInput } from "./schema";

type Dados = CriarInput;

function paraBanco(dados: Dados) {
  return {
    descricao: dados.descricao,
    codigo: dados.codigo,
    versao: dados.versao,
    assinado_em: dados.assinadoEm,
    documento_id: dados.documentoId,
    valor_contratado_centavos: dados.valorContratadoCentavos,
    observacao: dados.observacao,
    projetos: dados.projetos,
    parcelas: dados.parcelas.map((parcela) => ({
      id: parcela.id ?? null,
      nome: parcela.nome,
      valor_previsto_centavos: parcela.valorPrevistoCentavos,
      gatilho: parcela.gatilho,
      ...(parcela.gatilho === "data"
        ? { vencimento: parcela.vencimento }
        : {
          evento_tipo: parcela.eventoTipo,
          evento_projeto_id: parcela.eventoProjetoId,
          evento_descricao: parcela.eventoDescricao,
          dias_apos: parcela.diasApos,
        }),
    })),
  };
}

async function salvar(id: string | null, empreendimentoId: string, dados: Dados, atualizadoEm: string | null) {
  const db = await createClient();
  const { data, error } = await db.rpc("salvar_contrato_portal", {
    p_id: id,
    p_empreendimento: empreendimentoId,
    p_dados: paraBanco(dados),
    p_atualizado_em: atualizadoEm,
  });
  conferirErro(error);
  const salvo = z.uuid().safeParse(data);
  if (!salvo.success) throw new InternalServerError(null);
  return { id: salvo.data };
}

export function criar({ empreendimentoId, ...dados }: CriarInput) {
  return salvar(null, empreendimentoId, { empreendimentoId, ...dados }, null);
}

export function atualizar({ id, atualizadoEm, empreendimentoId, ...dados }: AtualizarInput) {
  return salvar(id, empreendimentoId, { empreendimentoId, ...dados }, atualizadoEm);
}
