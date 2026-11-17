"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Link2Off, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Formulario, type OpcaoCampo } from "@/components/admin/portal/andamento/Formulario";
import { criarSchema } from "@/app/api/(modules)/adm-interno/portal/empreendimento-clientes/schema";
import { ConfirmarRemocao } from "./ConfirmarRemocao";

export type VinculoDoEmpreendimento = { id: string; nomeDoCliente: string };

function LinhaDeVinculo({ vinculo, adminPath, podeEditar }: { vinculo: VinculoDoEmpreendimento; adminPath: string; podeEditar: boolean }) {
  const router = useRouter();
  const [removendo, setRemovendo] = useState(false);
  return (
    <li className="min-w-0 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-3 font-medium [overflow-wrap:anywhere]">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground" aria-hidden="true">{vinculo.nomeDoCliente.trim().charAt(0).toUpperCase()}</span>
          {vinculo.nomeDoCliente}
        </p>
        {podeEditar && (
          <Button type="button" variant="destructive" className="portal-botao shrink-0" onClick={() => setRemovendo(true)}><Link2Off aria-hidden="true" />Desvincular<span className="sr-only"> {vinculo.nomeDoCliente}</span></Button>
        )}
      </div>
      {podeEditar && removendo && (
        <div className="mt-4">
          <ConfirmarRemocao adminPath={adminPath} recurso="empreendimento-clientes" id={vinculo.id} aviso="O cliente perde o acesso a este empreendimento imediatamente. Confirmar remoção deste registro?"
            aoConcluir={() => { setRemovendo(false); router.refresh(); }} aoCancelar={() => setRemovendo(false)} />
        </div>
      )}
    </li>
  );
}

export function SecaoClientes({ adminPath, empreendimentoId, vinculos, podeEditar, opcoesClientes }: {
  adminPath: string; empreendimentoId: string; vinculos: VinculoDoEmpreendimento[]; podeEditar: boolean; opcoesClientes: OpcaoCampo[];
}) {
  const [vinculando, setVinculando] = useState(false);
  const [aviso, setAviso] = useState("");
  return (
    <section aria-labelledby="titulo-clientes" className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="titulo-clientes" className="text-xl font-medium">Clientes vinculados</h2>
        {podeEditar && (
          <Button type="button" className="portal-botao" aria-expanded={vinculando} aria-controls="novo-vinculo" onClick={() => { setAviso(""); setVinculando(!vinculando); }}>
            {vinculando ? <X aria-hidden="true" /> : <Link2 aria-hidden="true" />}{vinculando ? "Fechar" : "Vincular cliente"}
          </Button>
        )}
      </div>
      {podeEditar && <p className="text-sm text-muted-foreground">Remover o vínculo revoga o acesso do cliente imediatamente. Cadastre novos clientes na tela Clientes.</p>}
      {podeEditar && vinculando && (
        <div id="novo-vinculo" className="rounded-2xl border bg-card p-5">
          <Formulario schema={criarSchema} campos={[{ nome: "profileId", rotulo: "Cliente", tipo: "select", opcoes: opcoesClientes }]} valores={{ empreendimentoId, profileId: "" }}
            endpoint={`/${adminPath}/api/portal/empreendimento-clientes`} metodo="POST" rotulo="Vincular" Icone={Link2} aoSalvar={() => { setVinculando(false); setAviso("Cliente vinculado."); }} />
        </div>
      )}
      <p role="status" aria-live="polite" className="text-sm">{aviso}</p>
      {vinculos.length === 0 ? (
        <div className="portal-vazio flex flex-col items-center gap-3 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground"><Users className="size-7" aria-hidden="true" /></span>
          <h3 className="text-lg font-medium">Nenhum cliente vinculado</h3>
          {podeEditar && <p>Use “Vincular cliente” para dar acesso a este empreendimento.</p>}
        </div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {vinculos.map((vinculo) => <LinhaDeVinculo key={vinculo.id} vinculo={vinculo} adminPath={adminPath} podeEditar={podeEditar} />)}
        </ul>
      )}
    </section>
  );
}
