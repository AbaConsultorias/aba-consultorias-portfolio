import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { executarCiclo } from '../src/ciclo.mjs';
import { criarLog } from '../src/log.mjs';

export const CHAVE_TESTE = `abacon_${'A'.repeat(43)}`;
export const SEGREDO_DA_URL = 'assinatura-secreta-123';
export const PASTA_EMP = '250101 - VISTA LINDA (FULANO)';
export const PREFIXO_REGRA = '03 - PRODUTOS/LAN/APROVADO NO INTERLIGA';
export const EMP_PADRAO = [{ codigo_pasta: '250101', regras: [{ id: 'r1', caminho_prefixo: PREFIXO_REGRA }] }];
export const MINUTO = 60_000;

const PREFIXO_API = '/api/conector/v1';

export function relogioFalso(inicio = Date.UTC(2026, 10, 4, 13, 0, 0)) {
  let agora = inicio;
  return {
    agora: () => agora,
    avancar(ms) {
      agora += ms;
    },
  };
}

export async function criarSiteFalso({ chave = CHAVE_TESTE } = {}) {
  const site = {
    url: '',
    requisicoes: [],
    empreendimentos: [],
    interceptar: null,
    falharPut: null,
    objetos: new Map(),
    pendentes: new Map(),
    confirmadosPorCaminho: new Map(),
    confirmadosPorSha: new Map(),
    statusRecebidos: [],
    puts: [],
    contar: (metodo, sub) => site.requisicoes.filter((r) => r.metodo === metodo && r.sub === sub).length,
  };

  const servidor = http.createServer(async (req, res) => {
    const pedacos = [];
    for await (const pedaco of req) pedacos.push(pedaco);
    const corpo = Buffer.concat(pedacos);
    const rota = new URL(req.url, 'http://local').pathname;

    const responder = (status, objeto) => {
      if (objeto === undefined) {
        res.writeHead(status);
        res.end();
        return;
      }
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(objeto));
    };

    if (rota.startsWith('/r2/')) {
      const id = rota.slice(4);
      const pendente = site.pendentes.get(id);
      site.puts.push({ id, metodo: req.method, cabecalhos: req.headers, tamanho: corpo.length });
      if (req.method !== 'PUT' || !pendente) return responder(403);
      if (site.falharPut) return responder(site.falharPut);
      const base64 = createHash('sha256').update(corpo).digest('base64');
      const tamanhoOk = req.headers['content-length'] === String(pendente.tamanho) && corpo.length === pendente.tamanho;
      const shaOk = req.headers['x-amz-checksum-sha256'] === base64 && base64 === pendente.base64;
      if (!tamanhoOk || !shaOk) return responder(400);
      site.objetos.set(id, corpo);
      return responder(200);
    }

    if (req.headers.authorization !== `Bearer ${chave}` || !rota.startsWith(PREFIXO_API)) return responder(404);

    const sub = rota.slice(PREFIXO_API.length);
    let json;
    try {
      json = corpo.length > 0 ? JSON.parse(corpo.toString('utf8')) : undefined;
    } catch {
      json = undefined;
    }
    site.requisicoes.push({ metodo: req.method, sub, json, cabecalhos: req.headers });

    const forcado = site.interceptar?.({ metodo: req.method, sub, json });
    if (forcado) return responder(forcado.status, forcado.corpo);

    if (req.method === 'GET' && sub === '/configuracao') {
      return responder(200, {
        versao_api: 1,
        limite_bytes: 104857600,
        bloqueio: ['DADOS DO EMPREENDEDOR', 'COMPROVANTE', 'NOTAS FISCAIS', 'PLANILHA'],
        empreendimentos: site.empreendimentos,
      });
    }

    if (req.method === 'POST' && sub === '/envios') {
      const porCaminho = `${json.codigo_pasta}|${json.caminho_relativo.toLowerCase()}`;
      if (site.confirmadosPorCaminho.get(porCaminho) === json.sha256) return responder(200, { estado: 'ja_enviado' });
      if (site.confirmadosPorSha.has(`${json.codigo_pasta}|${json.sha256}`)) return responder(200, { estado: 'duplicado' });
      const id = randomUUID();
      const base64 = Buffer.from(json.sha256, 'hex').toString('base64');
      site.pendentes.set(id, { json, tamanho: json.tamanho, base64 });
      return responder(200, {
        estado: 'autorizado',
        envio_id: id,
        url: `${site.url}/r2/${id}?X-Amz-Signature=${SEGREDO_DA_URL}`,
        cabecalhos: { 'content-type': 'application/pdf', 'x-amz-checksum-sha256': base64 },
        expira_em: new Date(Date.now() + 5 * MINUTO).toISOString(),
      });
    }

    const confirmar = /^\/envios\/([^/]+)\/confirmar$/.exec(sub);
    if (req.method === 'POST' && confirmar) {
      const id = confirmar[1];
      const pendente = site.pendentes.get(id);
      const objeto = site.objetos.get(id);
      if (!pendente || !objeto) return responder(200, { estado: 'recusado', motivo: 'objeto ausente' });
      const sha = createHash('sha256').update(objeto).digest('hex');
      if (sha !== pendente.json.sha256) return responder(200, { estado: 'recusado', motivo: 'sha diferente' });
      site.confirmadosPorCaminho.set(`${pendente.json.codigo_pasta}|${pendente.json.caminho_relativo.toLowerCase()}`, sha);
      site.confirmadosPorSha.set(`${pendente.json.codigo_pasta}|${sha}`, pendente.json.caminho_relativo);
      return responder(200, { estado: 'confirmado', documento_id: randomUUID(), liberado: false });
    }

    if (req.method === 'POST' && sub === '/status') {
      site.statusRecebidos.push(json);
      return responder(204);
    }

    return responder(404);
  });

  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  site.url = `http://127.0.0.1:${servidor.address().port}`;
  site.fechar = () =>
    new Promise((resolve) => {
      servidor.closeAllConnections();
      servidor.close(() => resolve());
    });
  return site;
}

export function escreverPdf(raiz, relativo, conteudo = relativo) {
  const abs = path.join(raiz, ...relativo.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `%PDF-1.4\n${conteudo}\n%%EOF`);
  return abs;
}

export function alterarPdf(abs, conteudo, segundosAdiante = 100) {
  fs.writeFileSync(abs, `%PDF-1.4\n${conteudo}\n%%EOF`);
  const depois = new Date(Date.now() + segundosAdiante * 1000);
  fs.utimesSync(abs, depois, depois);
}

export function lerEstado(config) {
  return JSON.parse(fs.readFileSync(path.join(config.pastaEstado, 'estado.json'), 'utf8'));
}

export function lerTodosOsLogs(config) {
  return fs
    .readdirSync(config.pastaLogs)
    .map((nome) => fs.readFileSync(path.join(config.pastaLogs, nome), 'utf8'))
    .join('\n');
}

export async function criarAmbiente() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aba-conector-'));
  const raiz = path.join(tmp, 'raiz');
  fs.mkdirSync(raiz, { recursive: true });
  const site = await criarSiteFalso();
  site.empreendimentos = EMP_PADRAO;
  const config = {
    urlSite: site.url,
    raiz,
    pastaEstado: path.join(tmp, 'estado'),
    pastaLogs: path.join(tmp, 'logs'),
  };
  const relogio = relogioFalso();
  const log = criarLog({ pasta: config.pastaLogs, relogio: relogio.agora, segredos: [CHAVE_TESTE, raiz] });

  return {
    tmp,
    raiz,
    site,
    config,
    relogio,
    log,
    ciclo: (extra = {}) =>
      executarCiclo({
        config,
        chave: extra.chave ?? CHAVE_TESTE,
        log,
        relogio: relogio.agora,
        limites: extra.limites,
        fsSeguro: extra.fsSeguro,
      }),
    async limpar() {
      await site.fechar();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

export async function comAmbiente(corpo) {
  const ambiente = await criarAmbiente();
  try {
    await corpo(ambiente);
  } finally {
    await ambiente.limpar();
  }
}
