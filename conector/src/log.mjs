import fs from 'node:fs';
import path from 'node:path';

const PADRAO_CHAVE = /abacon_[A-Za-z0-9_-]{8,}/g;
const PADRAO_URL = /https?:\/\/[^\s"'<>]+/gi;
const PADRAO_CAMINHO = /(?:[A-Za-z]:\\|\\\\)[^\s'"<>|]*/g;
const PADRAO_ARQUIVO_LOG = /^conector-(\d{4})-(\d{2})-(\d{2})\.log$/;

export function redigir(texto, segredos = []) {
  let resultado = String(texto);
  for (const segredo of segredos) {
    if (typeof segredo === 'string' && segredo.length >= 6) {
      resultado = resultado.split(segredo).join('[oculto]');
    }
  }
  return resultado
    .replace(PADRAO_CHAVE, '[chave]')
    .replace(PADRAO_URL, '[url]')
    .replace(PADRAO_CAMINHO, '[caminho]');
}

export function descreverErro(erro) {
  if (!erro || typeof erro !== 'object') return 'erro desconhecido';
  const codigo = erro.cause?.code ?? erro.code;
  return codigo ? `${erro.name} ${codigo}` : String(erro.name ?? 'Error');
}

function dataLocal(ms) {
  const d = new Date(ms);
  const dois = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

export function limparLogsAntigos(pasta, relogio, dias) {
  let nomes;
  try {
    nomes = fs.readdirSync(pasta);
  } catch {
    return;
  }
  const limite = relogio() - dias * 24 * 60 * 60_000;
  for (const nome of nomes) {
    const partes = PADRAO_ARQUIVO_LOG.exec(nome);
    if (!partes) continue;
    const dia = new Date(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3])).getTime();
    if (dia < limite) {
      try {
        fs.rmSync(path.join(pasta, nome), { force: true });
      } catch {
        // log antigo preso por outro programa: tenta de novo na próxima execução
      }
    }
  }
}

export function criarLog({ pasta, relogio = Date.now, segredos = [], eco = false, diasGuardados = 30 }) {
  try {
    fs.mkdirSync(pasta, { recursive: true });
  } catch {
    // sem pasta de logs o ciclo segue; escrever falha em silêncio
  }
  limparLogsAntigos(pasta, relogio, diasGuardados);

  const arquivoAtual = () => path.join(pasta, `conector-${dataLocal(relogio())}.log`);

  function escrever(nivel, mensagem) {
    const linha = `${new Date(relogio()).toISOString()} ${nivel} ${redigir(mensagem, segredos)}\n`;
    try {
      fs.appendFileSync(arquivoAtual(), linha);
    } catch {
      // falha de log nunca derruba o ciclo
    }
    if (eco) process.stdout.write(linha);
  }

  return {
    info: (mensagem) => escrever('INFO', mensagem),
    aviso: (mensagem) => escrever('AVISO', mensagem),
    erro: (mensagem) => escrever('ERRO', mensagem),
    redigir: (texto) => redigir(texto, segredos),
    arquivoAtual,
  };
}
