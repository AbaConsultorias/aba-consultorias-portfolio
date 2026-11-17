"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Formulario, type Campo } from "@/components/admin/portal/andamento/Formulario";
import { atualizarSchema } from "@/app/api/(modules)/adm-interno/portal/empreendimentos/schema";
import { ConfirmarRemocao } from "./ConfirmarRemocao";
import { SeloSituacao, type SituacaoEmpreendimento } from "./Selos";

type Props = {
  adminPath: string;
  id: string;
  nome: string;
  situacao: SituacaoEmpreendimento;
  valoresDeEdicao: Record<string, unknown>;
  camposDeEdicao: Campo[];
  hrefAtualizacoes: string | null;
  podeEditar: boolean;
  podeExcluir: boolean;
  iniciarEditando: boolean;
};

export function CabecalhoDoEmpreendimento({ adminPath, id, nome, situacao, valoresDeEdicao, camposDeEdicao, hrefAtualizacoes, podeEditar, podeExcluir, iniciarEditando }: Props) {
  const router = useRouter();
  const [editando, setEditando] = useState(podeEditar && iniciarEditando);
  const [excluindo, setExcluindo] = useState(false);
  const [aviso, setAviso] = useState("");
  const hrefLista = `/${adminPath}/portal/empreendimentos`;
  return (
    <header className="space-y-4">
      <Link className="portal-voltar" href={hrefLista} prefetch={false}><ArrowLeft size={16} aria-hidden="true" />Todos os empreendimentos</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="min-w-0 text-[clamp(1.75rem,4vw,2.5rem)] font-medium leading-tight tracking-[-0.03em] [overflow-wrap:anywhere]">{nome}</h1>
          <SeloSituacao situacao={situacao} />
        </div>
        <div className="flex flex-wrap gap-2">
          {podeEditar && (
            <Button type="button" variant="outline" className="portal-botao" aria-expanded={editando} aria-controls="editar-empreendimento" onClick={() => { setAviso(""); setEditando(!editando); setExcluindo(false); }}>
              {editando ? <X aria-hidden="true" /> : <Pencil aria-hidden="true" />}{editando ? "Fechar edição" : "Editar"}
            </Button>
          )}
          {hrefAtualizacoes && (
            <Button asChild variant="outline" className="portal-botao"><Link href={hrefAtualizacoes} prefetch={false}><Camera aria-hidden="true" />Atualizações e fotos</Link></Button>
          )}
          {podeEditar && podeExcluir && (
            <Button type="button" variant="destructive" className="portal-botao" onClick={() => { setExcluindo(true); setEditando(false); }}><Trash2 aria-hidden="true" />Excluir</Button>
          )}
        </div>
      </div>
      {podeEditar && editando && (
        <section id="editar-empreendimento" aria-labelledby="titulo-editar-empreendimento" className="rounded-2xl border bg-card p-5">
          <h2 id="titulo-editar-empreendimento" className="mb-5 text-lg font-medium">Editar dados</h2>
          <Formulario schema={atualizarSchema} campos={camposDeEdicao} valores={valoresDeEdicao} endpoint={`/${adminPath}/api/portal/empreendimentos`} metodo="PATCH"
            aoSalvar={() => { setEditando(false); setAviso("Alteração salva."); }} />
        </section>
      )}
      {podeEditar && podeExcluir && excluindo && (
        <ConfirmarRemocao adminPath={adminPath} recurso="empreendimentos" id={id} aviso="Prefira arquivar para preservar o histórico. Confirmar remoção deste registro?"
          aoConcluir={() => { router.push(hrefLista); router.refresh(); }} aoCancelar={() => setExcluindo(false)} />
      )}
      <p role="status" aria-live="polite" className="text-sm">{aviso}</p>
    </header>
  );
}
