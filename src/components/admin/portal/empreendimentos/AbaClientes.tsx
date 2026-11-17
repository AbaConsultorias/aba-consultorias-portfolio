import { opcoes } from "@/lib/portal/andamento/admin";
import { listar as listarVinculos } from "@/app/api/(modules)/adm-interno/portal/empreendimento-clientes/service";
import { Paginacao } from "@/components/admin/portal/andamento/Paginacao";
import { SecaoClientes } from "./SecaoClientes";

// Só a página chama este componente, depois de conferir empreendimentos.ver e clientes.ver; clientes.editar decide se há vínculo a criar ou desfazer.
export async function AbaClientes({ adminPath, empreendimentoId, base, pagina, podeEditar }: {
  adminPath: string; empreendimentoId: string; base: string; pagina: number; podeEditar: boolean;
}) {
  const [vinculos, clientes] = await Promise.all([
    listarVinculos({ pagina, limite: 50, empreendimentoId }),
    podeEditar ? opcoes("profiles") : [],
  ]);
  return (
    <>
      <SecaoClientes adminPath={adminPath} empreendimentoId={empreendimentoId} podeEditar={podeEditar} opcoesClientes={clientes}
        vinculos={vinculos.registros.map((vinculo) => ({ id: vinculo.id, nomeDoCliente: vinculo.profiles.nome }))} />
      <Paginacao pagina={pagina} proxima={vinculos.proximaPagina} parametro="paginaVinculos" base={`${base}?aba=clientes`} />
    </>
  );
}
