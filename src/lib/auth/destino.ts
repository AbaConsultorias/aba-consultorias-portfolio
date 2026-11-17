import { obterAdminPath } from "./admin-path";
import { ehStaff, type Papel } from "./papeis";

const AREA_POR_PAPEL = {
  cliente: "/cliente",
  empreiteiro: "/empreiteiro",
  fornecedor: "/fornecedor",
} as const;

type PerfilParaDestino = { papel: Papel; precisa_trocar_senha: boolean };

// Staff devolve o caminho secreto (o navegador já o conhece por ter entrado
// por ele); se ADMIN_PATH não estiver configurado cai em "/", nunca no painel.
export function destinoAposLogin({ papel, precisa_trocar_senha }: PerfilParaDestino) {
  if (ehStaff(papel)) {
    const adminPath = obterAdminPath();
    if (!adminPath) return "/";
    return precisa_trocar_senha ? `/${adminPath}/trocar-senha` : `/${adminPath}`;
  }

  return precisa_trocar_senha ? "/trocar-senha" : AREA_POR_PAPEL[papel];
}
