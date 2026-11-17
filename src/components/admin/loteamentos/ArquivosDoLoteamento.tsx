"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CampoUpload } from "@/components/admin/comum/CampoUpload";
import { chamarApi } from "@/components/admin/comum/cliente-api";

type CampoDeArquivo = "capaPath" | "bannerPath" | "bannerMobilePath" | "mapaSvgPath";

type Props = {
  adminPath: string;
  loteamentoId: string;
  inicial: Record<CampoDeArquivo, string | null>;
};

// Cada arquivo é gravado no loteamento assim que o envio termina.
export function ArquivosDoLoteamento({ adminPath, loteamentoId, inicial }: Props) {
  const router = useRouter();
  const [caminhos, setCaminhos] = useState(inicial);

  function alterar(campo: CampoDeArquivo, recarregar = false) {
    return async (path: string | null) => {
      const resposta = await chamarApi(adminPath, `loteamentos/${loteamentoId}`, "PATCH", { [campo]: path });
      if (!resposta.ok) return resposta.erros[campo] ?? resposta.erro;

      setCaminhos((atual) => ({ ...atual, [campo]: path }));
      if (recarregar) router.refresh();
      return null;
    };
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <CampoUpload
        adminPath={adminPath}
        destino="loteamentos"
        donoId={loteamentoId}
        tipo="imagem"
        rotulo="Foto de capa (vista aérea)"
        dica="Aparece nos cartões e no topo da página. JPEG, PNG ou WebP, até 10 MB."
        valor={caminhos.capaPath}
        aoAlterar={alterar("capaPath")}
      />
      <CampoUpload
        adminPath={adminPath}
        destino="loteamentos"
        donoId={loteamentoId}
        tipo="imagem"
        rotulo="Banner (computador)"
        valor={caminhos.bannerPath}
        aoAlterar={alterar("bannerPath")}
      />
      <CampoUpload
        adminPath={adminPath}
        destino="loteamentos"
        donoId={loteamentoId}
        tipo="imagem"
        rotulo="Banner (celular)"
        dica="Se ficar vazio, o site usa o banner do computador. JPEG, PNG ou WebP, até 10 MB."
        valor={caminhos.bannerMobilePath}
        aoAlterar={alterar("bannerMobilePath")}
      />
      <CampoUpload
        adminPath={adminPath}
        destino="loteamentos"
        donoId={loteamentoId}
        tipo="mapa"
        rotulo="Mapa dos lotes (SVG)"
        dica="Cada lote do desenho precisa ter um id igual ao “código no mapa” do lote. SVG, até 2 MB."
        valor={caminhos.mapaSvgPath}
        aoAlterar={alterar("mapaSvgPath", true)}
      />
    </div>
  );
}
