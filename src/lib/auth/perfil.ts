import type { SupabaseClient } from "@supabase/supabase-js";
import z from "zod";
import { papelSchema } from "./papeis";

const perfilSchema = z.object({
  papel: papelSchema,
  nome: z.string(),
  ativo: z.boolean(),
  precisa_trocar_senha: z.boolean(),
});

export type Perfil = z.infer<typeof perfilSchema>;

// Lê a própria linha de profiles com a sessão de quem chama — o RLS só
// devolve a linha do próprio usuário. Qualquer falha vira null (= sem acesso).
export async function lerPerfil(
  supabase: SupabaseClient,
  userId: string,
): Promise<Perfil | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("papel, nome, ativo, precisa_trocar_senha")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("[perfil] erro ao ler perfil:", error.code);
    return null;
  }

  const perfil = perfilSchema.safeParse(data);
  return perfil.success ? perfil.data : null;
}
