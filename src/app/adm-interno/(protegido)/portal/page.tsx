import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Building2, Users, ListChecks, Newspaper, Files, Wallet, HardHat, ClipboardCheck, Truck, CalendarRange, FileCheck, HandCoins } from "lucide-react";
import { Card } from "@/components/ui/card";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { exigirContaInterna } from "@/lib/auth/permissoes-servidor";
import { avisoDeRegrasOrfas } from "@/app/api/(modules)/adm-interno/portal/pasta-regras/service";
import { AvisoDeRegrasOrfas } from "@/components/admin/portal/pasta/AvisoDeRegrasOrfas";
import { PERMISSAO_POR_SEGMENTO } from "@/components/admin/portal/comum/acesso-portal";
import { listarACobrar } from "@/lib/portal/financeiro/consultas";
import { DIAS_VENCE_EM_BREVE } from "@/lib/portal/financeiro/regras";

const ATALHOS = [
  { rota: "empreendimentos", titulo: "Empreendimentos", descricao: "Projetos, etapas e vínculos de cada empreendimento.", Icone: Building2 },
  { rota: "clientes", titulo: "Clientes", descricao: "Cadastro e manutenção dos acessos de clientes.", Icone: Users },
  { rota: "modelos", titulo: "Modelos", descricao: "Etapas e categorias para novos projetos.", Icone: ListChecks },
  { rota: "atualizacoes", titulo: "Atualizações", descricao: "Notícias, visitas e fotos do acompanhamento.", Icone: Newspaper },
  { rota: "documentos", titulo: "Documentos", descricao: "Envio de PDFs e liberação para clientes.", Icone: Files },
  { rota: "financeiro", titulo: "Financeiro", descricao: "Valores contratados, parcelas e pagamentos.", Icone: Wallet },
  { rota: "a-cobrar", titulo: "A cobrar", descricao: "Parcelas vencidas e as que vencem nos próximos 15 dias.", Icone: HandCoins },
  { rota: "obras", titulo: "Obras", descricao: "Situação das obras e empreiteiros responsáveis.", Icone: HardHat },
  { rota: "relatos", titulo: "Relatos", descricao: "Revisão dos relatos enviados pelos empreiteiros.", Icone: ClipboardCheck },
  { rota: "empreiteiros", titulo: "Empreiteiros", descricao: "Cadastro e manutenção dos acessos de empreiteiros.", Icone: Users },
  { rota: "fornecedores", titulo: "Fornecedores", descricao: "Cadastro, contas de acesso e contratos.", Icone: Truck },
  { rota: "fornecedor-documentos", titulo: "Documentos de fornecedores", descricao: "Revisão dos documentos enviados pelos fornecedores.", Icone: FileCheck },
  { rota: "cronograma", titulo: "Cronograma", descricao: "Previsão de pagamentos de cada empreendimento por mês.", Icone: CalendarRange },
] as const;

export default async function PortalPage() {
  const { permissoes } = await exigirContaInterna();
  const adminPath = obterAdminPath();
  if (!adminPath) notFound();
  // Só quem gerencia as regras de pasta vê o aviso; se a leitura falhar, o painel abre sem ele.
  const regrasOrfas = permissoes.has("servidor.regras") ? await avisoDeRegrasOrfas().catch(() => null) : null;
  // O contador é um complemento: se a contagem falhar, o painel abre sem ele.
  const aCobrar = permissoes.has("financeiro.ver") ? await listarACobrar(DIAS_VENCE_EM_BREVE).then((parcelas) => parcelas.length).catch(() => null) : null;
  return (
    <div className="portal-entrada">
      <p className="portal-sobretitulo">Gestão do portal</p>
      <h1 className="portal-titulo">Acompanhamento próximo, informação organizada.</h1>
      <p className="portal-descricao">Gerencie os empreendimentos e as informações disponibilizadas aos clientes.</p>
      {regrasOrfas && <AvisoDeRegrasOrfas adminPath={adminPath} aviso={regrasOrfas} />}
      <ul className="portal-grade portal-secao">
        {ATALHOS.filter(({ rota }) => permissoes.has(PERMISSAO_POR_SEGMENTO[rota])).map(({ rota, titulo, descricao, Icone }) => (
          <li key={rota}>
            <Card className="portal-cartao">
              <Icone size={24} aria-hidden="true" className="text-primary" />
              <h2 className="flex items-center gap-2 text-lg font-medium">
                {titulo}
                {rota === "a-cobrar" && aCobrar ? (
                  <span className="rounded-full bg-primary px-2 text-xs font-semibold text-primary-foreground" aria-label={`${aCobrar} parcelas vencidas ou a vencer`}>{aCobrar}</span>
                ) : null}
              </h2>
              <p>{descricao}</p>
              <Link href={`/${adminPath}/portal/${rota}`} prefetch={false} aria-label={`Gerenciar ${titulo.toLowerCase()}`}>
                Gerenciar <ArrowUpRight size={18} aria-hidden="true" />
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
