import z from "zod";
import { LIMITE_FOTO } from "@/lib/portal/andamento/fotos";
import { LIMITE_FOTOS_RELATO } from "@/lib/portal/obras/regras";

export const assinarSchema = z.object({
  obraId: z.uuid(),
  fotos: z.array(z.object({ mime: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]), tamanho: z.number().int().min(1).max(LIMITE_FOTO, "Cada foto deve ter até 10 MiB.") })).min(1).max(LIMITE_FOTOS_RELATO),
});
