"use client";

import { useState } from "react";
import type { ContaInterna } from "@/lib/portal/comum/contas-internas";
import { CartaoConta } from "./CartaoConta";
import { CriarConta } from "./CriarConta";
import { SenhaTemporaria } from "./SenhaTemporaria";

type Props = {
  adminPath: string;
  contas: readonly ContaInterna[];
};

type SenhaExibida = { titulo: string; valor: string; chave: number };

export function GestorEquipe({ adminPath, contas }: Props) {
  const [senha, setSenha] = useState<SenhaExibida | null>(null);

  function mostrarSenha(titulo: string, valor: string) {
    setSenha((atual) => ({ titulo, valor, chave: (atual?.chave ?? 0) + 1 }));
  }

  return (
    <section className="space-y-6">
      <h2 className="text-xl font-medium">Contas internas</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Cadastre os funcionários e escolha o que cada um pode acessar. A conta nova começa sem nenhum acesso até você
        marcar as permissões. A senha é gerada pelo sistema, aparece uma única vez e precisa ser trocada no primeiro acesso.
        Contas nunca são apagadas: para tirar o acesso de alguém, desative a conta.
      </p>
      {senha && <SenhaTemporaria key={senha.chave} titulo={senha.titulo} senha={senha.valor} aoFechar={() => setSenha(null)} />}
      <details className="rounded-xl border bg-card p-5">
        <summary className="min-h-11 cursor-pointer font-medium">Adicionar conta da equipe</summary>
        <div className="mt-5">
          <CriarConta adminPath={adminPath} aoCriar={(valor) => mostrarSenha("Conta criada. Senha temporária:", valor)} />
        </div>
      </details>
      {!contas.length && <p className="portal-vazio">Nenhuma conta interna encontrada.</p>}
      <div className="space-y-4">
        {contas.map((conta) => (
          <CartaoConta key={conta.id} adminPath={adminPath} conta={conta}
            aoNovaSenha={(valor) => mostrarSenha(`Nova senha de ${conta.nome}:`, valor)} />
        ))}
      </div>
    </section>
  );
}
