import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { FS_REAL, abrirArquivoSeguro } from '../src/arquivo-seguro.mjs';
import { listaBloqueio } from '../src/caminho.mjs';
import { MINUTO, PASTA_EMP, PREFIXO_REGRA, comAmbiente, escreverPdf } from './ajuda.mjs';

const BASE = path.join(path.resolve('/'), 'servidor', 'emp');
const SEGMENTOS = ['03 - PRODUTOS', 'LAN', 'planta.pdf'];
const ABS = path.join(BASE, ...SEGMENTOS);
const CONTEUDO = Buffer.from('%PDF-1.4\nplanta aprovada\n%%EOF');
const BLOQUEIO = listaBloqueio();

function statFalso({ dev = 1n, ino = 10n, size = CONTEUDO.length, mtimeMs = 5000 } = {}) {
  return { dev, ino, size: BigInt(size), mtimeMs: BigInt(mtimeMs), isFile: () => true };
}

function arqFalso(extra = {}) {
  return {
    abs: ABS,
    segmentos: SEGMENTOS,
    info: { size: CONTEUDO.length, mtimeMs: 5000, dev: 1n, ino: 10n, ehArquivo: true, ...extra },
  };
}

function criarFsFalso({ handleStat = {}, conteudo = CONTEUDO, real = ABS, realStat = {} } = {}) {
  const fsFalso = { aberturas: [], leituras: 0, fechados: 0, realpaths: 0 };
  const handle = {
    stat: async () => statFalso(handleStat),
    read: async (buffer, offset, length, posicao) => {
      fsFalso.leituras += 1;
      const n = Math.max(0, Math.min(length, conteudo.length - posicao));
      conteudo.copy(buffer, offset, posicao, posicao + n);
      return { bytesRead: n, buffer };
    },
    close: async () => {
      fsFalso.fechados += 1;
    },
  };
  fsFalso.open = async (caminho) => {
    fsFalso.aberturas.push(caminho);
    return handle;
  };
  fsFalso.realpath = async () => {
    fsFalso.realpaths += 1;
    return real;
  };
  fsFalso.stat = async () => statFalso(realStat);
  return fsFalso;
}

const abrir = (fsImpl, arq = arqFalso()) => abrirArquivoSeguro({ arq, baseReal: BASE, bloqueio: BLOQUEIO, fsImpl });

test('arquivo verificado: abre uma vez só e hash e conteúdo saem do mesmo handle', async () => {
  const falso = criarFsFalso();
  const resultado = await abrir(falso);
  assert.equal(resultado.ok, true);

  const sha = await resultado.arquivo.sha256();
  assert.equal(sha, createHash('sha256').update(CONTEUDO).digest('hex'));
  assert.deepEqual(await resultado.arquivo.ler(), CONTEUDO);
  assert.deepEqual(falso.aberturas, [ABS]);
  assert.equal(falso.fechados, 0);

  await resultado.arquivo.fechar();
  assert.equal(falso.fechados, 1);
});

test('dev/ino do handle diferente do lstat da varredura: recusa e fecha, sem ler nem resolver o caminho', async () => {
  const falso = criarFsFalso({ handleStat: { ino: 999n } });
  const resultado = await abrir(falso);
  assert.equal(resultado.ok, false);
  assert.equal(resultado.motivo, 'trocado');
  assert.equal(falso.fechados, 1);
  assert.equal(falso.leituras, 0);
  assert.equal(falso.realpaths, 0);

  const outroDispositivo = await abrir(criarFsFalso({ handleStat: { dev: 2n } }));
  assert.equal(outroDispositivo.motivo, 'trocado');
});

test('mesmo arquivo com tamanho ou data diferentes é "mudou", não ataque', async () => {
  const falso = criarFsFalso({ handleStat: { mtimeMs: 7000 } });
  const resultado = await abrir(falso);
  assert.equal(resultado.ok, false);
  assert.equal(resultado.motivo, 'mudou');
  assert.deepEqual(resultado.atual, { tamanho: CONTEUDO.length, mtimeMs: 7000 });
  assert.equal(falso.fechados, 1);

  const tamanho = await abrir(criarFsFalso({ handleStat: { size: 3 } }));
  assert.equal(tamanho.motivo, 'mudou');
});

test('caminho real fora da pasta do empreendimento é recusado', async () => {
  const outra = path.join(path.resolve('/'), 'servidor', 'outra', ...SEGMENTOS);
  const falso = criarFsFalso({ real: outra });
  const resultado = await abrir(falso);
  assert.equal(resultado.motivo, 'fora');
  assert.equal(falso.fechados, 1);

  const irmaoComPrefixo = path.join(`${BASE}2`, ...SEGMENTOS);
  assert.equal((await abrir(criarFsFalso({ real: irmaoComPrefixo }))).motivo, 'fora');
});

test('caminho real que passa por pasta bloqueada é recusado', async () => {
  const real = path.join(BASE, '03 - PRODUTOS', 'LAN', 'Comprovantes', 'planta.pdf');
  const arq = arqFalso({});
  const resultado = await abrir(criarFsFalso({ real }), arq);
  assert.equal(resultado.motivo, 'bloqueado');
});

test('caminho real dentro da pasta, mas diferente do varrido, é recusado', async () => {
  const real = path.join(BASE, '03 - PRODUTOS', 'OUTRA', 'planta.pdf');
  const resultado = await abrir(criarFsFalso({ real }));
  assert.equal(resultado.motivo, 'diferente');

  const mesmaCoisaOutraCaixa = path.join(BASE, '03 - produtos', 'lan', 'PLANTA.PDF');
  assert.equal((await abrir(criarFsFalso({ real: mesmaCoisaOutraCaixa }))).ok, true);
});

test('stat do caminho real com outro dev/ino que o handle: o caminho foi trocado na abertura', async () => {
  const falso = criarFsFalso({ realStat: { ino: 11n } });
  const resultado = await abrir(falso);
  assert.equal(resultado.ok, false);
  assert.equal(resultado.motivo, 'trocado');
  assert.equal(falso.fechados, 1);
});

test('conteúdo que não bate com o tamanho do fstat não é entregue', async () => {
  const cresceu = await abrir(criarFsFalso({ conteudo: Buffer.concat([CONTEUDO, Buffer.from('extra')]) }));
  assert.equal(cresceu.ok, true);
  assert.equal(await cresceu.arquivo.ler(), null);
  assert.equal(await cresceu.arquivo.sha256(), null);

  const encolheu = await abrir(criarFsFalso({ conteudo: CONTEUDO.subarray(0, 5) }));
  assert.equal(await encolheu.arquivo.ler(), null);
  assert.equal(await encolheu.arquivo.sha256(), null);
});

const PDF = (nome) => `${PASTA_EMP}/${PREFIXO_REGRA}/${nome}`;

async function observarEEnviarCom(a, fsSeguro) {
  await a.ciclo();
  a.relogio.avancar(MINUTO + 1000);
  return a.ciclo({ fsSeguro });
}

test('pasta trocada depois da varredura: o handle é de outro arquivo e nada é pedido nem enviado', () =>
  comAmbiente(async (a) => {
    escreverPdf(a.raiz, PDF('ok.pdf'), 'aprovado');
    const secreto = escreverPdf(path.join(a.tmp, 'fora'), 'secreto.pdf', 'conteudo externo');
    const trocado = { ...FS_REAL, open: () => fs.promises.open(secreto, 'r') };

    const resultado = await observarEEnviarCom(a, trocado);
    assert.equal(a.site.contar('POST', '/envios'), 0);
    assert.equal(a.site.puts.length, 0);
    assert.equal(resultado.erros.length, 1);
    assert.match(resultado.erros[0].mensagem, /trocado/);

    a.relogio.avancar(MINUTO + 1000);
    const depois = await a.ciclo();
    assert.equal(depois.contagens.enviados, 1);
    assert.equal([...a.site.objetos.values()][0].toString().includes('aprovado'), true);
  }));

test('caminho real fora da pasta, em pasta bloqueada, de outra pasta ou com outro ino: nada é enviado', () =>
  comAmbiente(async (a) => {
    escreverPdf(a.raiz, PDF('ok.pdf'), 'aprovado');
    const secreto = escreverPdf(path.join(a.tmp, 'fora'), 'secreto.pdf', 'conteudo externo');
    const baseReal = await FS_REAL.realpath(path.join(a.raiz, PASTA_EMP));
    const regra = PREFIXO_REGRA.split('/');
    const soPdf = (caminho) => caminho.endsWith('.pdf');

    const casos = [
      ['fora', { realpath: async (c) => (soPdf(c) ? secreto : FS_REAL.realpath(c)) }, /sai da pasta/],
      [
        'bloqueada',
        { realpath: async (c) => (soPdf(c) ? path.join(baseReal, ...regra, 'Comprovantes', 'ok.pdf') : FS_REAL.realpath(c)) },
        /bloqueada/,
      ],
      [
        'outra pasta',
        { realpath: async (c) => (soPdf(c) ? path.join(baseReal, '03 - PRODUTOS', 'OUTRA', 'ok.pdf') : FS_REAL.realpath(c)) },
        /não é o que a varredura percorreu/,
      ],
      [
        'outro ino',
        { stat: async (c) => (soPdf(c) ? fs.promises.stat(secreto, { bigint: true }) : FS_REAL.stat(c)) },
        /trocado enquanto/,
      ],
    ];

    await a.ciclo();
    for (const [nome, troca, padrao] of casos) {
      a.relogio.avancar(MINUTO + 1000);
      const resultado = await a.ciclo({ fsSeguro: { ...FS_REAL, ...troca } });
      assert.equal(a.site.contar('POST', '/envios'), 0, nome);
      assert.equal(a.site.puts.length, 0, nome);
      assert.match(resultado.erros.at(-1).mensagem, padrao, nome);
    }
  }));
