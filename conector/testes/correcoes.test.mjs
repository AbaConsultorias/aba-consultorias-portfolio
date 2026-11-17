import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { hashConfiguracao } from '../src/configuracao-site.mjs';
import { expirarRecusas, registrarRecusaNaConfirmacao } from '../src/estabilidade.mjs';
import {
  FOLGA_MAXIMA_BLOQUEIO_MS,
  carregarEstado,
  estadoVazio,
  salvarEstado,
} from '../src/estado.mjs';
import { adquirirTrava } from '../src/trava.mjs';
import { MINUTO, PASTA_EMP, PREFIXO_REGRA, comAmbiente, escreverPdf, lerEstado } from './ajuda.mjs';

const PDF = (nome) => `${PASTA_EMP}/${PREFIXO_REGRA}/${nome}`;
const SHA = 'a'.repeat(64);
const HORA = 60 * MINUTO;

function comEstadoEmDisco(arquivos, extra, corpo) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'aba-estado-'));
  try {
    const caminho = path.join(pasta, 'estado.json');
    salvarEstado(caminho, { ...estadoVazio(), arquivos, ...extra });
    return corpo(caminho);
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}

const valido = { tamanho: 10, mtimeMs: 1000, observadoEm: 5000 };

// ---------------------------------------------------------------- 3. estado

test('estado: registros inválidos são descartados e os válidos ficam intactos', () => {
  const bons = {
    '250101/ok.pdf': valido,
    '250101/enviado.pdf': {
      ...valido,
      sha256: SHA,
      shaTamanho: 10,
      shaMtimeMs: 1000,
      resultado: { tipo: 'confirmado', em: '2026-11-04T13:00:00.000Z' },
    },
    '250101/zero.pdf': { ...valido, tamanho: 0 },
  };
  const ruins = {
    '250101/sem-observado.pdf': { tamanho: 10, mtimeMs: 1000 },
    '250101/data-nula.pdf': { ...valido, observadoEm: null },
    '250101/data-texto.pdf': { ...valido, observadoEm: '2026-11-04' },
    '250101/data-fora-da-faixa.pdf': { ...valido, observadoEm: 9e15 },
    '250101/tamanho-negativo.pdf': { ...valido, tamanho: -1 },
    '250101/tamanho-fracionado.pdf': { ...valido, tamanho: 1.5 },
    '250101/tamanho-texto.pdf': { ...valido, tamanho: '10' },
    '250101/mtime-nulo.pdf': { ...valido, mtimeMs: null },
    '250101/sha-curto.pdf': { ...valido, sha256: 'abc', shaTamanho: 10, shaMtimeMs: 1000 },
    '250101/sha-maiusculo.pdf': { ...valido, sha256: 'A'.repeat(64), shaTamanho: 10, shaMtimeMs: 1000 },
    '250101/sha-sem-versao.pdf': { ...valido, sha256: SHA },
    '250101/resultado-desconhecido.pdf': { ...valido, resultado: { tipo: 'talvez' } },
    '250101/resultado-texto.pdf': { ...valido, resultado: 'confirmado' },
    '250101/lista.pdf': [1, 2, 3],
    '250101/texto.pdf': 'x',
    'sem-barra': valido,
  };
  comEstadoEmDisco({ ...bons, ...ruins }, {}, (caminho) => {
    const avisos = [];
    const estado = carregarEstado(caminho, { aviso: (m) => avisos.push(m) }, 0);
    assert.deepEqual(estado.arquivos, bons);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], new RegExp(`${Object.keys(ruins).length} registro`));
  });
});

test('estado: bloqueadoAte nunca passa de agora + 2 horas e valor inválido é ignorado', () => {
  const agora = 1_000_000;
  const ler = (bloqueadoAte) => comEstadoEmDisco({}, { bloqueadoAte }, (caminho) => carregarEstado(caminho, null, agora).bloqueadoAte);

  assert.equal(ler(agora + 30 * 24 * HORA), agora + FOLGA_MAXIMA_BLOQUEIO_MS);
  assert.equal(ler(agora + 10 * MINUTO), agora + 10 * MINUTO);
  assert.equal(ler('amanhã'), 0);
  assert.equal(ler(null), 0);
  assert.equal(ler(-5), 0);
  assert.equal(ler(0), 0);
});

test('registro sem observadoEm não fica preso em "aguardar": é descartado e o arquivo é enviado', () =>
  comAmbiente(async (a) => {
    escreverPdf(a.raiz, PDF('a.pdf'));
    await a.ciclo();

    const caminho = path.join(a.config.pastaEstado, 'estado.json');
    const estado = lerEstado(a.config);
    for (const registro of Object.values(estado.arquivos)) delete registro.observadoEm;
    fs.writeFileSync(caminho, JSON.stringify(estado));

    a.relogio.avancar(MINUTO + 1000);
    const reobservado = await a.ciclo();
    assert.equal(reobservado.contagens.aguardando_estabilidade, 1);
    assert.equal(a.site.contar('POST', '/envios'), 0);

    a.relogio.avancar(MINUTO + 1000);
    const enviado = await a.ciclo();
    assert.equal(enviado.contagens.enviados, 1);
  }));

test('bloqueadoAte absurdo no estado não impede de consultar o site depois de 2 horas', () =>
  comAmbiente(async (a) => {
    escreverPdf(a.raiz, PDF('a.pdf'));
    salvarEstado(path.join(a.config.pastaEstado, 'estado.json'), {
      ...estadoVazio(),
      bloqueadoAte: a.relogio.agora() + 365 * 24 * HORA,
    });

    const adiado = await a.ciclo();
    assert.equal(adiado.adiado, true);
    assert.equal(a.site.requisicoes.length, 0);

    a.relogio.avancar(2 * HORA + MINUTO);
    const retomado = await a.ciclo();
    assert.equal(retomado.adiado, undefined);
    assert.equal(a.site.contar('GET', '/configuracao'), 1);
  }));

// ------------------------------------------------------------------ 4. trava

const LOCK = path.join(path.resolve('/'), 'aba', 'estado', 'ciclo.lock');

function fsEmMemoria(inicial = {}) {
  const arquivos = new Map(Object.entries(inicial));
  const abertos = new Map();
  let proximoFd = 100;
  const erro = (code) => Object.assign(new Error(code), { code });
  return {
    arquivos,
    openSync(caminho, flag) {
      assert.equal(flag, 'wx');
      if (arquivos.has(caminho)) throw erro('EEXIST');
      arquivos.set(caminho, '');
      proximoFd += 1;
      abertos.set(proximoFd, caminho);
      return proximoFd;
    },
    writeSync(fd, dados) {
      const caminho = abertos.get(fd);
      arquivos.set(caminho, arquivos.get(caminho) + dados);
    },
    closeSync(fd) {
      abertos.delete(fd);
    },
    readFileSync(caminho) {
      if (!arquivos.has(caminho)) throw erro('ENOENT');
      return arquivos.get(caminho);
    },
    statSync(caminho) {
      if (!arquivos.has(caminho)) throw erro('ENOENT');
      return { mtimeMs: 0 };
    },
    renameSync(de, para) {
      if (!arquivos.has(de)) throw erro('ENOENT');
      arquivos.set(para, arquivos.get(de));
      arquivos.delete(de);
    },
    rmSync(caminho) {
      arquivos.delete(caminho);
    },
    linkSync(de, para) {
      if (!arquivos.has(de)) throw erro('ENOENT');
      if (arquivos.has(para)) throw erro('EEXIST');
      arquivos.set(para, arquivos.get(de));
    },
  };
}

function comGancho(base, aoLerTrava) {
  let leituras = 0;
  return {
    ...base,
    readFileSync(caminho, ...resto) {
      const conteudo = base.readFileSync(caminho, ...resto);
      if (caminho === LOCK) {
        leituras += 1;
        aoLerTrava(leituras);
      }
      return conteudo;
    },
  };
}

const TRAVA_VELHA = JSON.stringify({ pid: 2_147_483_000, em: 0 });
const relogioDe20Min = () => 20 * MINUTO;

test('trava velha: dois processos que a leram ao mesmo tempo não rodam juntos', () => {
  const memoria = fsEmMemoria({ [LOCK]: TRAVA_VELHA });
  let resultadoA;
  const fsB = comGancho(memoria, (leitura) => {
    if (leitura === 2) {
      resultadoA = adquirirTrava(LOCK, relogioDe20Min, { pid: 111, fsImpl: memoria, aleatorio: () => 'aaaa' });
    }
  });

  const resultadoB = adquirirTrava(LOCK, relogioDe20Min, { pid: 222, fsImpl: fsB, aleatorio: () => 'bbbb' });

  assert.equal(resultadoA.ok, true);
  assert.equal(resultadoB.ok, false);
  assert.equal(JSON.parse(memoria.arquivos.get(LOCK)).pid, 111);
  assert.deepEqual([...memoria.arquivos.keys()], [LOCK]);
});

test('trava velha: o rename usa nome único e só um dos dois leva o arquivo', () => {
  const memoria = fsEmMemoria({ [LOCK]: TRAVA_VELHA });
  const renomeados = [];
  const rastreada = { ...memoria, renameSync: (de, para) => (renomeados.push(para), memoria.renameSync(de, para)) };

  const resultado = adquirirTrava(LOCK, relogioDe20Min, { pid: process.pid, fsImpl: rastreada, aleatorio: () => 'cafe' });
  assert.equal(resultado.ok, true);
  assert.deepEqual(renomeados, [`${LOCK}.${process.pid}.cafe.velha`]);
  assert.deepEqual([...memoria.arquivos.keys()], [LOCK]);
  assert.equal(JSON.parse(memoria.arquivos.get(LOCK)).pid, process.pid);

  const perdedor = adquirirTrava(LOCK, relogioDe20Min, { pid: 444, fsImpl: memoria });
  assert.equal(perdedor.ok, false);
});

test('trava velha que o dono libera antes do rename: tenta criar e assume a trava', () => {
  const memoria = fsEmMemoria({ [LOCK]: TRAVA_VELHA });
  const fsB = comGancho(memoria, (leitura) => {
    if (leitura === 2) memoria.arquivos.delete(LOCK);
  });

  const resultado = adquirirTrava(LOCK, relogioDe20Min, { pid: 555, fsImpl: fsB });
  assert.equal(resultado.ok, true);
  assert.equal(JSON.parse(memoria.arquivos.get(LOCK)).pid, 555);
});

test('trava: quem perdeu a criação depois de tomar a velha sai sem rodar', () => {
  const memoria = fsEmMemoria({ [LOCK]: TRAVA_VELHA });
  const criandoPorFora = {
    ...memoria,
    rmSync: (caminho, opcoes) => {
      memoria.rmSync(caminho, opcoes);
      if (caminho.endsWith('.velha')) memoria.arquivos.set(LOCK, JSON.stringify({ pid: 1, em: relogioDe20Min() }));
    },
  };

  const resultado = adquirirTrava(LOCK, relogioDe20Min, { pid: 666, fsImpl: criandoPorFora });
  assert.equal(resultado.ok, false);
  assert.equal(JSON.parse(memoria.arquivos.get(LOCK)).pid, 1);
});

// ------------------------------------------------------------- 5. recusas

test('registrarRecusaNaConfirmacao: definitiva só na 3ª recusa', () => {
  const registro = { ...valido };
  assert.deepEqual(registrarRecusaNaConfirmacao(registro), { tentativas: 1, definitiva: false });
  assert.deepEqual(registrarRecusaNaConfirmacao(registro), { tentativas: 2, definitiva: false });
  assert.deepEqual(registrarRecusaNaConfirmacao(registro), { tentativas: 3, definitiva: true });
});

test('recusa na confirmação é tentada de novo, no máximo 3 vezes por versão do arquivo', () =>
  comAmbiente(async (a) => {
    const abs = escreverPdf(a.raiz, PDF('regra-mudou.pdf'), 'v1');
    a.site.interceptar = ({ sub }) =>
      /\/confirmar$/.test(sub) ? { status: 200, corpo: { estado: 'recusado', motivo: 'regra inativa' } } : undefined;
    const registro = () => Object.values(lerEstado(a.config).arquivos)[0];

    await a.ciclo();
    a.relogio.avancar(MINUTO + 1000);
    const primeira = await a.ciclo();
    assert.equal(a.site.contar('POST', '/envios'), 1);
    assert.equal(primeira.contagens.recusados, 0);
    assert.equal(primeira.contagens.erros, 1);
    assert.equal(registro().resultado, undefined);
    assert.equal(registro().recusasConfirmacao, 1);

    a.relogio.avancar(MINUTO + 1000);
    await a.ciclo();
    assert.equal(a.site.contar('POST', '/envios'), 2);
    assert.equal(registro().resultado, undefined);

    a.relogio.avancar(MINUTO + 1000);
    const terceira = await a.ciclo();
    assert.equal(a.site.contar('POST', '/envios'), 3);
    assert.equal(terceira.contagens.recusados, 1);
    assert.equal(registro().resultado.tipo, 'recusado');
    assert.equal(registro().resultado.motivo, 'regra inativa');

    a.relogio.avancar(MINUTO + 1000);
    await a.ciclo();
    assert.equal(a.site.contar('POST', '/envios'), 3);

    a.site.interceptar = null;
    fs.writeFileSync(abs, '%PDF-1.4\nv2 corrigida\n%%EOF');
    const depois = new Date(Date.now() + 500_000);
    fs.utimesSync(abs, depois, depois);
    a.relogio.avancar(MINUTO + 1000);
    await a.ciclo();
    a.relogio.avancar(MINUTO + 1000);
    const nova = await a.ciclo();
    assert.equal(nova.contagens.enviados, 1);
  }));

test('recusa na confirmação que passa na repetição confirma o arquivo', () =>
  comAmbiente(async (a) => {
    escreverPdf(a.raiz, PDF('a.pdf'));
    let recusas = 0;
    a.site.interceptar = ({ sub }) => {
      if (!/\/confirmar$/.test(sub) || recusas >= 1) return undefined;
      recusas += 1;
      return { status: 200, corpo: { estado: 'recusado', motivo: 'tente de novo' } };
    };

    await a.ciclo();
    a.relogio.avancar(MINUTO + 1000);
    await a.ciclo();
    a.relogio.avancar(MINUTO + 1000);
    const segunda = await a.ciclo();
    assert.equal(segunda.contagens.enviados, 1);
    const registro = Object.values(lerEstado(a.config).arquivos)[0];
    assert.equal(registro.resultado.tipo, 'confirmado');
    assert.equal(registro.recusasConfirmacao, undefined);
  }));

test('hashConfiguracao: ignora ordem e campos extras e muda com regra, bloqueio ou limite', () => {
  const base = {
    limite_bytes: 100,
    bloqueio: ['A', 'B'],
    empreendimentos: [
      { codigo_pasta: '1', regras: [{ id: 'r1', caminho_prefixo: 'x' }, { id: 'r2', caminho_prefixo: 'y' }] },
      { codigo_pasta: '2', regras: [{ id: 'r3', caminho_prefixo: 'z' }] },
    ],
  };
  const hash = hashConfiguracao(base);
  assert.match(hash, /^[0-9a-f]{64}$/);

  const embaralhada = {
    versao_api: 1,
    atualizado_em: 'agora',
    empreendimentos: [base.empreendimentos[1], { ...base.empreendimentos[0], regras: [...base.empreendimentos[0].regras].reverse() }],
    bloqueio: ['B', 'A'],
    limite_bytes: 100,
  };
  assert.equal(hashConfiguracao(embaralhada), hash);

  const outraRegra = structuredClone(base);
  outraRegra.empreendimentos[0].regras[0].caminho_prefixo = 'x/outra';
  assert.notEqual(hashConfiguracao(outraRegra), hash);
  assert.notEqual(hashConfiguracao({ ...base, bloqueio: ['A', 'B', 'C'] }), hash);
  assert.notEqual(hashConfiguracao({ ...base, limite_bytes: 50 }), hash);
  assert.notEqual(hashConfiguracao({ ...base, empreendimentos: [base.empreendimentos[0]] }), hash);
});

test('expirarRecusas limpa só as recusas, e só quando o hash muda', () => {
  const estado = {
    arquivos: {
      'a/1.pdf': { ...valido, resultado: { tipo: 'recusado' }, recusasConfirmacao: 3 },
      'a/2.pdf': { ...valido, resultado: { tipo: 'confirmado' } },
      'a/3.pdf': { ...valido },
    },
  };
  assert.equal(expirarRecusas(estado, 'h1'), 1);
  assert.equal(estado.configHash, 'h1');
  assert.equal(estado.arquivos['a/1.pdf'].resultado, undefined);
  assert.equal(estado.arquivos['a/1.pdf'].recusasConfirmacao, undefined);
  assert.equal(estado.arquivos['a/2.pdf'].resultado.tipo, 'confirmado');

  estado.arquivos['a/3.pdf'].resultado = { tipo: 'recusado' };
  assert.equal(expirarRecusas(estado, 'h1'), 0);
  assert.equal(estado.arquivos['a/3.pdf'].resultado.tipo, 'recusado');
  assert.equal(expirarRecusas(estado, 'h2'), 1);
});

test('recusa definitiva do site expira quando a configuração muda', () =>
  comAmbiente(async (a) => {
    escreverPdf(a.raiz, PDF('fora.pdf'));
    a.site.interceptar = ({ sub }) =>
      sub === '/envios' ? { status: 200, corpo: { estado: 'recusado', motivo: 'fora de regra' } } : undefined;

    await a.ciclo();
    a.relogio.avancar(MINUTO + 1000);
    await a.ciclo();
    assert.equal(a.site.contar('POST', '/envios'), 1);

    a.relogio.avancar(MINUTO + 1000);
    const igual = await a.ciclo();
    assert.equal(igual.contagens.recusados, 1);
    assert.equal(a.site.contar('POST', '/envios'), 1);

    a.site.empreendimentos = [
      {
        codigo_pasta: '250101',
        regras: [
          { id: 'r1', caminho_prefixo: PREFIXO_REGRA },
          { id: 'r2', caminho_prefixo: '03 - PRODUTOS/LAN/OUTRA' },
        ],
      },
    ];
    a.relogio.avancar(MINUTO + 1000);
    const mudou = await a.ciclo();
    assert.equal(a.site.contar('POST', '/envios'), 2);
    assert.equal(mudou.contagens.recusados, 1);
    assert.match(lerEstado(a.config).configHash, /^[0-9a-f]{64}$/);
  }));
