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
import { caminhoBloqueado, casarRegra, PRAZO_PARA_CONFIRMAR_MS, tituloDoCaminho } from "@/lib/conector/regras";
import { motivoDeRecusaDoCaminho } from "@/lib/conector/sinais";
import { sha256HexParaBase64, type Armazenamento } from "@/lib/portal/documentos/armazenamento";
import { comecaComPdf } from "@/lib/portal/documentos/regras";
import { createAdminClient } from "@/lib/supabase/admin";

export type RespostaDeConfirmacao =
  | { estado: "confirmado"; documento_id: string; liberado: boolean }
  | { estado: "recusado"; motivo: string };

type Envio = {
  id: string;
  conector_id: string;
  empreendimento_id: string;
  regra_id: string | null;
  caminho_relativo: string;
  tamanho: number;
  sha256: string;
  estado: string;
  documento_id: string | null;
  storage_path: string | null;
  documento_planejado_id: string | null;
  em: string;
};
type RegraAtiva = { id: string; caminho_prefixo: string; liberar_automatico: boolean; tipo?: string };
type Empreendimento = { id: string; situacao: string; liberacao_automatica: boolean };
type ResultadoDaFuncao =
  | { situacao: "confirmado"; documento_id: string | null; novo: boolean }
  | { situacao: "duplicado" }
  | { situacao: "nao_autorizado" }
  | { situacao: "sem_regra" }
  | { situacao: "sem_categoria" };

const COLUNAS_DO_ENVIO =
  "id,conector_id,empreendimento_id,regra_id,caminho_relativo,tamanho,sha256,estado,documento_id,storage_path,documento_planejado_id,em";
const MOTIVO_DUPLICADO = "Mesmo conteúdo já enviado por outro caminho.";
const MOTIVO_REGRA_MUDOU = "A regra de pasta mudou; o arquivo será pedido de novo.";
const MOTIVO_SEM_CATEGORIA = "O projeto da regra não tem as categorias SIMOS e Laudos.";

function recusado(motivo: string): RespostaDeConfirmacao {
  return { estado: "recusado", motivo };
}

async function lerEnvio(banco: BancoAdmin, envioId: string, conectorId: string): Promise<Envio | null> {
  const { data, error } = await banco.from("conector_envios").select(COLUNAS_DO_ENVIO)
    .eq("id", envioId).eq("conector_id", conectorId).maybeSingle();
  if (error) return falhaDeBanco("confirmar: consulta do envio:", error);
  return (data as Envio | null) ?? null;
}

// Confirmar de novo devolve o mesmo resultado; "liberado" reflete o estado atual do documento.
async function resultadoJaConfirmado(banco: BancoAdmin, envio: Envio): Promise<RespostaDeConfirmacao> {
  if (!envio.documento_id) return recusado("O documento deste envio foi removido do site.");
  const { data, error } = await banco.from("documentos").select("id,liberado_cliente").eq("id", envio.documento_id).maybeSingle();
  if (error) return falhaDeBanco("confirmar: consulta do documento confirmado:", error);
  const documento = data as { id: string; liberado_cliente: boolean } | null;
  if (!documento) return recusado("O documento deste envio foi removido do site.");
  return { estado: "confirmado", documento_id: documento.id, liberado: documento.liberado_cliente };
}

// O R2 já recusou conteúdo diferente do assinado no PUT; aqui se confere o que ele guardou (HEAD) e a assinatura do PDF.
async function conferirObjeto(armazenamento: Armazenamento, envio: Envio, path: string): Promise<string | null> {
  const objeto = await armazenamento.consultarObjeto(path);
  if (!objeto) return "O arquivo não chegou ao armazenamento.";
  const tipo = objeto.contentType?.split(";")[0].trim().toLowerCase();
  if (tipo && tipo !== "application/pdf") return "O arquivo enviado não é um PDF válido.";
  if (objeto.tamanho !== envio.tamanho) return "O tamanho do arquivo enviado difere do autorizado.";
  if (objeto.sha256Base64 !== sha256HexParaBase64(envio.sha256)) return "O conteúdo do arquivo enviado difere do autorizado.";
  const cabecalho = await armazenamento.lerCabecalho(path);
  if (!cabecalho) return "O arquivo não chegou ao armazenamento.";
  return comecaComPdf(cabecalho) ? null : "O arquivo enviado não é um PDF válido.";
}

async function removerObjeto(armazenamento: Armazenamento, path: string): Promise<void> {
  await armazenamento.removerObjeto(path).catch(() => console.error("[conector] confirmar: falha ao apagar o objeto recusado"));
}

// Recusa o envio. O objeto do R2 só é apagado por quem fez a transição autorizado -> recusado/duplicado (o UPDATE
// condicionado devolveu a linha): se outra chamada concluiu o envio antes, o objeto agora é de um documento.
async function rejeitar(
  banco: BancoAdmin,
  armazenamento: Armazenamento,
  envio: Envio,
  motivo: string,
  estado: "recusado" | "duplicado" = "recusado",
): Promise<RespostaDeConfirmacao> {
  const { data, error } = await banco.from("conector_envios").update({ estado, erro: motivo })
    .eq("id", envio.id).eq("estado", "autorizado").select("id");
  if (error) return falhaDeBanco("confirmar: marcação da recusa:", error);

  if (((data ?? []) as { id: string }[]).length > 0) {
    if (envio.storage_path) await removerObjeto(armazenamento, envio.storage_path);
    return recusado(motivo);
  }
  const atual = await lerEnvio(banco, envio.id, envio.conector_id);
  return atual?.estado === "confirmado" ? resultadoJaConfirmado(banco, atual) : recusado(motivo);
}

async function lerContexto(banco: BancoAdmin, envio: Envio) {
  const { data: dadosRegras, error: erroRegras } = await banco.from("pasta_regras")
    .select("id,caminho_prefixo,liberar_automatico,tipo").eq("empreendimento_id", envio.empreendimento_id).eq("ativa", true);
  if (erroRegras) return falhaDeBanco("confirmar: consulta das regras:", erroRegras);

  const { data: dadosEmpreendimento, error: erroEmpreendimento } = await banco.from("empreendimentos")
    .select("id,situacao,liberacao_automatica").eq("id", envio.empreendimento_id).maybeSingle();
  if (erroEmpreendimento) return falhaDeBanco("confirmar: consulta do empreendimento:", erroEmpreendimento);

  const { data: dadosGeral, error: erroGeral } = await banco.from("configuracoes_conector")
    .select("liberacao_automatica_geral").limit(1).maybeSingle();
  if (erroGeral) return falhaDeBanco("confirmar: consulta da configuração:", erroGeral);

  return {
    regras: (dadosRegras ?? []) as RegraAtiva[],
    empreendimento: (dadosEmpreendimento as Empreendimento | null) ?? null,
    liberacaoGeral: (dadosGeral as { liberacao_automatica_geral: boolean } | null)?.liberacao_automatica_geral === true,
  };
}

export async function confirmarEnvio(
  envioId: string,
  conector: ConectorAutenticado,
  dependencias: DependenciasConector = dependenciasPadrao,
  banco: BancoAdmin = createAdminClient(),
): Promise<RespostaDeConfirmacao> {
  const { armazenamento } = dependencias;
  const envio = await lerEnvio(banco, envioId, conector.id);
  if (!envio) return recusado("Envio não encontrado.");
  if (envio.estado === "confirmado") return resultadoJaConfirmado(banco, envio);

  const { storage_path: storagePath } = envio;
  if (envio.estado !== "autorizado" || !storagePath || !envio.documento_planejado_id) return recusado("Envio não está autorizado.");
  if (dependencias.agora() - Date.parse(envio.em) > PRAZO_PARA_CONFIRMAR_MS) {
    return rejeitar(banco, armazenamento, envio, "Autorização expirada. Peça uma nova.");
  }

  const { regras, empreendimento, liberacaoGeral } = await lerContexto(banco, envio);
  // A equipe pode mudar as regras entre autorizar e confirmar: o destino só vale se o caminho do envio ainda
  // casar, pelas regras ativas de agora, com a mesma regra que o autorizou.
  if (caminhoBloqueado(envio.caminho_relativo)) return rejeitar(banco, armazenamento, envio, "Caminho bloqueado.");
  const regra = casarRegra(envio.caminho_relativo, regras);
  if (!regra || regra.id !== envio.regra_id) return rejeitar(banco, armazenamento, envio, MOTIVO_REGRA_MUDOU);
  if (!empreendimento || empreendimento.situacao !== "ativo") return rejeitar(banco, armazenamento, envio, "Empreendimento inativo.");

  const motivoDoCaminho = motivoDeRecusaDoCaminho(envio.caminho_relativo, regra);
  if (motivoDoCaminho) return rejeitar(banco, armazenamento, envio, motivoDoCaminho);

  // Regra de SIMOS e Laudos: o caminho é classificado de novo aqui (o banco decide a categoria pelo papel, nunca o chamador).
  const equipamento = regra.tipo === "equipamentos" ? classificarEquipamento(envio.caminho_relativo, regra.caminho_prefixo) : null;
  if (regra.tipo === "equipamentos" && !equipamento) return rejeitar(banco, armazenamento, envio, MOTIVO_FORA_DO_PADRAO);

  const divergencia = await conferirObjeto(armazenamento, envio, storagePath);
  if (divergencia) return rejeitar(banco, armazenamento, envio, divergencia);

  if (await existeConfirmadoComSha(banco, envio.empreendimento_id, envio.sha256, envio.id)) {
    return rejeitar(banco, armazenamento, envio, MOTIVO_DUPLICADO, "duplicado");
  }

  const anterior = await buscarUltimoConfirmado(banco, envio.empreendimento_id, envio.caminho_relativo, envio.id);

  // Documento (oculto), origem e envio confirmado numa transação só: uma falha no meio não deixa documento sem
  // origem. A liberação automática é um UPDATE depois: o trigger carimba liberado_em/liberado_por como em qualquer
  // liberação e oculta as outras versões da família.
  const { data, error } = await banco.rpc("confirmar_envio_conector", {
    p_envio: envio.id,
    p_conector: conector.id,
    p_titulo: tituloDoCaminho(envio.caminho_relativo),
    p_substitui: anterior?.documento_id ?? null,
    p_agora: new Date(dependencias.agora()).toISOString(),
    p_equipamento: equipamento?.equipamento ?? null,
    p_papel: equipamento?.papel ?? null,
  });
  if (error) return falhaDeBanco("confirmar: confirmação do envio:", error);
  const resultado = data as ResultadoDaFuncao | null;
  if (!resultado) return falhaDeBanco("confirmar: confirmação do envio:", { code: "vazio" });

  if (resultado.situacao === "duplicado") return rejeitar(banco, armazenamento, envio, MOTIVO_DUPLICADO, "duplicado");
  if (resultado.situacao === "sem_regra") return rejeitar(banco, armazenamento, envio, MOTIVO_REGRA_MUDOU);
  if (resultado.situacao === "sem_categoria") return rejeitar(banco, armazenamento, envio, MOTIVO_SEM_CATEGORIA);
  if (resultado.situacao === "nao_autorizado") {
    // Outra chamada concluiu ou recusou este envio primeiro: o resultado é o dela, e o objeto não é nosso para apagar.
    const atual = await lerEnvio(banco, envio.id, conector.id);
    return atual?.estado === "confirmado" ? resultadoJaConfirmado(banco, atual) : recusado("Envio não está autorizado.");
  }
  const documentoId = resultado.documento_id;
  if (!resultado.novo) return resultadoJaConfirmado(banco, { ...envio, documento_id: documentoId });
  if (!documentoId) return falhaDeBanco("confirmar: confirmação do envio:", { code: "vazio" });

  const liberar = regra.liberar_automatico && empreendimento.liberacao_automatica && liberacaoGeral;
  let liberado = false;
  if (liberar) {
    // A regra lida acima pode ter virado "arquivo" durante a conferência do PDF: documento de arquivo (pasta_rotulo
    // preenchido) nunca é liberado sozinho, então o filtro decide pelo documento gravado, não pela regra lida antes.
    const { data: liberados, error: erroLiberar } = await banco.from("documentos").update({ liberado_cliente: true })
      .eq("id", documentoId).is("pasta_rotulo", null).select("id");
    if (erroLiberar) console.error("[conector] confirmar: falha na liberação automática:", erroLiberar.code);
    else liberado = (liberados?.length ?? 0) > 0;
  }
  return { estado: "confirmado", documento_id: documentoId, liberado };
}
