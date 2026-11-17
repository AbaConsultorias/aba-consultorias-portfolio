import { prepararAdminComRegra, numeroPagina } from "@/lib/portal/andamento/admin";
import { listar } from "@/app/api/(modules)/adm-interno/portal/modelos/service";
import { Paginacao } from "@/components/admin/portal/andamento/Paginacao";
import { GestaoDeModelos } from "@/components/admin/portal/modelos/GestaoDeModelos";
import type { Modelo } from "@/components/admin/portal/modelos/tipos";

export const dynamic = "force-dynamic";
export const metadata = { title: "Modelos de etapas", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ pagina?: string }> }) {
  const { adminPath, permissoes } = await prepararAdminComRegra("empreendimentos.ver");
  const pagina = numeroPagina((await searchParams).pagina);
  const lista = await listar({ pagina, limite: 50 });
  const modelos: Modelo[] = lista.registros.map((linha) => ({
    id: linha.id,
    nome: linha.nome,
    descricao: linha.descricao,
    ativo: linha.ativo,
    etapas: linha.modelo_etapas_itens.map(({ id, nome, ordem, marco }) => ({ id, nome, ordem, marco })),
    categorias: linha.modelo_categorias_documento.map(({ id, nome, ordem }) => ({ id, nome, ordem })),
  }));
  return (
    <div className="portal-entrada">
      <GestaoDeModelos adminPath={adminPath} modelos={modelos} podeEditar={permissoes.has("empreendimentos.editar")} />
      <Paginacao pagina={pagina} proxima={lista.proximaPagina} base={`/${adminPath}/portal/modelos`} />
    </div>
  );
}
