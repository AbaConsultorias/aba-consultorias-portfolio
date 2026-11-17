import fs from 'node:fs/promises';
import path from 'node:path';
import { ErroApi, criarClienteApi, validarAutorizacao } from './api.mjs';
import { FS_REAL, abrirArquivoSeguro } from './arquivo-seguro.mjs';
import {
  caminhoBloqueado,
  chaveComparacao,
  estaDentro,
  minimizarPrefixos,
  nfc,
  prefixoMaisLongo,
} from './caminho.mjs';
import { hashConfiguracao, interpretarConfiguracao } from './configuracao-site.mjs';
import {
  MAX_RECUSAS_NA_CONFIRMACAO,
  avaliarArquivo,
  expirarRecusas,
  novaObservacao,
  registrarRecusaNaConfirmacao,
  shaConhecido,
} from './estabilidade.mjs';
import { sha256Buffer } from './hash.mjs';
import { LIMITES_PADRAO, criarOrcamento, limitarArvores } from './limites.mjs';
import { descreverErro } from './log.mjs';
import { carregarEstado, salvarEstado } from './estado.mjs';
import {
  acharPastaEmpreendimento,
  construirArvore,
  listarRaiz,
  percorrerPdfs,
  resolverPrefixo,
} from './varredura.mjs';
import { VERSAO } from './versao.mjs';

const MAX_ERROS_NO_STATUS = 100;
const SALVAR_A_CADA = 50;
const TIMEOUT_PUT_MAX_MS = 4 * 60_000;

export const CODIGO_SAIDA = Object.freeze({ ok: 0, falha: 1, config: 2, chave: 3 });

class ParadaCiclo extends Error {
  constructor(motivo) {
    super(motivo);
    this.name = 'ParadaCiclo';
    this.motivo = motivo;
  }
}

const MENSAGEM_PASTA = {
  nenhuma: (codigo) => `Nenhuma pasta começa com "${codigo} - " na pasta raiz`,
  varias: (codigo) => `Mais de uma pasta começa com "${codigo} - "; deixe só uma`,
  link: (codigo) => `A pasta "${codigo} - " é um atalho ou junção, e isso não é aceito`,
};

function contagensZeradas() {
  return {
    examinados: 0,
    enviados: 0,
    ja_enviados: 0,
    duplicados: 0,
    recusados: 0,
    erros: 0,
    aguardando_estabilidade: 0,
  };
}

function registrarErro(ctx, codigo, mensagem) {
  ctx.contagens.erros += 1;
  const limpa = ctx.log.redigir(mensagem);
  ctx.log.erro(`[${codigo}] ${limpa}`);
  if (ctx.erros.length < MAX_ERROS_NO_STATUS) {
    ctx.erros.push({ codigo_pasta: codigo, mensagem: limpa.slice(0, 300) });
  }
}

function salvar(ctx) {
  try {
    salvarEstado(ctx.caminhoEstado, ctx.estado);
    ctx.sujos = 0;
  } catch (erro) {
    ctx.log.erro(`Não foi possível gravar o estado (${descreverErro(erro)})`);
  }
}

function sujar(ctx) {
  ctx.sujos += 1;
  if (ctx.sujos >= SALVAR_A_CADA) salvar(ctx);
}

function contarConhecido(ctx, tipo) {
  if (tipo === 'confirmado' || tipo === 'ja_enviado') ctx.contagens.ja_enviados += 1;
  else if (tipo === 'duplicado') ctx.contagens.duplicados += 1;
  else if (tipo === 'recusado') ctx.contagens.recusados += 1;
}

function decidir(ctx, chaveEst, tipo, motivo) {
  const resultado = { tipo, em: new Date(ctx.relogio()).toISOString() };
  if (motivo) resultado.motivo = ctx.log.redigir(motivo).slice(0, 200);
  ctx.estado.arquivos[chaveEst].resultado = resultado;
  if (tipo === 'confirmado') ctx.contagens.enviados += 1;
  else contarConhecido(ctx, tipo);
  salvar(ctx);
}

function reobservar(ctx, chaveEst, atual) {
  ctx.estado.arquivos[chaveEst] = novaObservacao(ctx.estado.arquivos[chaveEst], atual, ctx.relogio());
  ctx.contagens.aguardando_estabilidade += 1;
  sujar(ctx);
}

async function abrirParaEnvio(ctx, emp, chaveEst, arq, caminhoRel) {
  const aberto = await abrirArquivoSeguro({
    arq,
    baseReal: emp.baseReal,
    bloqueio: ctx.bloqueio,
    fsImpl: ctx.fsSeguro,
  });
  if (aberto.ok) return aberto.arquivo;
  if (aberto.motivo === 'mudou') {
    reobservar(ctx, chaveEst, aberto.atual);
    return null;
  }
  registrarErro(ctx, emp.codigo, `${caminhoRel}: ${aberto.mensagem}; não foi enviado e será tentado no próximo ciclo`);
  return null;
}

async function obterSha(ctx, chaveEst, arquivo, atual) {
  const registro = ctx.estado.arquivos[chaveEst];
  const conhecido = shaConhecido(registro, atual);
  if (conhecido) return conhecido;

  const sha = await arquivo.sha256();
  const depois = await arquivo.atual();
  if (sha === null || depois.tamanho !== atual.tamanho || depois.mtimeMs !== atual.mtimeMs) {
    reobservar(ctx, chaveEst, depois);
    return null;
  }
  registro.sha256 = sha;
  registro.shaTamanho = atual.tamanho;
  registro.shaMtimeMs = atual.mtimeMs;
  sujar(ctx);
  return sha;
}

function esquecerSha(registro) {
  delete registro.sha256;
  delete registro.shaTamanho;
  delete registro.shaMtimeMs;
}

function tratarRecusaNaConfirmacao(ctx, emp, chaveEst, caminhoRel, confirmacao) {
  const motivo = String(confirmacao.motivo ?? 'Recusado na confirmação');
  const { tentativas, definitiva } = registrarRecusaNaConfirmacao(ctx.estado.arquivos[chaveEst]);
  if (definitiva) {
    decidir(ctx, chaveEst, 'recusado', motivo);
    ctx.log.info(`Recusado na confirmação [${emp.codigo}] ${caminhoRel}`);
    return;
  }
  registrarErro(
    ctx,
    emp.codigo,
    `${caminhoRel}: o site recusou na confirmação (${tentativas} de ${MAX_RECUSAS_NA_CONFIRMACAO}): ${motivo.slice(0, 150)}; será pedido de novo no próximo ciclo`,
  );
  salvar(ctx);
}

async function enviarEConfirmar(ctx, emp, chaveEst, arquivo, atual, sha, resposta, caminhoRel) {
  const autorizacao = validarAutorizacao(resposta);
  if (!autorizacao) throw new ErroApi('temporario', 'Autorização do site fora do formato esperado');

  const dados = await arquivo.ler();
  if (!dados || dados.length !== atual.tamanho || sha256Buffer(dados) !== sha) {
    esquecerSha(ctx.estado.arquivos[chaveEst]);
    reobservar(ctx, chaveEst, await arquivo.atual());
    return;
  }

  const limiteMs = Math.min(TIMEOUT_PUT_MAX_MS, Math.max(30_000, ctx.orcamento.restanteMs() + 30_000));
  await ctx.api.enviarAoArmazenamento(autorizacao.url, autorizacao.cabecalhos, dados, limiteMs);
  ctx.orcamento.registrarEnvio(atual.tamanho);

  const confirmacao = await ctx.api.confirmar(autorizacao.envioId);
  if (confirmacao?.estado === 'confirmado') {
    delete ctx.estado.arquivos[chaveEst].recusasConfirmacao;
    decidir(ctx, chaveEst, 'confirmado');
  } else if (confirmacao?.estado === 'recusado') {
    tratarRecusaNaConfirmacao(ctx, emp, chaveEst, caminhoRel, confirmacao);
  } else {
    throw new ErroApi('temporario', 'Resposta inesperada ao confirmar o envio');
  }
  ctx.falhasSeguidas = 0;
}

async function pedirEEnviar(ctx, emp, chaveEst, arquivo, atual, caminhoRel) {
  const sha = await obterSha(ctx, chaveEst, arquivo, atual);
  if (!sha) return;

  ctx.orcamento.registrarPedido();
  let resposta;
  try {
    resposta = await ctx.api.pedirEnvio({
      codigo_pasta: emp.codigo,
      caminho_relativo: caminhoRel,
      tamanho: atual.tamanho,
      sha256: sha,
      mtime: new Date(atual.mtimeMs).toISOString(),
    });
  } catch (erro) {
    if (erro instanceof ErroApi && erro.tipo === 'invalido') {
      decidir(ctx, chaveEst, 'recusado', erro.message);
      return;
    }
    throw erro;
  }
  ctx.falhasSeguidas = 0;

  switch (resposta?.estado) {
    case 'autorizado':
      await enviarEConfirmar(ctx, emp, chaveEst, arquivo, atual, sha, resposta, caminhoRel);
      if (ctx.estado.arquivos[chaveEst].resultado?.tipo === 'confirmado') {
        ctx.log.info(`Enviado [${emp.codigo}] ${caminhoRel}`);
      }
      return;
    case 'ja_enviado':
      decidir(ctx, chaveEst, 'ja_enviado');
      return;
    case 'duplicado':
      decidir(ctx, chaveEst, 'duplicado');
      return;
    case 'recusado':
      decidir(ctx, chaveEst, 'recusado', String(resposta.motivo ?? 'Recusado pelo site'));
      ctx.log.info(`Recusado pelo site [${emp.codigo}] ${caminhoRel}`);
      return;
    default:
      throw new ErroApi('temporario', 'Resposta inesperada ao pedir autorização de envio');
  }
}

async function processarArquivo(ctx, emp, arq) {
  const caminhoRel = arq.segmentos.map(nfc).join('/');
  const chaveEst = `${emp.codigo}/${chaveComparacao(caminhoRel)}`;
  if (ctx.vistos.has(chaveEst)) return;
  ctx.vistos.add(chaveEst);

  const dentroDeRegra = prefixoMaisLongo(emp.prefixos, arq.segmentos) !== null;
  if (!dentroDeRegra || caminhoBloqueado(arq.segmentos, ctx.bloqueio) || !estaDentro(emp.base, arq.abs)) return;

  ctx.contagens.examinados += 1;
  const atual = { tamanho: arq.info.size, mtimeMs: Math.trunc(arq.info.mtimeMs) };
  const avaliacao = avaliarArquivo(
    ctx.estado.arquivos[chaveEst],
    atual,
    ctx.relogio(),
    ctx.limites.intervaloEstabilidadeMs,
  );
  ctx.estado.arquivos[chaveEst] = avaliacao.registro;
  sujar(ctx);

  if (avaliacao.acao === 'ignorar') {
    contarConhecido(ctx, avaliacao.tipo);
    return;
  }
  if (avaliacao.acao === 'aguardar') {
    ctx.contagens.aguardando_estabilidade += 1;
    return;
  }

  if (atual.tamanho <= 0) {
    decidir(ctx, chaveEst, 'recusado', 'Arquivo vazio');
    return;
  }
  if (atual.tamanho > ctx.limiteBytes) {
    decidir(ctx, chaveEst, 'recusado', 'Arquivo maior que o limite');
    return;
  }
  if (!ctx.orcamento.podePedir(atual.tamanho)) {
    ctx.adiados += 1;
    return;
  }

  const arquivo = await abrirParaEnvio(ctx, emp, chaveEst, arq, caminhoRel);
  if (!arquivo) return;
  try {
    await pedirEEnviar(ctx, emp, chaveEst, arquivo, atual, caminhoRel);
  } finally {
    await arquivo.fechar();
  }
}

async function processarArquivoSeguro(ctx, emp, arq) {
  try {
    await processarArquivo(ctx, emp, arq);
  } catch (erro) {
    if (erro instanceof ParadaCiclo) throw erro;
    const rotulo = arq.segmentos.map(nfc).join('/');
    if (erro instanceof ErroApi) {
      if (erro.tipo === 'chave' || erro.tipo === 'limite') throw erro;
      registrarErro(ctx, emp.codigo, `${rotulo}: ${erro.message}`);
      ctx.falhasSeguidas += 1;
      if (ctx.falhasSeguidas >= ctx.limites.falhasSeguidasMax) throw new ParadaCiclo('rede');
      return;
    }
    registrarErro(ctx, emp.codigo, `${rotulo}: falha ao ler o arquivo (${descreverErro(erro)})`);
  }
}

async function processarEmpreendimento(ctx, emp) {
  if (!ctx.entradasRaiz) {
    registrarErro(ctx, emp.codigo, 'A pasta raiz não pôde ser lida pelo conector');
    return;
  }
  const achada = acharPastaEmpreendimento(ctx.entradasRaiz, emp.codigo);
  if (!achada.ok) {
    registrarErro(ctx, emp.codigo, MENSAGEM_PASTA[achada.motivo](emp.codigo));
    return;
  }

  const base = path.join(ctx.config.raiz, achada.nome);
  let infoBase;
  try {
    infoBase = await fs.lstat(base);
  } catch (erro) {
    registrarErro(ctx, emp.codigo, `A pasta do empreendimento não pôde ser lida (${descreverErro(erro)})`);
    return;
  }
  if (!estaDentro(ctx.config.raiz, base) || !infoBase.isDirectory() || infoBase.isSymbolicLink()) {
    registrarErro(ctx, emp.codigo, MENSAGEM_PASTA.link(emp.codigo));
    return;
  }
  let baseReal;
  try {
    baseReal = await ctx.fsSeguro.realpath(base);
  } catch (erro) {
    registrarErro(ctx, emp.codigo, `O caminho real da pasta do empreendimento não pôde ser resolvido (${descreverErro(erro)})`);
    return;
  }
  ctx.vinculados.push({ codigo: emp.codigo, base });

  const alvo = { codigo: emp.codigo, base, baseReal, prefixos: emp.prefixos };
  let leituraCompleta = true;
  const aoFalhar = (segmentos, erro) => {
    leituraCompleta = false;
    registrarErro(ctx, emp.codigo, `${segmentos.map(nfc).join('/') || '.'}: pasta ilegível (${descreverErro(erro)})`);
  };

  ctx.vistos = new Set();
  for (const prefixo of minimizarPrefixos(emp.prefixos)) {
    for (const inicio of await resolverPrefixo(base, prefixo, ctx.bloqueio, aoFalhar)) {
      for await (const arq of percorrerPdfs(inicio, ctx.bloqueio, aoFalhar)) {
        if (ctx.orcamento.tempoEsgotado()) throw new ParadaCiclo('tempo');
        await processarArquivoSeguro(ctx, alvo, arq);
      }
    }
  }

  if (!leituraCompleta) return;
  const marca = `${emp.codigo}/`;
  for (const chave of Object.keys(ctx.estado.arquivos)) {
    if (chave.startsWith(marca) && !ctx.vistos.has(chave)) delete ctx.estado.arquivos[chave];
  }
}

async function montarArvores(ctx) {
  const arvores = {};
  const guardadas = {};
  for (const { codigo, base } of ctx.vinculados) {
    const cache = ctx.estado.arvores?.[codigo];
    const fresca = cache && ctx.relogio() - cache.em < ctx.limites.validadeArvoreMs;
    if (fresca || ctx.orcamento.tempoEsgotado()) {
      if (cache) {
        arvores[codigo] = cache.pastas;
        guardadas[codigo] = cache;
      }
      continue;
    }
    const pastas = await construirArvore(base, ctx.bloqueio, {
      niveis: ctx.limites.niveisArvore,
      maxPastas: ctx.limites.maxPastasArvore,
      aoFalhar: (segmentos, erro) =>
        ctx.log.aviso(`[${codigo}] pasta ilegível ao montar a árvore (${descreverErro(erro)})`),
    });
    arvores[codigo] = pastas;
    guardadas[codigo] = { em: ctx.relogio(), pastas };
  }
  ctx.estado.arvores = guardadas;
  return limitarArvores(arvores, ctx.limites.maxPastasArvore);
}

function tratarErroDeApi(ctx, erro) {
  if (erro.tipo === 'chave') {
    ctx.log.erro(erro.message);
    ctx.codigoSaida = CODIGO_SAIDA.chave;
    ctx.enviarStatus = false;
  } else if (erro.tipo === 'limite') {
    ctx.estado.bloqueadoAte = ctx.relogio() + erro.tentarDepoisS * 1000;
    ctx.log.aviso(`${erro.message}: o ciclo parou e só volta a tentar em ${erro.tentarDepoisS}s`);
    ctx.enviarStatus = false;
  } else {
    ctx.log.aviso(erro.message);
  }
}

export async function executarCiclo({
  config,
  chave,
  log,
  relogio = Date.now,
  fetchImpl = globalThis.fetch,
  limites: limitesParcial = {},
  fsSeguro = FS_REAL,
}) {
  const limites = { ...LIMITES_PADRAO, ...limitesParcial };
  const ctx = {
    config,
    log,
    relogio,
    limites,
    orcamento: criarOrcamento(limites, relogio),
    api: criarClienteApi({ urlSite: config.urlSite, chave, fetchImpl }),
    caminhoEstado: path.join(config.pastaEstado, 'estado.json'),
    contagens: contagensZeradas(),
    erros: [],
    vinculados: [],
    vistos: new Set(),
    falhasSeguidas: 0,
    adiados: 0,
    sujos: 0,
    codigoSaida: CODIGO_SAIDA.ok,
    enviarStatus: true,
    configObtida: false,
    bloqueio: [],
    limiteBytes: 0,
    entradasRaiz: null,
    fsSeguro,
  };
  const inicio = new Date(relogio()).toISOString();
  ctx.estado = carregarEstado(ctx.caminhoEstado, log, relogio());

  if (ctx.estado.bloqueadoAte > relogio()) {
    log.info('Ciclo adiado: o limite do site (429) ainda está valendo');
    // o valor já vem limitado a 2 h; sem gravá-lo, cada ciclo o limitaria de novo a partir de "agora"
    salvar(ctx);
    return { codigoSaida: CODIGO_SAIDA.ok, adiado: true };
  }

  let parada = null;
  try {
    const resposta = await ctx.api.configuracao();
    const site = interpretarConfiguracao(resposta);
    if (!site) throw new ErroApi('temporario', 'Configuração do site fora do formato esperado');
    ctx.configObtida = true;
    ctx.bloqueio = site.bloqueio;
    ctx.limiteBytes = site.limiteBytes;
    const expiradas = expirarRecusas(ctx.estado, hashConfiguracao(resposta));
    if (expiradas > 0) log.info(`A configuração do site mudou: ${expiradas} arquivo(s) recusado(s) serão avaliados de novo`);
    for (const problema of site.problemas) registrarErro(ctx, problema.codigo, problema.mensagem);

    try {
      ctx.entradasRaiz = await listarRaiz(config.raiz);
    } catch (erro) {
      log.erro(`Pasta raiz ilegível (${descreverErro(erro)})`);
    }

    for (const emp of site.empreendimentos) {
      try {
        await processarEmpreendimento(ctx, emp);
      } catch (erro) {
        if (erro instanceof ErroApi || erro instanceof ParadaCiclo) throw erro;
        registrarErro(ctx, emp.codigo, `Falha inesperada (${descreverErro(erro)})`);
      }
    }
  } catch (erro) {
    if (erro instanceof ErroApi) {
      tratarErroDeApi(ctx, erro);
      if (!ctx.configObtida) ctx.enviarStatus = false;
    } else if (erro instanceof ParadaCiclo) {
      parada = erro.motivo;
      log.aviso(
        parada === 'tempo'
          ? 'Tempo máximo do ciclo atingido: o restante fica para o próximo'
          : 'O site falhou várias vezes seguidas: o ciclo parou',
      );
    } else {
      log.erro(`Falha inesperada no ciclo (${descreverErro(erro)})`);
      ctx.codigoSaida = CODIGO_SAIDA.falha;
    }
  }

  if (ctx.enviarStatus && ctx.configObtida) {
    try {
      const arvore = await montarArvores(ctx);
      await ctx.api.enviarStatus({
        versao: VERSAO,
        inicio,
        fim: new Date(relogio()).toISOString(),
        contagens: ctx.contagens,
        erros: ctx.erros,
        arvore,
      });
    } catch (erro) {
      if (erro instanceof ErroApi) tratarErroDeApi(ctx, erro);
      else log.erro(`Falha ao montar o status (${descreverErro(erro)})`);
    }
  }

  salvar(ctx);
  const uso = ctx.orcamento.uso();
  log.info(
    `Ciclo concluído: ${JSON.stringify(ctx.contagens)}; pedidos=${uso.pedidos}; adiados=${ctx.adiados}` +
      (parada ? `; parada=${parada}` : ''),
  );
  return { codigoSaida: ctx.codigoSaida, contagens: ctx.contagens, erros: ctx.erros, parada };
}
