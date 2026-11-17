import { createHash } from 'node:crypto';
import fsNativo from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { caminhoBloqueado, chaveComparacao, estaDentro } from './caminho.mjs';

const TAMANHO_BLOCO = 1024 * 1024;

export const FS_REAL = Object.freeze({
  open: (caminho) => fs.open(caminho, 'r'),
  stat: (caminho) => fs.stat(caminho, { bigint: true }),
  realpath: (caminho) =>
    new Promise((resolver, rejeitar) => {
      fsNativo.realpath.native(caminho, (erro, real) => (erro ? rejeitar(erro) : resolver(real)));
    }),
});

// dev/ino exatos exigem bigint: no Windows o ino de 64 bits perde precisão como Number.
export function resumirStat(info) {
  return {
    size: Number(info.size),
    mtimeMs: Number(info.mtimeMs),
    dev: info.dev,
    ino: info.ino,
    ehArquivo: info.isFile(),
  };
}

function mesmoArquivo(a, b) {
  return a.dev === b.dev && a.ino === b.ino;
}

function mesmosSegmentos(reais, varridos) {
  return (
    reais.length === varridos.length &&
    reais.every((segmento, i) => chaveComparacao(segmento) === chaveComparacao(varridos[i]))
  );
}

async function fecharSemFalhar(handle) {
  try {
    await handle?.close();
  } catch {
    // nada a fazer: o descritor é liberado quando o processo termina
  }
}

function recusa(motivo, mensagem) {
  return { ok: false, motivo, mensagem };
}

function criarArquivoAberto(handle, aberto) {
  const tamanho = Number(aberto.size);

  async function atual() {
    const info = await handle.stat({ bigint: true });
    return { tamanho: Number(info.size), mtimeMs: Number(info.mtimeMs) };
  }

  async function sha256() {
    const hash = createHash('sha256');
    const bloco = Buffer.allocUnsafe(TAMANHO_BLOCO);
    let posicao = 0;
    while (posicao <= tamanho) {
      const { bytesRead } = await handle.read(bloco, 0, TAMANHO_BLOCO, posicao);
      if (bytesRead === 0) break;
      hash.update(bloco.subarray(0, bytesRead));
      posicao += bytesRead;
    }
    return posicao === tamanho ? hash.digest('hex') : null;
  }

  async function ler() {
    const dados = Buffer.allocUnsafe(tamanho);
    let lido = 0;
    while (lido < tamanho) {
      const { bytesRead } = await handle.read(dados, lido, tamanho - lido, lido);
      if (bytesRead === 0) break;
      lido += bytesRead;
    }
    if (lido !== tamanho) return null;
    const { bytesRead: sobra } = await handle.read(Buffer.alloc(1), 0, 1, lido);
    return sobra === 0 ? dados : null;
  }

  return { tamanho, atual, sha256, ler, fechar: () => fecharSemFalhar(handle) };
}

// Abre o arquivo UMA vez e só devolve o handle depois de provar que ele é o arquivo que a
// varredura aprovou, no lugar aprovado. Hash e leitura para o PUT saem desse mesmo handle: trocar
// uma pasta por junção depois da checagem não muda o que já está aberto.
export async function abrirArquivoSeguro({ arq, baseReal, bloqueio, fsImpl = FS_REAL }) {
  let handle;
  let entregue = false;
  try {
    handle = await fsImpl.open(arq.abs);
    const aberto = await handle.stat({ bigint: true });

    if (!aberto.isFile()) return recusa('trocado', 'o caminho não leva a um arquivo comum');
    if (!mesmoArquivo(aberto, arq.info)) return recusa('trocado', 'o arquivo foi trocado depois da varredura');

    const atual = { tamanho: Number(aberto.size), mtimeMs: Number(aberto.mtimeMs) };
    if (atual.tamanho !== arq.info.size || atual.mtimeMs !== arq.info.mtimeMs) {
      return { ok: false, motivo: 'mudou', atual };
    }

    const real = await fsImpl.realpath(arq.abs);
    if (!estaDentro(baseReal, real)) return recusa('fora', 'o caminho real do arquivo sai da pasta do empreendimento');
    const segmentosReais = path.relative(baseReal, real).split(path.sep);
    if (caminhoBloqueado(segmentosReais, bloqueio)) {
      return recusa('bloqueado', 'o caminho real do arquivo passa por uma pasta bloqueada');
    }
    if (!mesmosSegmentos(segmentosReais, arq.segmentos)) {
      return recusa('diferente', 'o caminho real do arquivo não é o que a varredura percorreu');
    }

    const noDisco = await fsImpl.stat(real);
    if (!mesmoArquivo(noDisco, aberto)) {
      return recusa('trocado', 'o caminho foi trocado enquanto o arquivo era aberto');
    }

    entregue = true;
    return { ok: true, arquivo: criarArquivoAberto(handle, aberto) };
  } finally {
    if (!entregue) await fecharSemFalhar(handle);
  }
}
