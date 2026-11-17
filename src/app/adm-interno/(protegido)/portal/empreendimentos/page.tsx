import { prepararAdminComRegra, numeroPagina, opcoesDeCampo } from "@/lib/portal/andamento/admin";
import { listarOpcoesLoteamentos } from "@/lib/portal/comum/opcoes";
import { contarPorColuna } from "@/lib/portal/empreendimentos/indicadores";
import { listar, permissoesDaPasta } from "@/app/api/(modules)/adm-interno/portal/empreendimentos/service";
import { Paginacao } from "@/components/admin/portal/andamento/Paginacao";
import { camposEmpreendimento } from "@/components/admin/portal/andamento/campos";
import { CabecalhoDaLista } from "@/components/admin/portal/empreendimentos/CabecalhoDaLista";
import { ListaEmpreendimentos } from "@/components/admin/portal/empreendimentos/ListaEmpreendimentos";
import type { ItemEmpreendimento } from "@/components/admin/portal/empreendimentos/CartaoEmpreendimento";

export const dynamic = "force-dynamic";
export const metadata = { title: "Empreendimentos", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ pagina?: string }> }) {
  const acesso = await prepararAdminComRegra("empreendimentos.ver");
  const { adminPath, permissoes } = acesso;
  const pasta = permissoesDaPasta(acesso);
  const pagina = numeroPagina((await searchParams).pagina);
  const podeEditar = permissoes.has("empreendimentos.editar");
  const [lista, loteamentos] = await Promise.all([listar({ pagina, limite: 100 }, pasta.podeRegras), podeEditar ? listarOpcoesLoteamentos() : []]);
  const ids = lista.registros.map((registro) => registro.id);
  const [projetos, clientes, ocultos] = await Promise.all([
    contarPorColuna({ tabela: "projetos", coluna: "empreendimento_id", ids }),
    permissoes.has("clientes.ver") ? contarPorColuna({ tabela: "empreendimento_clientes", coluna: "empreendimento_id", ids }) : undefined,
    permissoes.has("documentos.ver") ? contarPorColuna({ tabela: "documentos", coluna: "empreendimento_id", ids, apenasOcultos: true }) : undefined,
  ]);
  const itens: ItemEmpreendimento[] = lista.registros.map((registro) => ({
    id: registro.id,
    nome: registro.nome,
    situacao: registro.situacao,
    projetos: projetos ? projetos.get(registro.id) ?? 0 : null,
    ...(clientes !== undefined ? { clientes: clientes ? clientes.get(registro.id) ?? 0 : null } : {}),
    ...(ocultos !== undefined ? { ocultos: ocultos ? ocultos.get(registro.id) ?? 0 : null } : {}),
    ...(pasta.podeRegras ? { codigoPasta: registro.codigo_pasta ?? null } : {}),
  }));
  return (
    <div className="portal-entrada">
      <CabecalhoDaLista adminPath={adminPath} podeCriar={podeEditar} camposCriar={camposEmpreendimento(opcoesDeCampo(loteamentos))} />
      <ListaEmpreendimentos itens={itens} adminPath={adminPath} podeEditar={podeEditar} parcial={pagina > 1 || lista.proximaPagina !== null} />
      <Paginacao pagina={pagina} proxima={lista.proximaPagina} base={`/${adminPath}/portal/empreendimentos`} />
    </div>
  );
}
