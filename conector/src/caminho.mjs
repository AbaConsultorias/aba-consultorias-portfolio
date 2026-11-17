import path from 'node:path';

export const BLOQUEIO_FIXO = ['DADOS DO EMPREENDEDOR', 'COMPROVANTE', 'NOTAS FISCAIS', 'PLANILHA'];

const CARACTERE_INVALIDO = /[\u0000-\u001f<>:"|?*]/;

export function nfc(texto) {
  return texto.normalize('NFC');
}

export function chaveComparacao(texto) {
  return nfc(texto).toLowerCase();
}

// NFKD (dobra também letras de largura total), sem acento, minúsculas e só letras e dígitos: "NOTAS  FISCAIS",
// "NOTAS-FISCAIS" ou "NOTAS_FISCAIS" não escapam de "NOTAS FISCAIS". Mesma regra do site (src/lib/conector/regras.ts).
export function chaveBloqueio(texto) {
  return texto
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function listaBloqueio(extras = []) {
  const chaves = new Set();
  for (const item of [...BLOQUEIO_FIXO, ...extras]) {
    if (typeof item !== 'string') continue;
    const chave = chaveBloqueio(item).trim();
    if (chave) chaves.add(chave);
  }
  return [...chaves];
}

export function segmentoBloqueado(segmento, chavesBloqueio) {
  const chave = chaveBloqueio(segmento);
  return chavesBloqueio.some((bloqueada) => chave.includes(bloqueada));
}

export function caminhoBloqueado(segmentos, chavesBloqueio) {
  return segmentos.some((segmento) => segmentoBloqueado(segmento, chavesBloqueio));
}

export function normalizarCaminhoRelativo(texto) {
  if (typeof texto !== 'string' || texto === '') return { ok: false, motivo: 'vazio' };
  const normalizado = nfc(texto).replaceAll('\\', '/');
  if (normalizado.startsWith('/') || /^[a-z]:/i.test(normalizado)) {
    return { ok: false, motivo: 'absoluto' };
  }
  const segmentos = normalizado.split('/');
  for (const segmento of segmentos) {
    if (segmento === '' || segmento === '.' || segmento === '..') {
      return { ok: false, motivo: 'segmento invalido' };
    }
    if (CARACTERE_INVALIDO.test(segmento) || /[ .]$/.test(segmento)) {
      return { ok: false, motivo: 'caractere invalido' };
    }
  }
  return { ok: true, segmentos, texto: segmentos.join('/') };
}

export function ehPdf(nome) {
  return nome.length > 4 && /\.pdf$/i.test(nome);
}

export function prefixoCasa(segmentosPrefixo, segmentosCaminho) {
  if (segmentosPrefixo.length === 0) return false;
  if (segmentosPrefixo.length >= segmentosCaminho.length) return false;
  return segmentosPrefixo.every(
    (segmento, indice) => chaveComparacao(segmento) === chaveComparacao(segmentosCaminho[indice]),
  );
}

export function prefixoMaisLongo(prefixos, segmentosCaminho) {
  let melhor = null;
  for (const prefixo of prefixos) {
    if (!prefixoCasa(prefixo, segmentosCaminho)) continue;
    if (!melhor || prefixo.length > melhor.length) melhor = prefixo;
  }
  return melhor;
}

export function minimizarPrefixos(prefixos) {
  const ordenados = [...prefixos].sort((a, b) => a.length - b.length);
  const mantidos = [];
  for (const prefixo of ordenados) {
    const coberto = mantidos.some(
      (curto) =>
        curto.length <= prefixo.length &&
        curto.every((segmento, i) => chaveComparacao(segmento) === chaveComparacao(prefixo[i])),
    );
    if (!coberto) mantidos.push(prefixo);
  }
  return mantidos;
}

export function estaDentro(base, alvo) {
  const relativo = path.relative(base, alvo);
  if (relativo === '') return false;
  if (relativo === '..' || relativo.startsWith(`..${path.sep}`)) return false;
  return !path.isAbsolute(relativo);
}
