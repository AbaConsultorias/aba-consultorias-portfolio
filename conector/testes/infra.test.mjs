import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { carregarEstado, estadoVazio, salvarEstado } from '../src/estado.mjs';
import { criarLog, limparLogsAntigos, redigir } from '../src/log.mjs';
import { rodar } from '../src/programa.mjs';
import { adquirirTrava } from '../src/trava.mjs';
import { CHAVE_TESTE, EMP_PADRAO, MINUTO, comAmbiente, escreverPdf, PASTA_EMP, PREFIXO_REGRA } from './ajuda.mjs';

function pastaTemporaria() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aba-infra-'));
}

test('trava: segunda aquisição é recusada e a liberação devolve a trava', () => {
  const pasta = pastaTemporaria();
  try {
    const arquivo = path.join(pasta, 'ciclo.lock');
    const primeira = adquirirTrava(arquivo, () => 1000);
    assert.equal(primeira.ok, true);
    assert.equal(adquirirTrava(arquivo, () => 2000).ok, false);
    primeira.liberar();
    assert.equal(fs.existsSync(arquivo), false);
    assert.equal(adquirirTrava(arquivo, () => 3000).ok, true);
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});

test('trava: com mais de 15 min, ou de um processo que não existe mais, é descartada', () => {
  const pasta = pastaTemporaria();
  try {
    const arquivo = path.join(pasta, 'ciclo.lock');
    fs.writeFileSync(arquivo, JSON.stringify({ pid: process.pid, em: 0 }));
    assert.equal(adquirirTrava(arquivo, () => 16 * MINUTO).ok, true);
    fs.rmSync(arquivo);

    fs.writeFileSync(arquivo, JSON.stringify({ pid: process.pid, em: 0 }));
    assert.equal(adquirirTrava(arquivo, () => 14 * MINUTO).ok, false);

    fs.writeFileSync(arquivo, JSON.stringify({ pid: 2_147_483_000, em: 14 * MINUTO }));
    assert.equal(adquirirTrava(arquivo, () => 14 * MINUTO).ok, true);

    fs.writeFileSync(arquivo, 'lixo');
    assert.equal(adquirirTrava(arquivo, () => Date.now() + 16 * MINUTO).ok, true);
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});

test('estado: grava de forma atômica e recupera um arquivo corrompido', () => {
  const pasta = pastaTemporaria();
  try {
    const arquivo = path.join(pasta, 'estado', 'estado.json');
    const estado = estadoVazio();
    estado.arquivos['250101/a.pdf'] = { tamanho: 1, mtimeMs: 2, observadoEm: 3 };
    salvarEstado(arquivo, estado);
    assert.deepEqual(fs.readdirSync(path.dirname(arquivo)), ['estado.json']);
    assert.deepEqual(carregarEstado(arquivo).arquivos, estado.arquivos);

    fs.writeFileSync(arquivo, '{ quebrado');
    const avisos = [];
    const recuperado = carregarEstado(arquivo, { aviso: (m) => avisos.push(m) });
    assert.deepEqual(recuperado.arquivos, {});
    assert.equal(avisos.length, 1);
    assert.ok(fs.readdirSync(path.dirname(arquivo)).some((n) => n.includes('corrompido')));

    assert.deepEqual(carregarEstado(path.join(pasta, 'nao-existe.json')).arquivos, {});
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});

test('log: redige chave, URL assinada e caminhos, e guarda 30 dias', () => {
  const texto = redigir(`chave ${CHAVE_TESTE} em https://x.r2.cloudflarestorage.com/o?X-Amz-Signature=abc em \\\\aba-servidor\\DRIVER\\x e C:\\ABA\\y`, ['segredo-extra']);
  assert.equal(texto.includes(CHAVE_TESTE), false);
  assert.equal(texto.includes('https://'), false);
  assert.equal(texto.includes('aba-servidor'), false);
  assert.equal(texto.includes('C:\\ABA'), false);
  assert.equal(redigir('abc segredo-extra def', ['segredo-extra']), 'abc [oculto] def');

  const pasta = pastaTemporaria();
  try {
    const agora = new Date(2026, 10, 4, 12).getTime();
    fs.writeFileSync(path.join(pasta, 'conector-2026-09-01.log'), 'velho');
    fs.writeFileSync(path.join(pasta, 'conector-2026-10-20.log'), 'recente');
    fs.writeFileSync(path.join(pasta, 'outro.txt'), 'não é log');
    limparLogsAntigos(pasta, () => agora, 30);
    assert.deepEqual(fs.readdirSync(pasta).sort(), ['conector-2026-10-20.log', 'outro.txt']);

    const log = criarLog({ pasta, relogio: () => agora, segredos: [CHAVE_TESTE] });
    log.info(`olha a chave ${CHAVE_TESTE}`);
    assert.match(path.basename(log.arquivoAtual()), /^conector-2026-11-04\.log$/);
    assert.equal(fs.readFileSync(log.arquivoAtual(), 'utf8').includes(CHAVE_TESTE), false);
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});

function prepararExecucao(a) {
  const caminhoConfig = path.join(a.tmp, 'config.json');
  fs.writeFileSync(caminhoConfig, `\uFEFF${JSON.stringify(a.config)}`);
  fs.mkdirSync(a.config.pastaEstado, { recursive: true });
  return {
    env: { ABA_CONECTOR_CHAVE: CHAVE_TESTE, ABA_CONECTOR_CONFIG: caminhoConfig },
    relogio: a.relogio.agora,
    lock: path.join(a.config.pastaEstado, 'ciclo.lock'),
  };
}

test('uma trava recente impede a execução dupla e a trava velha não', () =>
  comAmbiente(async (a) => {
    a.site.empreendimentos = EMP_PADRAO;
    const { env, relogio, lock } = prepararExecucao(a);

    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, em: relogio() }));
    assert.equal(await rodar({ env, relogio }), 0);
    assert.equal(a.site.requisicoes.length, 0);
    assert.equal(fs.existsSync(lock), true);

    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, em: relogio() - 20 * MINUTO }));
    assert.equal(await rodar({ env, relogio }), 0);
    assert.equal(a.site.contar('GET', '/configuracao'), 1);
    assert.equal(fs.existsSync(lock), false);
  }));

test('duas execuções ao mesmo tempo: só uma chega ao site', () =>
  comAmbiente(async (a) => {
    escreverPdf(a.raiz, `${PASTA_EMP}/${PREFIXO_REGRA}/a.pdf`);
    const { env, relogio } = prepararExecucao(a);

    const codigos = await Promise.all([rodar({ env, relogio }), rodar({ env, relogio })]);
    assert.deepEqual(codigos, [0, 0]);
    assert.equal(a.site.contar('GET', '/configuracao'), 1);
  }));

test('sem chave ou com configuração ruim, sai com código 2 sem tocar no site', () =>
  comAmbiente(async (a) => {
    const { env, relogio } = prepararExecucao(a);
    assert.equal(await rodar({ env: { ...env, ABA_CONECTOR_CHAVE: undefined }, relogio }), 2);
    assert.equal(await rodar({ env: { ...env, ABA_CONECTOR_CHAVE: 'abacon_curta' }, relogio }), 2);
    assert.equal(await rodar({ env: { ...env, ABA_CONECTOR_CONFIG: path.join(a.tmp, 'nada.json') }, relogio }), 2);
    assert.equal(a.site.requisicoes.length, 0);
  }));

test('chave recusada pelo site devolve o código 3 ao agendador', () =>
  comAmbiente(async (a) => {
    const { env, relogio } = prepararExecucao(a);
    assert.equal(await rodar({ env: { ...env, ABA_CONECTOR_CHAVE: `abacon_${'B'.repeat(43)}` }, relogio }), 3);
  }));
