import Link from "next/link";
import { ArrowUpRight, Building2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SeloSituacao } from "@/components/portal/comum/SeloSituacao";
import { exigirPapel } from "@/lib/auth/guard";
import { listarEmpreendimentos } from "@/lib/portal/comum/consultas";

export const dynamic = "force-dynamic";

export default async function ClientePage() {
  await exigirPapel(["cliente"], { semAcesso: "entrar" });
  const empreendimentos = await listarEmpreendimentos();
  const grupos = [
    { titulo: "Seus empreendimentos", registros: empreendimentos.filter((item) => item.situacao !== "arquivado") },
    { titulo: "Arquivados", registros: empreendimentos.filter((item) => item.situacao === "arquivado") },
  ];
  const situacoes = { ativo: "Em acompanhamento", concluido: "Concluído", arquivado: "Arquivado" };

  return (
    <div className="portal-entrada">
      <p className="portal-sobretitulo">Visão geral</p>
      <h1 className="portal-titulo">Cada etapa, mais perto de você.</h1>
      <p className="portal-descricao">Acompanhe seus empreendimentos, consulte documentos e veja as informações financeiras em um só lugar.</p>
      {empreendimentos.length === 0 && (
        <section className="portal-vazio" aria-labelledby="sem-vinculo">
          <Building2 size={28} aria-hidden="true" className="mb-4 text-primary" />
          <h2 id="sem-vinculo">Seus empreendimentos aparecerão aqui</h2>
          <p>Ainda não há um empreendimento vinculado ao seu acesso. Entre em contato com a equipe da ABA para conferir seu vínculo.</p>
          <Button asChild className="portal-botao mt-4"><Link href="/contato" prefetch={false}>Falar com a equipe <ArrowUpRight size={16} aria-hidden="true" /></Link></Button>
        </section>
      )}
      {grupos.filter((grupo) => grupo.registros.length > 0).map((grupo) => (
        <section className="portal-secao" key={grupo.titulo}>
          <h2>{grupo.titulo}</h2>
          <ul className="portal-grade">
            {grupo.registros.map((item) => (
              <li key={item.id}>
                <Card className="portal-cartao">
                  <SeloSituacao situacao={item.situacao}>{situacoes[item.situacao]}</SeloSituacao>
                  <h3>{item.nome}</h3>
                  <p className="flex items-center gap-2"><MapPin size={16} aria-hidden="true" />{item.cidade ?? "Cidade a informar"}</p>
                  <Button asChild className="portal-botao mt-auto self-start">
                    <Link href={`/cliente/empreendimentos/${item.id}`} prefetch={false} aria-label={`Acompanhar ${item.nome}`}>
                      Acompanhar empreendimento <ArrowUpRight size={18} aria-hidden="true" />
                    </Link>
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
