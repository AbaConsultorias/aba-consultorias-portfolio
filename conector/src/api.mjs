import { urlPermitida } from './config.mjs';
import { VERSAO } from './versao.mjs';

const TIMEOUT_API_MS = 30_000;
const CABECALHO_PERMITIDO = /^(content-type|x-amz-[a-z0-9-]+)$/i;
const ID_ENVIO = /^[A-Za-z0-9_-]{1,64}$/;

export class ErroApi extends Error {
  constructor(tipo, mensagem, extra = {}) {
    super(mensagem);
    this.name = 'ErroApi';
    this.tipo = tipo;
    Object.assign(this, extra);
  }
}

function codigoDeRede(erro) {
  return erro?.cause?.code ?? erro?.code ?? erro?.name ?? 'erro';
}

export function validarCabecalhosDoPut(cabecalhos) {
  if (!cabecalhos || typeof cabecalhos !== 'object' || Array.isArray(cabecalhos)) return null;
  const aceitos = {};
  for (const [nome, valor] of Object.entries(cabecalhos)) {
    if (!CABECALHO_PERMITIDO.test(nome)) return null;
    if (typeof valor !== 'string' || /[\r\n]/.test(valor)) return null;
    aceitos[nome.toLowerCase()] = valor;
  }
  return aceitos;
}

export function validarAutorizacao(resposta) {
  if (typeof resposta?.envio_id !== 'string' || !ID_ENVIO.test(resposta.envio_id)) return null;
  if (typeof resposta.url !== 'string' || !urlPermitida(resposta.url)) return null;
  const cabecalhos = validarCabecalhosDoPut(resposta.cabecalhos);
  if (!cabecalhos) return null;
  return { envioId: resposta.envio_id, url: resposta.url, cabecalhos };
}

export function criarClienteApi({ urlSite, chave, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_API_MS }) {
  const base = `${urlSite}/api/conector/v1`;

  async function chamar(metodo, rota, corpo) {
    const cabecalhos = {
      authorization: `Bearer ${chave}`,
      'user-agent': `ConectorABA/${VERSAO}`,
      accept: 'application/json',
    };
    if (corpo !== undefined) cabecalhos['content-type'] = 'application/json';

    let resposta;
    let texto;
    try {
      resposta = await fetchImpl(`${base}${rota}`, {
        method: metodo,
        headers: cabecalhos,
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      texto = await resposta.text();
    } catch (erro) {
      throw new ErroApi('temporario', `Falha de rede (${codigoDeRede(erro)})`);
    }

    if (resposta.status === 404) {
      throw new ErroApi('chave', 'O site recusou a chave (404): chave inválida, revogada ou rota inexistente');
    }

    let json = null;
    if (texto) {
      try {
        json = JSON.parse(texto);
      } catch {
        json = null;
      }
    }

    if (resposta.status === 429) {
      const segundos = Number(json?.tentar_depois_s);
      throw new ErroApi('limite', 'Limite do site atingido (429)', {
        tentarDepoisS: Number.isFinite(segundos) && segundos > 0 ? Math.min(segundos, 6 * 3600) : 600,
      });
    }
    if (resposta.status === 400) {
      const detalhe = typeof json?.detalhe === 'string' ? json.detalhe.slice(0, 200) : '';
      throw new ErroApi('invalido', `Pedido inválido segundo o site${detalhe ? `: ${detalhe}` : ''}`);
    }
    if (!resposta.ok) {
      throw new ErroApi('temporario', `Resposta inesperada do site (${resposta.status})`);
    }
    if (resposta.status === 204) return null;
    if (json === null || typeof json !== 'object') {
      throw new ErroApi('temporario', 'O site respondeu algo que não é JSON');
    }
    return json;
  }

  return {
    configuracao: () => chamar('GET', '/configuracao'),
    pedirEnvio: (corpo) => chamar('POST', '/envios', corpo),
    confirmar: (envioId) => chamar('POST', `/envios/${encodeURIComponent(envioId)}/confirmar`, {}),
    enviarStatus: (corpo) => chamar('POST', '/status', corpo),

    async enviarAoArmazenamento(url, cabecalhos, dados, limiteMs) {
      let resposta;
      try {
        resposta = await fetchImpl(url, {
          method: 'PUT',
          headers: cabecalhos,
          body: dados,
          redirect: 'error',
          signal: AbortSignal.timeout(limiteMs),
        });
        await resposta.arrayBuffer();
      } catch (erro) {
        throw new ErroApi('temporario', `Falha de rede no envio ao armazenamento (${codigoDeRede(erro)})`);
      }
      if (resposta.status !== 200) {
        throw new ErroApi('temporario', `O armazenamento respondeu ${resposta.status} ao receber o arquivo`);
      }
    },
  };
}
