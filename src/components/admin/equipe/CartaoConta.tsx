"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Power, PowerOff, ShieldCheck, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ContaInterna } from "@/lib/portal/comum/contas-internas";
import { chamarEquipe } from "./chamarEquipe";
import { ConfirmarAcao } from "./ConfirmarAcao";
import { EditorPermissoes } from "./EditorPermissoes";


type Props = {
  adminPath: string;
  conta: ContaInterna;
  aoNovaSenha: (senhaTemporaria: string) => void;
};


// Fuso fixo: o mesmo texto no servidor e no navegador, sem aviso de hidratação.
function ultimoAcessoEmTexto(ultimoAcesso: string | null) {
  if (!ultimoAcesso) return "Nunca entrou";
  const data = new Date(ultimoAcesso);
  if (Number.isNaN(data.getTime())) return "Nunca entrou";
  return data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
}

function resumoDeAcesso(conta: ContaInterna) {
  if (conta.papel === "admin") return "Acesso total";
  const total = conta.permissoes.length;
  if (total === 0) return "Sem nenhum acesso";
  return total === 1 ? "1 permissão" : `${total} permissões`;
}

export function CartaoConta({ adminPath, conta, aoNovaSenha }: Props) {
  const router = useRouter();
  const [editandoPermissoes, setEditandoPermissoes] = useState(false);
  const ehEquipe = conta.papel === "equipe";

  async function alterarSituacao(ativo: boolean) {
    const resposta = await chamarEquipe(adminPath, "", "PATCH", { id: conta.id, nome: conta.nome, telefone: conta.telefone, ativo });
    if (!resposta.ok) return resposta.erro;
    router.refresh();
    return null;
  }

  async function redefinirSenha() {
    const resposta = await chamarEquipe<{ senhaTemporaria: string }>(adminPath, `/${conta.id}/senha`, "POST");
    if (!resposta.ok) return resposta.erro;
    aoNovaSenha(resposta.dados.senhaTemporaria);
    router.refresh();
    return null;
  }

  return (
    <Card className="p-5">
      <h3 className="break-words font-semibold">{conta.nome}</h3>
      <dl className="grid gap-x-4 gap-y-1 text-sm text-muted-foreground sm:grid-cols-[auto_1fr]">
        <dt>E-mail de acesso</dt>
        <dd className="break-all">{conta.identificador}</dd>
        <dt>Função</dt>
        <dd>{conta.papel === "admin" ? "Administrador" : "Equipe"} · {resumoDeAcesso(conta)}</dd>
        <dt>Situação</dt>
        <dd>{conta.ativo ? "Ativa" : "Inativa"}{conta.precisaTrocarSenha ? " · Troca de senha pendente" : ""}</dd>
        <dt>Último acesso</dt>
        <dd>{ultimoAcessoEmTexto(conta.ultimoAcesso)}</dd>
      </dl>
      {ehEquipe && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="min-h-11" aria-expanded={editandoPermissoes}
            aria-controls={`permissoes-${conta.id}`} onClick={() => setEditandoPermissoes(!editandoPermissoes)}>
            {editandoPermissoes ? <X aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
            {editandoPermissoes ? "Fechar permissões" : "Permissões"}
          </Button>
          {conta.ativo ? (
            <>
              <ConfirmarAcao rotulo="Redefinir senha" icone={<KeyRound aria-hidden="true" />} rotuloConfirmar="Sim, gerar nova senha"
                aviso="A senha atual deixa de valer e uma nova é gerada. Ela aparece só uma vez, e a pessoa terá de trocá-la ao entrar."
                aoConfirmar={redefinirSenha} />
              <ConfirmarAcao rotulo="Desativar" perigosa icone={<PowerOff aria-hidden="true" />} rotuloConfirmar="Sim, desativar"
                aviso="A pessoa perde o acesso agora e não consegue entrar de novo. A conta não é apagada e pode ser reativada."
                aoConfirmar={() => alterarSituacao(false)} />
            </>
          ) : (
            <ConfirmarAcao rotulo="Reativar" icone={<Power aria-hidden="true" />} rotuloConfirmar="Sim, reativar"
              aviso="A pessoa volta a poder entrar com a senha que já tinha, com as permissões salvas."
              aoConfirmar={() => alterarSituacao(true)} />
          )}
        </div>
      )}
      {ehEquipe && editandoPermissoes && (
        <div id={`permissoes-${conta.id}`}>
          <EditorPermissoes adminPath={adminPath} contaId={conta.id} permissoes={conta.permissoes} />
        </div>
      )}
    </Card>
  );
}
