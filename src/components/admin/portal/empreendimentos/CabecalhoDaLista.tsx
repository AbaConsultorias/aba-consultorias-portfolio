"use client";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Formulario, type Campo } from "@/components/admin/portal/andamento/Formulario";
import { INICIAIS_EMPREENDIMENTO } from "@/components/admin/portal/andamento/campos";
import { criarSchema } from "@/app/api/(modules)/adm-interno/portal/empreendimentos/schema";

export function CabecalhoDaLista({ adminPath, podeCriar, camposCriar }: { adminPath: string; podeCriar: boolean; camposCriar: Campo[] }) {
  const [aberto, setAberto] = useState(false);
  const [aviso, setAviso] = useState("");
  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="portal-sobretitulo">Gestão do portal</p>
          <h1 className="portal-titulo">Empreendimentos</h1>
          <p className="portal-descricao">Prefira arquivar a excluir: o cliente continua vendo o histórico de um empreendimento arquivado.</p>
        </div>
        {podeCriar && (
          <Button type="button" className="portal-botao" aria-expanded={aberto} aria-controls="novo-empreendimento" onClick={() => { setAviso(""); setAberto(!aberto); }}>
            {aberto ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}{aberto ? "Fechar" : "Novo empreendimento"}
          </Button>
        )}
      </header>
      <p role="status" aria-live="polite" className="mt-3 text-sm">{aviso}</p>
      {podeCriar && aberto && (
        <section id="novo-empreendimento" aria-labelledby="titulo-novo-empreendimento" className="mt-4 rounded-2xl border bg-card p-5">
          <h2 id="titulo-novo-empreendimento" className="mb-5 text-lg font-medium">Novo empreendimento</h2>
          <Formulario schema={criarSchema} campos={camposCriar} valores={INICIAIS_EMPREENDIMENTO} endpoint={`/${adminPath}/api/portal/empreendimentos`} metodo="POST"
            rotulo="Criar empreendimento" aoSalvar={() => { setAberto(false); setAviso("Empreendimento criado."); }} />
        </section>
      )}
    </>
  );
}
