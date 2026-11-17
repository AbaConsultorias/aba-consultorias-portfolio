import "server-only";
import { randomUUID } from "node:crypto";
import z from "zod";
import { assinarComprovante } from "@/lib/portal/comum/upload";
import { EXTENSOES_FOTO } from "@/lib/portal/andamento/fotos";
import { exigirObra } from "../../service";
import { dependenciasPadrao } from "../../armazenamento";
import type { assinarSchema } from "./schema";

export async function assinar(entrada: z.infer<typeof assinarSchema>, usuarioId: string, deps = dependenciasPadrao) {
  const sessao = await deps.sessao();
  await exigirObra(sessao, entrada.obraId);
  const relatoId = randomUUID();
  const fotos = [];
  for (const [ordem, foto] of entrada.fotos.entries()) {
    const registroId = randomUUID();
    const path = `relatos/${entrada.obraId}/${relatoId}/${registroId}.${EXTENSOES_FOTO[foto.mime]}`;
    const comprovante = assinarComprovante({ finalidade: "relato_foto", usuarioId, registroId, bucket: "obras", path, ...foto, metadados: { obraId: entrada.obraId, relatoId, ordem } });
    fotos.push({ ...await deps.assinar(path), path, comprovante });
  }
  return { relatoId, fotos };
}
