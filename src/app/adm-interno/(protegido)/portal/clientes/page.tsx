import { prepararAdminComRegra, numeroPagina } from "@/lib/portal/andamento/admin";
import { listar } from "@/app/api/(modules)/adm-interno/portal/clientes/service";
import { Gestor } from "@/components/admin/portal/andamento/Gestor";
import { Paginacao } from "@/components/admin/portal/andamento/Paginacao";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clientes", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ pagina?: string }> }) {
  const { adminPath, permissoes } = await prepararAdminComRegra("clientes.ver");
  const pagina = numeroPagina((await searchParams).pagina);
  const lista = await listar({ pagina, limite: 50 });
  return (
    <div className="portal-entrada">
      <p className="portal-sobretitulo">Gestão do portal</p>
      <h1 className="portal-titulo">Clientes</h1>
      <p className="portal-descricao">
        A senha inicial não é exibida depois do cadastro: combine a entrega com o cliente por um canal seguro. Ele será obrigado a trocá-la no primeiro acesso.
        Para dar acesso a um empreendimento, vincule o cliente na tela do empreendimento.
      </p>
      <div className="portal-secao">
        <Gestor recurso="clientes" adminPath={adminPath} titulo="Contas de clientes" registros={lista.registros} somenteLeitura={!permissoes.has("clientes.editar")}
          camposCriar={[
            { nome: "nome", rotulo: "Nome" },
            { nome: "telefone", rotulo: "Telefone (opcional)", nullable: true },
            { nome: "identificador", rotulo: "E-mail ou usuário de acesso" },
            { nome: "senha", rotulo: "Senha inicial (10 a 128, com letra e número)", tipo: "senha" },
          ]}
          camposEditar={[
            { nome: "nome", rotulo: "Nome" },
            { nome: "telefone", rotulo: "Telefone", nullable: true },
            { nome: "ativo", rotulo: "Conta ativa", tipo: "boolean" },
          ]}
          iniciais={{ nome: "", telefone: null, identificador: "", senha: "" }} />
        <Paginacao pagina={pagina} proxima={lista.proximaPagina} base={`/${adminPath}/portal/clientes`} />
      </div>
    </div>
  );
}
