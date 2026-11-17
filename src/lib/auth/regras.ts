import { ehStaff, type Papel } from "./papeis";
import type { Permissao } from "./permissoes";

export type PapelExterno = "cliente" | "empreiteiro" | "fornecedor";

export type RegraInterna = Permissao | "so-admin" | { qualquer: readonly Permissao[] };

// `externos` libera esses papéis sem olhar permissão; conta interna só passa se `interna` existir e permitir.
export type RegraAcesso = RegraInterna | { externos: readonly PapelExterno[]; interna?: RegraInterna };

function regraInternaPermite(regra: RegraInterna, papel: Papel, permissoes: ReadonlySet<Permissao>): boolean {
  if (!ehStaff(papel)) return false;
  if (regra === "so-admin") return papel === "admin";
  if (typeof regra === "string") return permissoes.has(regra);
  return regra.qualquer.some((permissao) => permissoes.has(permissao));
}

export function regraPermite(regra: RegraAcesso, papel: Papel, permissoes: ReadonlySet<Permissao>): boolean {
  if (typeof regra === "object" && "externos" in regra) {
    if ((regra.externos as readonly Papel[]).includes(papel)) return true;
    return regra.interna === undefined ? false : regraInternaPermite(regra.interna, papel, permissoes);
  }
  return regraInternaPermite(regra, papel, permissoes);
}
