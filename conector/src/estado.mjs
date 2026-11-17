import fs from 'node:fs';
import path from 'node:path';

const VERSAO_ESTADO = 1;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const RESULTADOS_CONHECIDOS = new Set(['confirmado', 'ja_enviado', 'duplicado', 'recusado']);
const MAX_RECUSAS_REGISTRADAS = 100;

export const FOLGA_MAXIMA_BLOQUEIO_MS = 2 * 60 * 60_000;

export function estadoVazio() {
  return { versao: VERSAO_ESTADO, bloqueadoAte: 0, arquivos: {}, arvores: {} };
}

const ehObjeto = (valor) => valor !== null && typeof valor === 'object' && !Array.isArray(valor);
const inteiroNaoNegativo = (valor) => Number.isInteger(valor) && valor >= 0;
const dataValida = (valor) => Number.isFinite(valor) && !Number.isNaN(new Date(valor).getTime());

function sanearResultado(bruto) {
  if (!ehObjeto(bruto) || !RESULTADOS_CONHECIDOS.has(bruto.tipo)) return null;
  const resultado = { tipo: bruto.tipo };
  if (typeof bruto.em === 'string') resultado.em = bruto.em.slice(0, 40);
  if (typeof bruto.motivo === 'string') resultado.motivo = bruto.motivo.slice(0, 200);
  return resultado;
}

// Devolve o registro limpo, ou null se qualquer campo estiver fora do formato: o arquivo volta a
// ser "novo" e é reobservado, em vez de ficar preso por um valor que ninguém consegue avaliar.
export function sanearRegistro(bruto) {
  if (!ehObjeto(bruto)) return null;
  if (!inteiroNaoNegativo(bruto.tamanho) || !Number.isFinite(bruto.mtimeMs) || !dataValida(bruto.observadoEm)) {
    return null;
  }
  const registro = { tamanho: bruto.tamanho, mtimeMs: bruto.mtimeMs, observadoEm: bruto.observadoEm };

  if (bruto.sha256 !== undefined) {
    const shaOk =
      typeof bruto.sha256 === 'string' &&
      SHA256_HEX.test(bruto.sha256) &&
      inteiroNaoNegativo(bruto.shaTamanho) &&
      Number.isFinite(bruto.shaMtimeMs);
    if (!shaOk) return null;
    registro.sha256 = bruto.sha256;
    registro.shaTamanho = bruto.shaTamanho;
    registro.shaMtimeMs = bruto.shaMtimeMs;
  }
  if (bruto.resultado !== undefined) {
    const resultado = sanearResultado(bruto.resultado);
    if (!resultado) return null;
    registro.resultado = resultado;
  }
  if (bruto.recusasConfirmacao !== undefined) {
    if (!inteiroNaoNegativo(bruto.recusasConfirmacao) || bruto.recusasConfirmacao > MAX_RECUSAS_REGISTRADAS) return null;
    registro.recusasConfirmacao = bruto.recusasConfirmacao;
  }
  return registro;
}

function sanearArquivos(bruto) {
  const arquivos = {};
  let descartados = 0;
  for (const [chave, valor] of Object.entries(bruto)) {
    const registro = chave.includes('/') ? sanearRegistro(valor) : null;
    if (registro) arquivos[chave] = registro;
    else descartados += 1;
  }
  return { arquivos, descartados };
}

function sanearArvores(bruto) {
  const arvores = {};
  if (!ehObjeto(bruto)) return arvores;
  for (const [codigo, cache] of Object.entries(bruto)) {
    const valido =
      codigo !== '__proto__' &&
      Number.isFinite(cache?.em) &&
      Array.isArray(cache.pastas) &&
      cache.pastas.every((pasta) => typeof pasta === 'string');
    if (valido) arvores[codigo] = { em: cache.em, pastas: cache.pastas };
  }
  return arvores;
}

// Um bloqueio vindo do arquivo nunca vale mais que a folga máxima: um valor absurdo (ou adulterado)
// faria o conector parar de consultar o site.
export function limitarBloqueio(valor, agora) {
  if (!Number.isFinite(valor) || valor <= 0) return 0;
  return Math.min(valor, agora + FOLGA_MAXIMA_BLOQUEIO_MS);
}

export function carregarEstado(caminho, log, agora = Date.now()) {
  let texto;
  try {
    texto = fs.readFileSync(caminho, 'utf8');
  } catch (erro) {
    if (erro.code === 'ENOENT') return estadoVazio();
    throw erro;
  }

  try {
    const dados = JSON.parse(texto.replace(/^﻿/, ''));
    if (dados?.versao !== VERSAO_ESTADO || !ehObjeto(dados.arquivos)) {
      throw new Error('formato');
    }
    const { arquivos, descartados } = sanearArquivos(dados.arquivos);
    if (descartados > 0) {
      log?.aviso(`${descartados} registro(s) inválido(s) do estado foram descartados e serão reobservados`);
    }
    const estado = {
      versao: VERSAO_ESTADO,
      bloqueadoAte: limitarBloqueio(dados.bloqueadoAte, agora),
      arquivos,
      arvores: sanearArvores(dados.arvores),
    };
    if (typeof dados.configHash === 'string' && SHA256_HEX.test(dados.configHash)) estado.configHash = dados.configHash;
    return estado;
  } catch {
    const copia = `${caminho}.corrompido-${Date.now()}`;
    try {
      fs.renameSync(caminho, copia);
    } catch {
      // sem a cópia o arquivo será sobrescrito na próxima gravação
    }
    log?.aviso('Arquivo de estado ilegível: começando um novo (o site evita reenvios repetidos)');
    return estadoVazio();
  }
}

export function salvarEstado(caminho, estado) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const temporario = `${caminho}.${process.pid}.tmp`;
  const fd = fs.openSync(temporario, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(estado));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporario, caminho);
}
