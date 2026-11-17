import fs from 'node:fs/promises';
import path from 'node:path';
import { resumirStat } from './arquivo-seguro.mjs';
import { chaveComparacao, ehPdf, nfc, segmentoBloqueado } from './caminho.mjs';

const PROFUNDIDADE_MAX = 12;

export async function listarRaiz(raiz) {
  const entradas = await fs.readdir(raiz, { withFileTypes: true });
  return entradas
    .filter((entrada) => entrada.isDirectory() || entrada.isSymbolicLink())
    .map((entrada) => ({ nome: entrada.name, link: entrada.isSymbolicLink() }));
}

export function acharPastaEmpreendimento(entradas, codigo) {
  const prefixo = chaveComparacao(`${codigo} - `);
  const achadas = entradas.filter((entrada) => chaveComparacao(entrada.nome).startsWith(prefixo));
  if (achadas.length === 0) return { ok: false, motivo: 'nenhuma' };
  if (achadas.length > 1) return { ok: false, motivo: 'varias' };
  if (achadas[0].link) return { ok: false, motivo: 'link' };
  return { ok: true, nome: achadas[0].nome };
}

export async function ehDiretorioReal(caminho) {
  try {
    const info = await fs.lstat(caminho);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

async function lerDiretorio(dir, aoFalhar) {
  try {
    const entradas = await fs.readdir(dir.abs, { withFileTypes: true });
    return entradas.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch (erro) {
    aoFalhar?.(dir.segmentos, erro);
    return [];
  }
}

export async function resolverPrefixo(base, segmentosPrefixo, bloqueio, aoFalhar) {
  let atuais = [{ abs: base, segmentos: [] }];
  for (const alvo of segmentosPrefixo) {
    const proximos = [];
    for (const atual of atuais) {
      for (const entrada of await lerDiretorio(atual, aoFalhar)) {
        if (chaveComparacao(entrada.name) !== chaveComparacao(alvo)) continue;
        if (segmentoBloqueado(entrada.name, bloqueio)) continue;
        const abs = path.join(atual.abs, entrada.name);
        if (!(await ehDiretorioReal(abs))) continue;
        proximos.push({ abs, segmentos: [...atual.segmentos, entrada.name] });
      }
    }
    atuais = proximos;
    if (atuais.length === 0) break;
  }
  return atuais;
}

async function tipoDaEntrada(entrada, abs) {
  if (entrada.isSymbolicLink()) return 'link';
  if (entrada.isDirectory()) return 'dir';
  if (entrada.isFile()) return 'arquivo';
  try {
    const info = await fs.lstat(abs);
    if (info.isSymbolicLink()) return 'link';
    if (info.isDirectory()) return 'dir';
    return info.isFile() ? 'arquivo' : 'outro';
  } catch {
    return 'outro';
  }
}

export async function* percorrerPdfs(inicio, bloqueio, aoFalhar) {
  const pilha = [inicio];
  while (pilha.length > 0) {
    const atual = pilha.pop();
    for (const entrada of await lerDiretorio(atual, aoFalhar)) {
      if (segmentoBloqueado(entrada.name, bloqueio)) continue;
      const abs = path.join(atual.abs, entrada.name);
      const tipo = await tipoDaEntrada(entrada, abs);

      if (tipo === 'dir') {
        if (atual.segmentos.length >= PROFUNDIDADE_MAX) continue;
        if (!(await ehDiretorioReal(abs))) continue;
        pilha.push({ abs, segmentos: [...atual.segmentos, entrada.name] });
        continue;
      }
      if (tipo !== 'arquivo' || !ehPdf(entrada.name)) continue;

      let info;
      try {
        info = resumirStat(await fs.lstat(abs, { bigint: true }));
      } catch (erro) {
        aoFalhar?.([...atual.segmentos, entrada.name], erro);
        continue;
      }
      if (!info.ehArquivo) continue;
      yield { abs, segmentos: [...atual.segmentos, entrada.name], info };
    }
  }
}

export async function construirArvore(base, bloqueio, { niveis, maxPastas, aoFalhar }) {
  const pastas = [];
  let fila = [{ abs: base, segmentos: [] }];
  for (let nivel = 1; nivel <= niveis && fila.length > 0; nivel += 1) {
    const proxima = [];
    for (const atual of fila) {
      for (const entrada of await lerDiretorio(atual, aoFalhar)) {
        if (!entrada.isDirectory()) continue;
        if (segmentoBloqueado(entrada.name, bloqueio)) continue;
        if (pastas.length >= maxPastas) return pastas;
        const segmentos = [...atual.segmentos, entrada.name];
        pastas.push(segmentos.map(nfc).join('/'));
        proxima.push({ abs: path.join(atual.abs, entrada.name), segmentos });
      }
    }
    fila = proxima;
  }
  return pastas;
}
