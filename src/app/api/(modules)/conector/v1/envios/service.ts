import "server-only";
import type { ConectorAutenticado } from "@/lib/conector/autenticacao";
import {
  buscarUltimoConfirmado,
  type BancoAdmin,
  type DependenciasConector,
  dependenciasPadrao,
  existeConfirmadoComSha,
  falhaDeBanco,
} from "@/lib/conector/dependencias";
import { classificarEquipamento, MOTIVO_FORA_DO_PADRAO } from "@/lib/conector/equipamentos";
import {
  caminhoBloqueado,
  caminhoParaRegistro,
  casarRegra,
  LIMITE_BYTES_POR_DIA,
  LIMITE_ENVIOS_POR_DIA,
  LIMITE_PDF_BYTES,
  type RegraDeCaminho,
  validarCaminho,
  VALIDADE_DA_AUTORIZACAO_MS,
} from "@/lib/conector/regras";
import { erroDeLimite } from "@/lib/conector/resposta";
import { motivoDeRecusaDoCaminho } from "@/lib/conector/sinais";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EnvioInput } from "./schema";

export type RespostaDeEnvio =
  | { estado: "autorizado"; envio_id: string; url: string; cabecalhos: Record<string, string>; expira_em: string }
  | { estado: "ja_enviado" }
  | { estado: "duplicado" }
  | { estado: "recusado"; motivo: string };

type Empreendimento = { id: string; situacao: string };
type EstadoGravado = "recusado" | "duplicado";
type Reserva = { reservado: true; envio_id: string } | { reservado: false; tentar_depois_s: number };

// A coluna mtime é timestamptz: datas fora de uma faixa plausível (ano 0000, 9999) viram "sem data".
function mtimeParaBanco(mtime: string | null | undefined): string | null {
  if (!mtime) return null;
  const data = new Date(mtime);
  const ano = data.getUTCFullYear();
  return Number.isNaN(data.getTime()) || ano < 1970 || ano > 2100 ? null : data.toISOString();
}

async function buscarEmpreendimento(banco: BancoAdmin, codigoPasta: string): Promise<Empreendimento | null> {
  const { data, error } = await banco.from("empreendimentos").select("id,situacao").eq("codigo_pasta", codigoPasta).maybeSingle();
  if (error) return falhaDeBanco("envios: consulta do empreendimento:", error);
  return (data as Empreendimento | null) ?? null;
}

type RegraAtiva = RegraDeCaminho & { tipo?: string };

async function regrasAtivas(banco: BancoAdmin, empreendimentoId: string): Promise<RegraAtiva[]> {
  const { data, error } = await banco.from("pasta_regras").select("id,caminho_prefixo,tipo")
    .eq("empreendimento_id", empreendimentoId).eq("ativa", true);
  if (error) return falhaDeBanco("envios: consulta das regras:", error);
  return (data ?? []) as RegraAtiva[];
}

export async function pedirAutorizacao(
  entrada: EnvioInput,
  conector: ConectorAutenticado,
  dependencias: DependenciasConector = dependenciasPadrao,
  banco: BancoAdmin = createAdminClient(),
): Promise<RespostaDeEnvio> {
  const empreendimento = await buscarEmpreendimento(banco, entrada.codigo_pasta);
  // Sem empreendimento não há onde registrar: conector_envios exige empreendimento_id.
  if (!empreendimento) return { estado: "recusado", motivo: "Empreendimento não encontrado." };

  const agoraMs = dependencias.agora();
  const caminho = validarCaminho(entrada.caminho_relativo);
  const linhaBase = {
    conector_id: conector.id,
    empreendimento_id: empreendimento.id,
    caminho_relativo: caminho.valido ? caminho.caminho : caminhoParaRegistro(entrada.caminho_relativo),
    tamanho: entrada.tamanho,
    sha256: entrada.sha256,
    mtime: mtimeParaBanco(entrada.mtime),
    em: new Date(agoraMs).toISOString(),
  };

  const gravar = async (estado: EstadoGravado, extra: Record<string, unknown>): Promise<string> => {
    const { data, error } = await banco.from("conector_envios").insert({ ...linhaBase, estado, ...extra }).select("id").single();
    if (error) return falhaDeBanco("envios: gravação do envio:", error);
    return (data as { id: string }).id;
  };
  const recusar = async (motivo: string, regraId: string | null = null): Promise<RespostaDeEnvio> => {
    await gravar("recusado", { regra_id: regraId, erro: motivo });
    return { estado: "recusado", motivo };
  };

  if (empreendimento.situacao !== "ativo") return recusar("Empreendimento inativo.");
  if (!caminho.valido) return recusar(caminho.motivo);
  if (caminhoBloqueado(caminho.caminho)) return recusar("Caminho bloqueado.");
  if (entrada.tamanho === 0) return recusar("Arquivo vazio.");
  if (entrada.tamanho > LIMITE_PDF_BYTES) return recusar("PDF acima de 100 MB.");

  const regra = casarRegra(caminho.caminho, await regrasAtivas(banco, empreendimento.id));
  if (!regra) return recusar("Caminho fora de qualquer regra.");
  // Pastas 99 - OUTROS / antigas e pastas FINANCEIRO abaixo do prefixo valem para qualquer regra; protocolos e devolutivas aceitam só o próprio formato.
  const motivoDoCaminho = motivoDeRecusaDoCaminho(caminho.caminho, regra);
  if (motivoDoCaminho) return recusar(motivoDoCaminho, regra.id);
  // Regra de SIMOS e Laudos: só dois formatos de caminho sobem; o resto é recusado (o programa guarda a recusa).
  if (regra.tipo === "equipamentos" && !classificarEquipamento(caminho.caminho, regra.caminho_prefixo)) {
    return recusar(MOTIVO_FORA_DO_PADRAO, regra.id);
  }

  const anterior = await buscarUltimoConfirmado(banco, empreendimento.id, caminho.caminho);
  if (anterior?.sha256 === entrada.sha256) return { estado: "ja_enviado" };

  if (await existeConfirmadoComSha(banco, empreendimento.id, entrada.sha256)) {
    await gravar("duplicado", { regra_id: regra.id, erro: "Mesmo conteúdo já enviado por outro caminho." });
    return { estado: "duplicado" };
  }

  const documentoId = dependencias.novoId();
  const storagePath = `${empreendimento.id}/${documentoId}.pdf`;
  // Assina antes de reservar: se o R2 falhar, nenhuma autorização fica registrada sem URL entregue. A URL de um
  // pedido que estoura o limite nunca é entregue.
  const { url, cabecalhos } = await dependencias.armazenamento.criarUrlAssinada(storagePath, {
    tamanho: entrada.tamanho,
    sha256: entrada.sha256,
  });

  // Limites diários (janela móvel de 24 h; recusados e duplicados não contam): a contagem e o INSERT são uma
  // transação só, serializada por chave, senão pedidos simultâneos passam dos 200 envios ou dos 2 GB.
  const { data, error } = await banco.rpc("reservar_envio_conector", {
    p_conector: conector.id,
    p_empreendimento: empreendimento.id,
    p_regra: regra.id,
    p_caminho: linhaBase.caminho_relativo,
    p_tamanho: entrada.tamanho,
    p_sha256: entrada.sha256,
    p_mtime: linhaBase.mtime,
    p_documento: documentoId,
    p_storage_path: storagePath,
    p_agora: linhaBase.em,
    p_limite_envios: LIMITE_ENVIOS_POR_DIA,
    p_limite_bytes: LIMITE_BYTES_POR_DIA,
  });
  if (error) return falhaDeBanco("envios: reserva do envio:", error);
  const reserva = data as Reserva | null;
  if (!reserva) return falhaDeBanco("envios: reserva do envio:", { code: "vazio" });
  if (!reserva.reservado) throw erroDeLimite(reserva.tentar_depois_s);

  return {
    estado: "autorizado",
    envio_id: reserva.envio_id,
    url,
    cabecalhos,
    expira_em: new Date(agoraMs + VALIDADE_DA_AUTORIZACAO_MS).toISOString(),
  };
}
