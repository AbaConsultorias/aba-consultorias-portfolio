import z from "zod";

export const PAPEIS_USUARIO = ["cliente", "empreiteiro", "fornecedor"] as const;
export const PAPEIS_STAFF = ["admin", "equipe"] as const;

export const papelSchema = z.enum([...PAPEIS_USUARIO, ...PAPEIS_STAFF]);

export type Papel = z.infer<typeof papelSchema>;

export function ehStaff(papel: Papel): papel is (typeof PAPEIS_STAFF)[number] {
  return papel === "admin" || papel === "equipe";
}
