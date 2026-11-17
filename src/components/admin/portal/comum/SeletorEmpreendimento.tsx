import Link from "next/link";
import { Building2, ChevronRight, MapPin } from "lucide-react";

export type OpcaoEmpreendimento = { id: string; nome: string; cidade?: string | null };

// Cartões clicáveis para escolher o empreendimento nas telas do admin do portal.
export function SeletorEmpreendimento({ itens, atualId, href, compacto = false }: {
  itens: OpcaoEmpreendimento[];
  atualId?: string;
  href: (id: string) => string;
  // Com um empreendimento já aberto, os cartões ficam menores para não empurrar o conteúdo.
  compacto?: boolean;
}) {
  return (
    <nav aria-label="Empreendimentos" className="seletor-emp" data-compacto={compacto}>
      {itens.map((item) => {
        const atual = item.id === atualId;
        return (
          <Link key={item.id} href={href(item.id)} prefetch={false} aria-current={atual ? "page" : undefined} className="seletor-emp-cartao">
            <span className="seletor-emp-icone" aria-hidden="true"><Building2 size={compacto ? 16 : 20} /></span>
            <span className="seletor-emp-texto">
              <span className="seletor-emp-nome">{item.nome}</span>
              {item.cidade && !compacto && <span className="seletor-emp-cidade"><MapPin size={12} aria-hidden="true" />{item.cidade}</span>}
            </span>
            <ChevronRight size={16} className="seletor-emp-seta" aria-hidden="true" />
          </Link>
        );
      })}
    </nav>
  );
}
