import Link from "next/link";
import { EyeOff, FolderOpen, Layers, Pencil, Users, type LucideIcon } from "lucide-react";
import { SeloSituacao, plural, type SituacaoEmpreendimento } from "./Selos";

// undefined: a pessoa não pode ver essa tabela, o indicador some. null: a contagem falhou, o indicador fica sem o número.
export type ItemEmpreendimento = {
  id: string;
  nome: string;
  situacao: SituacaoEmpreendimento;
  projetos: number | null;
  clientes?: number | null;
  ocultos?: number | null;
  codigoPasta?: string | null;
};

function Indicador({ Icone, valor, singular, pluralDe }: { Icone: LucideIcon; valor: number | null; singular: string; pluralDe: string }) {
  return (
    <li className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <Icone className="size-4 shrink-0" aria-hidden="true" />
      {valor === null
        ? <span>{pluralDe.charAt(0).toUpperCase() + pluralDe.slice(1)}: <span aria-label="indisponível">—</span></span>
        : <span>{plural(valor, singular, pluralDe)}</span>}
    </li>
  );
}

export function CartaoEmpreendimento({ item, adminPath, podeEditar }: { item: ItemEmpreendimento; adminPath: string; podeEditar: boolean }) {
  const href = `/${adminPath}/portal/empreendimentos/${item.id}`;
  return (
    <li className="group relative flex min-w-0 flex-col gap-4 rounded-2xl border bg-card p-5 transition-colors hover:border-primary/50 focus-within:border-primary/50">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-lg font-medium leading-snug [overflow-wrap:anywhere]">
          <Link href={href} prefetch={false} className="rounded-sm after:absolute after:inset-0 after:rounded-2xl after:content-['']">{item.nome}</Link>
        </h3>
        {podeEditar && (
          <Link href={`${href}?editar=1`} prefetch={false} aria-label={`Editar ${item.nome}`} title="Editar"
            className="relative z-10 -mr-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
            <Pencil className="size-4" aria-hidden="true" />
          </Link>
        )}
      </div>
      <div><SeloSituacao situacao={item.situacao} /></div>
      <ul className="mt-auto flex flex-wrap gap-x-4 gap-y-2" aria-label="Indicadores">
        <Indicador Icone={Layers} valor={item.projetos} singular="projeto" pluralDe="projetos" />
        {item.clientes !== undefined && <Indicador Icone={Users} valor={item.clientes} singular="cliente" pluralDe="clientes" />}
        {item.ocultos !== undefined && item.ocultos !== 0 && <Indicador Icone={EyeOff} valor={item.ocultos} singular="documento oculto" pluralDe="documentos ocultos" />}
        {item.codigoPasta && (
          <li className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <FolderOpen className="size-4 shrink-0" aria-hidden="true" />
            <span>Pasta <span className="font-mono">{item.codigoPasta}</span></span>
          </li>
        )}
      </ul>
    </li>
  );
}
