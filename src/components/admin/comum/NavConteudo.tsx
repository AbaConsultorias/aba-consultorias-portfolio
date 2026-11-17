"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  ExternalLink,
  Film,
  Handshake,
  Image as IconeImagem,
  LayoutDashboard,
  Mail,
  Menu,
  MessageSquareQuote,
  Settings,
  Wrench,
  X,
  Landmark,
  type LucideIcon,
} from "lucide-react";
import type { Permissao } from "@/lib/auth/permissoes";
import { cn } from "@/lib/utils";

type ItemDoMenu = { slug: string; rotulo: string; Icone: LucideIcon; permissao?: Permissao };

export const ITENS_DO_MENU: ItemDoMenu[] = [
  { slug: "", rotulo: "Painel", Icone: LayoutDashboard },
  { slug: "topo", rotulo: "Topo do site", Icone: IconeImagem, permissao: "site.ver" },
  { slug: "servicos", rotulo: "Serviços", Icone: Wrench, permissao: "site.ver" },
  { slug: "projetos", rotulo: "Projetos", Icone: Building2, permissao: "site.ver" },
  { slug: "loteamentos", rotulo: "Loteamentos", Icone: Landmark, permissao: "site.ver" },
  { slug: "depoimentos", rotulo: "Depoimentos e avaliações", Icone: MessageSquareQuote, permissao: "site.ver" },
  { slug: "parceiros", rotulo: "Parceiros", Icone: Handshake, permissao: "site.ver" },
  { slug: "videos", rotulo: "Vídeos do Instagram", Icone: Film, permissao: "site.ver" },
  { slug: "configuracoes", rotulo: "Configurações", Icone: Settings, permissao: "site.ver" },
  { slug: "contatos", rotulo: "Contatos recebidos", Icone: Mail, permissao: "contatos.ver" },
];

export function NavConteudo({ adminPath, permissoes }: { adminPath: string; permissoes: readonly Permissao[] }) {
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);
  const base = `/${adminPath}/conteudo`;

  function estaAtivo(slug: string) {
    const destino = slug ? `${base}/${slug}` : base;
    return slug ? pathname === destino || pathname.startsWith(`${destino}/`) : pathname === base;
  }

  return (
    <nav aria-label="Seções do conteúdo" className="md:w-60 md:shrink-0">
      <button
        type="button"
        aria-expanded={aberto}
        aria-controls="menu-conteudo"
        onClick={() => setAberto((valor) => !valor)}
        className="flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden"
      >
        Menu do conteúdo
        {aberto ? <X aria-hidden="true" className="size-4" /> : <Menu aria-hidden="true" className="size-4" />}
      </button>

      <ul
        id="menu-conteudo"
        className={cn("mt-2 flex-col gap-1 md:mt-0 md:flex md:sticky md:top-4", aberto ? "flex" : "hidden")}
      >
        {ITENS_DO_MENU.filter((item) => !item.permissao || permissoes.includes(item.permissao)).map(({ slug, rotulo, Icone }) => {
          const ativo = estaAtivo(slug);
          return (
            <li key={slug || "painel"}>
              <Link
                href={slug ? `${base}/${slug}` : base}
                aria-current={ativo ? "page" : undefined}
                onClick={() => setAberto(false)}
                className={cn(
                  "flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                  ativo ? "bg-primary font-medium text-primary-foreground" : "hover:bg-muted",
                )}
              >
                <Icone aria-hidden="true" className="size-4 shrink-0" />
                {rotulo}
              </Link>
            </li>
          );
        })}
        <li className="mt-1 border-t border-border pt-2">
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
            Ver site
          </a>
        </li>
      </ul>
    </nav>
  );
}
