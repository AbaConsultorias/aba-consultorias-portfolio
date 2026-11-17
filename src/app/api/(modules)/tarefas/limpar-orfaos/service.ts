import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { listar, remover } from "@/lib/r2/cliente";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKETS = ["site-publico", "documentos", "obras", "fornecedores"] as const;
const IDADE_MINIMA = "24 hours";
const LIMITE_POR_BUCKET = 500;
const TAMANHO_DO_LOTE = 100;
// A rota tem maxDuration de 60 s; sobra folga para a auditoria e o fim da resposta.
const TEMPO_MAXIMO_MS = 45_000;
const MAXIMO_DE_RODADAS = 20;
const IDADE_MAXIMA_RATE_LIMIT_MS = 24 * 60 * 60 * 1000;
const IDADE_MINIMA_R2_MS = 24 * 60 * 60 * 1000;
const LIMITE_R2_REMOVIDOS = 500;
const LOTE_CONSULTA_R2 = 50;
const REMOCOES_SIMULTANEAS_R2 = 10;
const PREFIXOS_R2 = [..."0123456789abcdef"];
// Só chaves no formato que o envio de documentos gera; qualquer outro objeto do balde não é da limpeza.
const CHAVE_DOCUMENTO_R2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;

export type ResumoDaLimpeza = {
  removidos: Record<string, number>;
  falhas: number;
  rateLimitsRemovidos: number;
};

// Compara os hashes (sempre do mesmo tamanho) para que nem o tamanho do
// segredo vaze pelo tempo de resposta. Sem CRON_SECRET configurado, nada passa.
export function segredoValido(authorization: string | null) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || !authorization) return false;

  const esperado = createHash("sha256").update(`Bearer ${segredo}`).digest();
  const recebido = createHash("sha256").update(authorization).digest();
  return timingSafeEqual(esperado, recebido);
}

export async function limparOrfaos(): Promise<ResumoDaLimpeza> {
  const supabase = createAdminClient();
  const removidos: Record<string, number> = {};
  let falhas = 0;

  const inicio = Date.now();

  for (const bucket of BUCKETS) {
    removidos[bucket] = 0;

    for (let rodada = 0; rodada < MAXIMO_DE_RODADAS; rodada++) {
      if (Date.now() - inicio > TEMPO_MAXIMO_MS) {
        console.warn("[limpar-orfaos] tempo esgotado; o restante fica para a próxima execução:", bucket);
        break;
      }

      const { data, error } = await supabase.rpc("listar_objetos_orfaos", {
        p_bucket: bucket,
        p_idade: IDADE_MINIMA,
        p_limite: LIMITE_POR_BUCKET,
      });
      if (error) {
        console.error("[limpar-orfaos] falha ao listar:", bucket, error.code);
        falhas += 1;
        break;
      }

      const nomes = ((data ?? []) as { nome: string }[]).map((objeto) => objeto.nome);
      let removidosNaRodada = 0;

      for (let i = 0; i < nomes.length; i += TAMANHO_DO_LOTE) {
        const lote = nomes.slice(i, i + TAMANHO_DO_LOTE);
        const { data: apagados, error: erroAoApagar } = await supabase.storage.from(bucket).remove(lote);
        if (erroAoApagar) {
          console.error("[limpar-orfaos] falha ao remover:", bucket, erroAoApagar.name);
          falhas += lote.length;
          continue;
        }
        removidosNaRodada += apagados?.length ?? 0;
      }
      removidos[bucket] += removidosNaRodada;

      // Sem o limite cheio não há mais o que listar; sem nada removido a próxima
      // listagem devolveria os mesmos nomes (laço infinito até o teto).
      if (nomes.length < LIMITE_POR_BUCKET || removidosNaRodada === 0) break;
    }
  }

  const r2 = await limparOrfaosR2(supabase, inicio);
  removidos["r2-documentos"] = r2.removidos;
  falhas += r2.falhas;

  // A auditoria só aceita INSERT/UPDATE/DELETE: o resumo entra como DELETE em
  // storage.objects, com contagens por bucket e sem nomes de arquivo.
  const { error: erroNaAuditoria } = await supabase.from("auditoria").insert({
    tabela: "storage.objects",
    acao: "DELETE",
    depois: { origem: "limpeza_orfaos", removidos, falhas },
  });
  if (erroNaAuditoria) {
    console.error("[limpar-orfaos] falha ao gravar auditoria:", erroNaAuditoria.code);
  }

  const rateLimitsRemovidos = await removerRateLimitsVencidos(supabase);

  console.log("[limpar-orfaos] concluído:", JSON.stringify(removidos), "falhas:", falhas, "rate limits:", rateLimitsRemovidos);
  return { removidos, falhas, rateLimitsRemovidos };
}

// O R2 não aparece em storage.objects: lista o balde e confere cada objeto antigo com documentos.storage_path.
// Falha na consulta ao banco encerra a etapa sem apagar nada daquela página em diante.
// As chaves começam pelo UUID do empreendimento: percorre os 16 prefixos hexadecimais em círculo, a partir
// de um sorteado, para que o teto de páginas não deixe sempre o fim do balde sem exame.
async function limparOrfaosR2(supabase: ReturnType<typeof createAdminClient>, inicio: number) {
  let removidos = 0;
  let falhas = 0;
  try {
    const limite = Date.now() - IDADE_MINIMA_R2_MS;
    const primeiro = randomInt(PREFIXOS_R2.length);
    let indice = 0;
    let continuacao: string | undefined;

    for (let pagina = 0; pagina < MAXIMO_DE_RODADAS && removidos < LIMITE_R2_REMOVIDOS; pagina++) {
      if (Date.now() - inicio > TEMPO_MAXIMO_MS) {
        console.warn("[limpar-orfaos] tempo esgotado; o restante fica para a próxima execução: r2-documentos");
        break;
      }

      const prefixo = PREFIXOS_R2[(primeiro + indice) % PREFIXOS_R2.length];
      const { objetos, proximo } = await listar(prefixo, continuacao);
      const candidatos = objetos
        .filter((objeto) => objeto.modificadoEm.getTime() < limite && CHAVE_DOCUMENTO_R2.test(objeto.chave))
        .map((objeto) => objeto.chave);

      const orfaos: string[] = [];
      for (let i = 0; i < candidatos.length; i += LOTE_CONSULTA_R2) {
        const lote = candidatos.slice(i, i + LOTE_CONSULTA_R2);
        const { data, error } = await supabase.from("documentos").select("storage_path").in("storage_path", lote);
        if (error) {
          console.error("[limpar-orfaos] falha ao consultar documentos para o r2:", error.code);
          return { removidos, falhas: falhas + 1 };
        }
        const citados = new Set(((data ?? []) as { storage_path: string }[]).map((linha) => linha.storage_path));
        orfaos.push(...lote.filter((chave) => !citados.has(chave)));
      }

      for (let i = 0; i < orfaos.length && removidos < LIMITE_R2_REMOVIDOS; i += REMOCOES_SIMULTANEAS_R2) {
        if (Date.now() - inicio > TEMPO_MAXIMO_MS) break;
        const lote = orfaos.slice(i, i + Math.min(REMOCOES_SIMULTANEAS_R2, LIMITE_R2_REMOVIDOS - removidos));
        const resultados = await Promise.allSettled(lote.map((chave) => remover(chave)));
        for (const resultado of resultados) {
          if (resultado.status === "fulfilled") removidos += 1;
          else falhas += 1;
        }
      }

      if (proximo) {
        continuacao = proximo;
        continue;
      }
      continuacao = undefined;
      indice += 1;
      if (indice === PREFIXOS_R2.length) break;
    }
  } catch (error) {
    console.error("[limpar-orfaos] falha na etapa do r2:", error instanceof Error ? error.name : "desconhecida");
    falhas += 1;
  }
  return { removidos, falhas };
}

// Janelas de rate limit só são reiniciadas quando a mesma chave volta; as de
// IPs que nunca voltam ficariam para sempre. Uma janela com mais de 1 dia já venceu.
async function removerRateLimitsVencidos(supabase: ReturnType<typeof createAdminClient>) {
  const limite = new Date(Date.now() - IDADE_MAXIMA_RATE_LIMIT_MS).toISOString();
  const { count, error } = await supabase.from("rate_limits").delete({ count: "exact" }).lt("janela_inicio", limite);
  if (error) {
    console.error("[limpar-orfaos] falha ao limpar rate limits:", error.code);
    return 0;
  }
  return count ?? 0;
}
