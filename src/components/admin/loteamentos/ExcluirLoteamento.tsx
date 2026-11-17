"use client";

import { useRouter } from "next/navigation";
import { ConfirmarExclusao } from "@/components/admin/comum/ConfirmarExclusao";
import { chamarApi } from "@/components/admin/comum/cliente-api";

type Props = {
  adminPath: string;
  loteamentoId: string;
  nome: string;
  totalLotes: number;
};

export function ExcluirLoteamento({ adminPath, loteamentoId, nome, totalLotes }: Props) {
  const router = useRouter();

  async function excluir() {
    const resposta = await chamarApi(adminPath, `loteamentos/${loteamentoId}`, "DELETE");
    if (!resposta.ok) return resposta.erro;

    router.push(`/${adminPath}/conteudo/loteamentos`);
    router.refresh();
    return null;
  }

  return (
    <ConfirmarExclusao
      rotulo="Excluir loteamento"
      aviso={`Excluir “${nome}”? Isso apaga também ${totalLotes} ${totalLotes === 1 ? "lote" : "lotes"}, a galeria e todos os arquivos enviados. Não dá para desfazer.`}
      aoConfirmar={excluir}
    />
  );
}
