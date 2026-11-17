"use client";

import { useState } from "react";
import { Pencil, UserPlus, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Formulario, type Campo } from "@/components/admin/portal/andamento/Formulario";
import { criarContaSchema, atualizarContaSchema } from "@/lib/portal/comum/contas-schema";
import type { ContaPortal } from "@/lib/portal/comum/contas";

export type GestorContasProps = {
  adminPath: string;
  recurso: "clientes" | "empreiteiros" | "fornecedor-contas";
  rotulo: string;
  contas: readonly ContaPortal[];
  somenteLeitura?: boolean;
};

const CAMPOS_CRIAR: Campo[] = [
  { nome: "nome", rotulo: "Nome" },
  { nome: "telefone", rotulo: "Telefone (opcional)", nullable: true },
  { nome: "identificador", rotulo: "E-mail ou usuário de acesso" },
  { nome: "senha", rotulo: "Senha inicial (10 a 128 caracteres, com letra e número)", tipo: "senha" },
];
const CAMPOS_EDITAR: Campo[] = [
  { nome: "nome", rotulo: "Nome" },
  { nome: "telefone", rotulo: "Telefone (opcional)", nullable: true },
  { nome: "ativo", rotulo: "Conta ativa", tipo: "boolean" },
];
const INICIAIS = { nome: "", telefone: null, identificador: "", senha: "" };

export function GestorContas({ adminPath, recurso, rotulo, contas, somenteLeitura = false }: GestorContasProps) {
  const [editando, setEditando] = useState<string | null>(null);
  const endpoint = `/${adminPath}/api/portal/${recurso}`;
  return (
    <section className="space-y-6">
      <h2 className="text-xl font-medium">{rotulo}</h2>
      {!somenteLeitura && <>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Combine a entrega da senha inicial por um canal seguro. Ela não será exibida após o cadastro,
          e a troca será obrigatória no primeiro acesso. Os vínculos de acesso são feitos separadamente.
        </p>
        <details className="rounded-xl border bg-card p-5">
          <summary className="min-h-11 cursor-pointer font-medium">Adicionar conta</summary>
          <div className="mt-5">
            <Formulario schema={criarContaSchema} campos={CAMPOS_CRIAR} valores={INICIAIS}
              endpoint={endpoint} metodo="POST" rotulo="Criar conta" Icone={UserPlus} />
          </div>
        </details>
      </>}
      {!contas.length && <p className="portal-vazio">Nenhuma conta nesta página.</p>}
      <div className="space-y-4">
        {contas.map((conta) => (
          <Card key={conta.id} className="p-5">
            <h3 className="break-words font-semibold">{conta.nome}</h3>
            <p className="text-sm text-muted-foreground">
              {conta.ativo ? "Ativa" : "Inativa"}{conta.precisaTrocarSenha ? " · Troca de senha obrigatória" : ""}
            </p>
            {conta.telefone && <p className="text-sm text-muted-foreground">{conta.telefone}</p>}
            {!somenteLeitura && <>
              <Button variant="outline" className="self-start" aria-expanded={editando === conta.id}
                aria-controls={`conta-${conta.id}`} onClick={() => setEditando(editando === conta.id ? null : conta.id)}>
                {editando === conta.id ? <X aria-hidden="true" /> : <Pencil aria-hidden="true" />}{editando === conta.id ? "Fechar edição" : "Editar conta"}
              </Button>
              <div id={`conta-${conta.id}`} hidden={editando !== conta.id}>
                {editando === conta.id && <Formulario schema={atualizarContaSchema} campos={CAMPOS_EDITAR}
                  valores={{ id: conta.id, nome: conta.nome, telefone: conta.telefone, ativo: conta.ativo }}
                  endpoint={endpoint} metodo="PATCH" aoSalvar={() => setEditando(null)} />}
              </div>
            </>}
          </Card>
        ))}
      </div>
    </section>
  );
}
