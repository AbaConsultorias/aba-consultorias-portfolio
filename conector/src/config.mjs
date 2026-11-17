import fs from 'node:fs';
import path from 'node:path';

const FORMATO_CHAVE = /^abacon_[A-Za-z0-9_-]{43}$/;
const HOSTS_LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function urlPermitida(texto) {
  let url;
  try {
    url = new URL(texto);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && HOSTS_LOOPBACK.has(url.hostname);
}

export function chaveValida(chave) {
  return typeof chave === 'string' && FORMATO_CHAVE.test(chave);
}

export function validarConfig(dados) {
  const erros = [];
  const texto = (campo) => (typeof dados?.[campo] === 'string' ? dados[campo].trim() : '');

  const urlSite = texto('urlSite').replace(/\/+$/, '');
  if (!urlSite || !urlPermitida(urlSite)) erros.push('urlSite deve ser uma URL https');

  const raiz = texto('raiz');
  if (!raiz || !path.isAbsolute(raiz)) erros.push('raiz deve ser um caminho absoluto');

  const pastaEstado = texto('pastaEstado');
  if (!pastaEstado || !path.isAbsolute(pastaEstado)) erros.push('pastaEstado deve ser um caminho absoluto');

  const pastaLogs = texto('pastaLogs');
  if (!pastaLogs || !path.isAbsolute(pastaLogs)) erros.push('pastaLogs deve ser um caminho absoluto');

  if (erros.length > 0) return { ok: false, erros };
  return { ok: true, config: { urlSite, raiz, pastaEstado, pastaLogs } };
}

export function lerConfig(caminho) {
  let bruto;
  try {
    bruto = fs.readFileSync(caminho, 'utf8');
  } catch (erro) {
    return { ok: false, erros: [`não foi possível ler o config.json (${erro.code ?? 'erro'})`] };
  }
  let dados;
  try {
    dados = JSON.parse(bruto.replace(/^﻿/, ''));
  } catch {
    return { ok: false, erros: ['config.json não é um JSON válido'] };
  }
  return validarConfig(dados);
}
