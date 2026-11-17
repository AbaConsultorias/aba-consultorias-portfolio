import "server-only";
import z from "zod";
import { createClient } from "@/lib/supabase/server";
import { ConflictError, ForbiddenError, NotFoundError } from "@/app/api/HttpErrors";
import { conferirErro } from "@/lib/portal/obras/erros";
import { listarObrasAdmin } from "@/lib/portal/obras/consultas";
import { ler, paginacao, paginaDe } from "@/lib/portal/andamento/servidor";
import * as schemas from "./schema";

export async function listar(entrada: z.infer<typeof schemas.consultaSchema>) {
  const { inicio, pagina, limite } = paginacao(entrada);
  return paginaDe((await listarObrasAdmin(entrada.empreendimentoId)).slice(inicio, inicio + limite + 1), pagina, limite);
}
function campos(entrada: z.infer<typeof schemas.atualizarSchema> | z.infer<typeof schemas.criarSchema>) {
  return { nome: entrada.nome, previsto_inicio: entrada.previstoInicio, previsto_fim: entrada.previstoFim, percentual: entrada.percentual, situacao: entrada.situacao };
}
const MENSAGEM_APROVAR = "Alterar o percentual ou a situação da obra exige a permissão de aprovar obras.";
export async function criar(entrada: z.infer<typeof schemas.criarSchema>, podeAprovar: boolean) {
  if (!podeAprovar && (entrada.percentual !== 0 || entrada.situacao !== "planejada")) throw new ForbiddenError(MENSAGEM_APROVAR);
  const sessao = await createClient();
  const { data, error } = await sessao.from("obras").insert({ ...campos(entrada), empreendimento_id: entrada.empreendimentoId }).select("id").single();
  conferirErro(error);
  return ler(z.object({ id: z.uuid() }), data as unknown);
}
export async function atualizar(entrada: z.infer<typeof schemas.atualizarSchema>, podeAprovar: boolean) {
  const sessao = await createClient();
  if (!podeAprovar) {
    const { data: atual, error: erroAtual } = await sessao.from("obras").select("percentual, situacao").eq("id", entrada.id).maybeSingle();
    conferirErro(erroAtual);
    if (!atual) throw new NotFoundError("Obra não encontrada.");
    if (atual.percentual !== entrada.percentual || atual.situacao !== entrada.situacao) throw new ForbiddenError(MENSAGEM_APROVAR);
  }
  const { data, error } = await sessao.from("obras").update(campos(entrada)).eq("id", entrada.id).select("id").maybeSingle();
  conferirErro(error);
  if (!data) throw new NotFoundError("Obra não encontrada.");
  return ler(z.object({ id: z.uuid() }), data as unknown);
}
export async function excluir({ id }: z.infer<typeof schemas.excluirSchema>) {
  const sessao = await createClient();
  const { data: relatos, error: erroRelatos } = await sessao.from("relatos_obra").select("id").eq("obra_id", id).limit(1);
  conferirErro(erroRelatos);
  if (relatos?.length) throw new ConflictError("Obras com relatos não podem ser excluídas. Preserve o histórico.");
  const { data, error } = await sessao.from("obras").delete().eq("id", id).select("id").maybeSingle();
  conferirErro(error);
  if (!data) throw new NotFoundError("Obra não encontrada.");
  return ler(z.object({ id: z.uuid() }), data as unknown);
}
