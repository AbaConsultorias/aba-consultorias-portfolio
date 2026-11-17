import z from "zod";
import { LIMITE_FOTOS_RELATO } from "@/lib/portal/obras/regras";

export const enviarSchema = z.object({
  obraId: z.uuid(), relatoId: z.uuid(),
  texto: z.string().trim().min(3, "Conte o que foi realizado (mínimo de 3 caracteres).").max(5000, "Use até 5.000 caracteres."),
  percentualInformado: z.number().int().min(0).max(100).nullable(),
  situacaoInformada: z.enum(["planejada", "em_andamento", "concluida"]).nullable(),
  comprovantes: z.array(z.string().min(1).max(6000)).max(LIMITE_FOTOS_RELATO, "Envie até 10 fotos.")
    .refine((valores) => new Set(valores).size === valores.length, "Há fotos repetidas no envio."),
});
export type EnviarRelatoInput = z.infer<typeof enviarSchema>;
