export const INTERVALO_ESTABILIDADE_MS = 60_000;

const RESULTADOS_DEFINITIVOS = new Set(['confirmado', 'ja_enviado', 'duplicado', 'recusado']);

export function novaObservacao(registro, atual, agora) {
  const novo = { tamanho: atual.tamanho, mtimeMs: atual.mtimeMs, observadoEm: agora };
  if (registro?.sha256) {
    novo.sha256 = registro.sha256;
    novo.shaTamanho = registro.shaTamanho;
    novo.shaMtimeMs = registro.shaMtimeMs;
  }
  return novo;
}

export function avaliarArquivo(registro, atual, agora, intervaloMs = INTERVALO_ESTABILIDADE_MS) {
  const mesmaVersao =
    registro && registro.tamanho === atual.tamanho && registro.mtimeMs === atual.mtimeMs;
  if (!mesmaVersao) {
    return { acao: 'aguardar', registro: novaObservacao(registro, atual, agora) };
  }

  const resultado = registro.resultado;
  if (resultado && RESULTADOS_DEFINITIVOS.has(resultado.tipo)) {
    return { acao: 'ignorar', tipo: resultado.tipo, registro };
  }

  if (registro.observadoEm > agora) {
    return { acao: 'aguardar', registro: { ...registro, observadoEm: agora } };
  }
  if (agora - registro.observadoEm >= intervaloMs) return { acao: 'enviar', registro };
  return { acao: 'aguardar', registro };
}

export const MAX_RECUSAS_NA_CONFIRMACAO = 3;

// Recusa na confirmação costuma ser transitória (a regra mudou entre autorizar e confirmar): o
// arquivo é pedido de novo no próximo ciclo e só vira definitivo na 3ª recusa desta versão.
export function registrarRecusaNaConfirmacao(registro) {
  const tentativas = (registro.recusasConfirmacao ?? 0) + 1;
  registro.recusasConfirmacao = tentativas;
  return { tentativas, definitiva: tentativas >= MAX_RECUSAS_NA_CONFIRMACAO };
}

// Toda recusa definitiva vale para a configuração em que nasceu: se as regras, o bloqueio ou o
// limite do site mudam, os arquivos recusados voltam a ser avaliados.
export function expirarRecusas(estado, hashConfiguracao) {
  if (estado.configHash === hashConfiguracao) return 0;
  estado.configHash = hashConfiguracao;
  let expiradas = 0;
  for (const registro of Object.values(estado.arquivos)) {
    if (registro.resultado?.tipo !== 'recusado') continue;
    delete registro.resultado;
    delete registro.recusasConfirmacao;
    expiradas += 1;
  }
  return expiradas;
}

export function shaConhecido(registro, atual) {
  if (!registro?.sha256) return null;
  if (registro.shaTamanho !== atual.tamanho || registro.shaMtimeMs !== atual.mtimeMs) return null;
  return registro.sha256;
}
