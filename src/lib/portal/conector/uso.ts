// Gigabyte decimal (10^9), como a Cloudflare cobra: errar para mais avisa mais cedo, nunca tarde.
export const LIMITE_GRATIS_BYTES = 10_000_000_000;
export const AVISO_USO_BYTES = 8_000_000_000;
export const MAXIMO_PAGINAS_LISTAGEM = 50;
export const PRAZO_LISTAGEM_MS = 25_000;

export type NivelUso = "normal" | "aviso" | "cheio";
export type AvaliacaoUso = { bytes: number; limite: number; aviso: number; porcentagem: number; nivel: NivelUso };
export type PaginaDeObjetos = { objetos: { tamanho: number }[]; proximo: string | null };
export type SomaDoBalde = { bytes: number; objetos: number; parcial: boolean };

export function avaliarUso(bytes: number): AvaliacaoUso {
  const nivel: NivelUso = bytes >= LIMITE_GRATIS_BYTES ? "cheio" : bytes >= AVISO_USO_BYTES ? "aviso" : "normal";
  const porcentagem = Math.min(100, Math.round((bytes / LIMITE_GRATIS_BYTES) * 1000) / 10);
  return { bytes, limite: LIMITE_GRATIS_BYTES, aviso: AVISO_USO_BYTES, porcentagem, nivel };
}

export function formatarGb(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1).replace(".", ",")} GB`;
}

// Soma o balde página a página. Para no teto de páginas ou no prazo e marca o resultado como parcial: um balde enorme
// não pode estourar o tempo da função, e um total "pelo menos" ainda serve para o aviso.
export async function somarBalde(
  listarPagina: (continuacao?: string) => Promise<PaginaDeObjetos>,
  opcoes: { maximoPaginas?: number; prazoMs?: number; agora?: () => number } = {},
): Promise<SomaDoBalde> {
  const maximoPaginas = opcoes.maximoPaginas ?? MAXIMO_PAGINAS_LISTAGEM;
  const agora = opcoes.agora ?? Date.now;
  const limiteDeTempo = agora() + (opcoes.prazoMs ?? PRAZO_LISTAGEM_MS);
  let bytes = 0;
  let objetos = 0;
  let continuacao: string | undefined;
  for (let paginas = 1; ; paginas++) {
    const pagina = await listarPagina(continuacao);
    for (const objeto of pagina.objetos) {
      bytes += objeto.tamanho;
      objetos += 1;
    }
    if (!pagina.proximo) return { bytes, objetos, parcial: false };
    if (paginas >= maximoPaginas || agora() >= limiteDeTempo) return { bytes, objetos, parcial: true };
    continuacao = pagina.proximo;
  }
}
