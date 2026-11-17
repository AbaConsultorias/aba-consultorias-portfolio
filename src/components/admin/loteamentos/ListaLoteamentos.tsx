"use client";

import Image from "next/image";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { BotaoPublicar } from "@/components/admin/comum/BotaoPublicar";
import { ListaOrdenavel } from "@/components/admin/comum/ListaOrdenavel";
import { urlPublica } from "@/lib/conteudo/url";
import { cn } from "@/lib/utils";
import type { ResumoLoteamentoAdmin } from "./consultas";

type Props = {
  adminPath: string;
  loteamentos: ResumoLoteamentoAdmin[];
};

export function ListaLoteamentos({ adminPath, loteamentos }: Props) {
  return (
    <ListaOrdenavel
      key={loteamentos.map((loteamento) => loteamento.id).join(",")}
      adminPath={adminPath}
      caminhoOrdem="loteamentos/ordem"
      rotulo="Loteamentos, na ordem em que aparecem no site"
      itens={loteamentos.map((loteamento) => ({
        id: loteamento.id,
        conteudo: (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative h-20 w-full shrink-0 overflow-hidden rounded-lg bg-muted sm:w-32">
              {loteamento.capaPath && (
                <Image
                  src={urlPublica(loteamento.capaPath)}
                  alt={`Capa do ${loteamento.nome}`}
                  fill
                  sizes="(min-width: 640px) 8rem, 100vw"
                  unoptimized
                  className="object-cover"
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{loteamento.nome}</p>
              <p className="truncate text-sm text-muted-foreground">
                {loteamento.cidade ?? "Cidade não informada"}
              </p>
              <p className="text-sm text-muted-foreground">
                {loteamento.totalLotes === 0
                  ? "Nenhum lote cadastrado"
                  : `${loteamento.disponiveis} disponíveis de ${loteamento.totalLotes} lotes`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <BotaoPublicar
                adminPath={adminPath}
                caminho={`loteamentos/${loteamento.id}`}
                publicado={loteamento.publicado}
                rotulo={loteamento.nome}
              />
              <Link
                href={`/${adminPath}/conteudo/loteamentos/${loteamento.id}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                aria-label={`Editar ${loteamento.nome}`}
              >
                <Pencil aria-hidden="true" />
                Editar
              </Link>
            </div>
          </div>
        ),
      }))}
    />
  );
}
