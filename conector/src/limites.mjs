export const LIMITES_PADRAO = Object.freeze({
  maxArquivos: 20,
  maxBytes: 500 * 1024 * 1024,
  maxPedidos: 60,
  duracaoMs: 8 * 60_000,
  intervaloEstabilidadeMs: 60_000,
  niveisArvore: 5,
  maxPastasArvore: 5000,
  validadeArvoreMs: 30 * 60_000,
  falhasSeguidasMax: 3,
});

export function criarOrcamento(limites, relogio) {
  const inicio = relogio();
  let arquivos = 0;
  let bytes = 0;
  let pedidos = 0;

  const tempoEsgotado = () => relogio() - inicio >= limites.duracaoMs;

  return {
    inicio,
    tempoEsgotado,
    restanteMs: () => Math.max(0, limites.duracaoMs - (relogio() - inicio)),
    podePedir(tamanho) {
      return (
        !tempoEsgotado() &&
        pedidos < limites.maxPedidos &&
        arquivos < limites.maxArquivos &&
        bytes + tamanho <= limites.maxBytes
      );
    },
    registrarPedido() {
      pedidos += 1;
    },
    registrarEnvio(tamanho) {
      arquivos += 1;
      bytes += tamanho;
    },
    uso: () => ({ arquivos, bytes, pedidos }),
  };
}

export function limitarArvores(arvores, maxTotal) {
  const limitadas = {};
  let restante = maxTotal;
  for (const [codigo, pastas] of Object.entries(arvores)) {
    const aceitas = pastas.slice(0, Math.max(0, restante));
    limitadas[codigo] = aceitas;
    restante -= aceitas.length;
  }
  return limitadas;
}
