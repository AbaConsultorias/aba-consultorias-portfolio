import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { validarAutorizacao, validarCabecalhosDoPut } from '../src/api.mjs';
import {
  caminhoBloqueado,
  ehPdf,
  estaDentro,
  listaBloqueio,
  minimizarPrefixos,
  normalizarCaminhoRelativo,
  prefixoCasa,
  prefixoMaisLongo,
} from '../src/caminho.mjs';
import { chaveValida, urlPermitida, validarConfig } from '../src/config.mjs';
import { interpretarConfiguracao } from '../src/configuracao-site.mjs';
import { avaliarArquivo } from '../src/estabilidade.mjs';
import { LIMITES_PADRAO, criarOrcamento, limitarArvores } from '../src/limites.mjs';

const seg = (texto) => texto.split('/');

test('normalizarCaminhoRelativo aceita caminho comum e normaliza NFC e barras', () => {
  const resultado = normalizarCaminhoRelativo('03 - PRODUTOS\\LAN\\Ação.pdf'.normalize('NFD'));
  assert.equal(resultado.ok, true);
  assert.equal(resultado.texto, '03 - PRODUTOS/LAN/Ação.pdf'.normalize('NFC'));
});

test('normalizarCaminhoRelativo recusa .., ., vazio, absoluto e caracteres inválidos', () => {
  for (const ruim of ['', '../x', 'a/../b', 'a/./b', 'a//b', 'a/b/', '/a', 'C:/a', '\\\\servidor\\a', 'a/b:c', 'a/b*', 'a/b ']) {
    assert.equal(normalizarCaminhoRelativo(ruim).ok, false, ruim);
  }
  assert.equal(normalizarCaminhoRelativo(undefined).ok, false);
});

test('lista de bloqueio ignora caixa e acento e vale para qualquer segmento', () => {
  const lista = listaBloqueio();
  for (const bloqueado of [
    'a/Comprovantes/x.pdf',
    'a/COMPROVANTE DE RESIDÊNCIA.pdf',
    'dados do empreendedór/x.pdf',
    'DADOS DO EMPREENDEDOR',
    'a/notas fiscais/b.pdf',
    'planilha.pdf',
    'Planilhas/x.pdf',
    'a/Notas  Fiscais/b.pdf',
    'a/NOTAS-FISCAIS/b.pdf',
    'a/dados_do_empreendedor/b.pdf',
    'a/Ｃｏｍｐｒｏｖａｎｔｅ/b.pdf',
  ]) {
    assert.equal(caminhoBloqueado(seg(bloqueado), lista), true, bloqueado);
  }
  for (const livre of ['03 - PRODUTOS/LAN/PLANTA BAIXA.pdf', 'SAA/projeto.pdf', 'dados/empreendimento.pdf']) {
    assert.equal(caminhoBloqueado(seg(livre), lista), false, livre);
  }
});

test('a lista do site só acrescenta bloqueios, nunca tira os fixos', () => {
  const lista = listaBloqueio(['rascunho', 42, '']);
  assert.equal(caminhoBloqueado(seg('a/Rascunho/b.pdf'), lista), true);
  assert.equal(caminhoBloqueado(seg('a/PLANILHA/b.pdf'), lista), true);
});

test('ehPdf aceita qualquer caixa e recusa outras extensões', () => {
  assert.equal(ehPdf('a.pdf'), true);
  assert.equal(ehPdf('A.PDF'), true);
  assert.equal(ehPdf('a.Pdf'), true);
  assert.equal(ehPdf('a.pdf.exe'), false);
  assert.equal(ehPdf('a.dwg'), false);
  assert.equal(ehPdf('.pdf'), false);
});

test('prefixoCasa respeita fronteira de segmento e ignora caixa e forma Unicode', () => {
  assert.equal(prefixoCasa(seg('03 - PRODUTOS/LAN'), seg('03 - PRODUTOS/LAN/x.pdf')), true);
  assert.equal(prefixoCasa(seg('03 - PRODUTOS/LAN'), seg('03 - PRODUTOS/LANX/x.pdf')), false);
  assert.equal(prefixoCasa(seg('03 - produtos/lan'), seg('03 - PRODUTOS/LAN/x.pdf')), true);
  assert.equal(prefixoCasa(seg('Ação'.normalize('NFD')), seg('ação/x.pdf')), true);
  assert.equal(prefixoCasa(seg('a/b'), seg('a/b')), false);
  assert.equal(prefixoCasa([], seg('a/b.pdf')), false);
});

test('prefixoMaisLongo escolhe a regra mais específica', () => {
  const regras = [seg('a'), seg('a/b'), seg('a/c')];
  assert.deepEqual(prefixoMaisLongo(regras, seg('a/b/x.pdf')), seg('a/b'));
  assert.equal(prefixoMaisLongo(regras, seg('z/x.pdf')), null);
});

test('minimizarPrefixos remove os cobertos por outro mais curto', () => {
  const resultado = minimizarPrefixos([seg('a/b/c'), seg('A/B'), seg('x'), seg('a/b')]);
  assert.deepEqual(resultado, [seg('x'), seg('A/B')]);
});

test('estaDentro recusa a própria base, irmãos e caminhos que sobem', () => {
  const base = path.join(path.resolve('/'), 'raiz', 'emp');
  assert.equal(estaDentro(base, path.join(base, 'a', 'b.pdf')), true);
  assert.equal(estaDentro(base, base), false);
  assert.equal(estaDentro(base, path.join(base, '..', 'outra', 'x.pdf')), false);
  assert.equal(estaDentro(base, path.join(base, '..', 'emp2', 'x.pdf')), false);
  assert.equal(estaDentro(base, path.join(base, '..foo', 'x.pdf')), true);
});

test('avaliarArquivo: novo espera, estável envia, mudou reinicia, resultado definitivo ignora', () => {
  const atual = { tamanho: 10, mtimeMs: 1000 };
  const novo = avaliarArquivo(undefined, atual, 0);
  assert.equal(novo.acao, 'aguardar');
  assert.equal(novo.registro.observadoEm, 0);

  assert.equal(avaliarArquivo(novo.registro, atual, 59_999).acao, 'aguardar');
  assert.equal(avaliarArquivo(novo.registro, atual, 60_000).acao, 'enviar');

  const mudou = avaliarArquivo(novo.registro, { tamanho: 11, mtimeMs: 1000 }, 70_000);
  assert.equal(mudou.acao, 'aguardar');
  assert.equal(mudou.registro.observadoEm, 70_000);
  const mtimeMudou = avaliarArquivo(novo.registro, { tamanho: 10, mtimeMs: 2000 }, 70_000);
  assert.equal(mtimeMudou.acao, 'aguardar');

  for (const tipo of ['confirmado', 'ja_enviado', 'duplicado', 'recusado']) {
    const registro = { ...novo.registro, resultado: { tipo } };
    assert.equal(avaliarArquivo(registro, atual, 999_999).acao, 'ignorar', tipo);
  }
  const comErro = { ...novo.registro, resultado: { tipo: 'erro' } };
  assert.equal(avaliarArquivo(comErro, atual, 999_999).acao, 'enviar');

  const mudouComResultado = avaliarArquivo({ ...novo.registro, resultado: { tipo: 'recusado' } }, { tamanho: 99, mtimeMs: 1 }, 5);
  assert.equal(mudouComResultado.registro.resultado, undefined);
});

test('avaliarArquivo mantém o sha de uma versão anterior, marcado com a versão dele', () => {
  const registro = { tamanho: 10, mtimeMs: 1, observadoEm: 0, sha256: 'abc', shaTamanho: 10, shaMtimeMs: 1 };
  const mudou = avaliarArquivo(registro, { tamanho: 12, mtimeMs: 2 }, 100);
  assert.equal(mudou.registro.sha256, 'abc');
  assert.equal(mudou.registro.shaTamanho, 10);
});

test('orçamento: limite de arquivos, bytes, pedidos e tempo', () => {
  let agora = 0;
  const orcamento = criarOrcamento({ ...LIMITES_PADRAO, maxArquivos: 2, maxBytes: 100, maxPedidos: 5, duracaoMs: 1000 }, () => agora);
  assert.equal(orcamento.podePedir(60), true);
  orcamento.registrarEnvio(60);
  assert.equal(orcamento.podePedir(60), false);
  assert.equal(orcamento.podePedir(40), true);
  orcamento.registrarEnvio(40);
  assert.equal(orcamento.podePedir(1), false);

  const pedidos = criarOrcamento({ ...LIMITES_PADRAO, maxPedidos: 2 }, () => agora);
  pedidos.registrarPedido();
  pedidos.registrarPedido();
  assert.equal(pedidos.podePedir(1), false);

  const tempo = criarOrcamento({ ...LIMITES_PADRAO, duracaoMs: 1000 }, () => agora);
  agora = 999;
  assert.equal(tempo.tempoEsgotado(), false);
  agora = 1000;
  assert.equal(tempo.tempoEsgotado(), true);
  assert.equal(tempo.podePedir(1), false);
});

test('os limites padrão são os do contrato', () => {
  assert.equal(LIMITES_PADRAO.maxArquivos, 20);
  assert.equal(LIMITES_PADRAO.maxBytes, 500 * 1024 * 1024);
  assert.equal(LIMITES_PADRAO.duracaoMs, 8 * 60_000);
  assert.equal(LIMITES_PADRAO.niveisArvore, 5);
  assert.equal(LIMITES_PADRAO.maxPastasArvore, 5000);
});

test('limitarArvores corta o total entre empreendimentos', () => {
  const limitado = limitarArvores({ a: ['1', '2', '3'], b: ['4', '5'] }, 4);
  assert.deepEqual(limitado, { a: ['1', '2', '3'], b: ['4'] });
});

test('PUT: só os cabeçalhos esperados passam, e a URL tem de ser https', () => {
  assert.deepEqual(validarCabecalhosDoPut({ 'Content-Type': 'application/pdf', 'x-amz-checksum-sha256': 'abc=' }), {
    'content-type': 'application/pdf',
    'x-amz-checksum-sha256': 'abc=',
  });
  assert.equal(validarCabecalhosDoPut({ authorization: 'Bearer x' }), null);
  assert.equal(validarCabecalhosDoPut({ 'content-type': 'a\r\nx: y' }), null);

  const boa = { envio_id: 'abc-123', url: 'https://x.r2.cloudflarestorage.com/o?X-Amz-Signature=1', cabecalhos: { 'content-type': 'application/pdf' } };
  assert.ok(validarAutorizacao(boa));
  assert.equal(validarAutorizacao({ ...boa, url: 'http://evil.example/o' }), null);
  assert.equal(validarAutorizacao({ ...boa, url: 'file:///c:/x' }), null);
  assert.equal(validarAutorizacao({ ...boa, envio_id: '../x' }), null);
  assert.ok(validarAutorizacao({ ...boa, url: 'http://127.0.0.1:9/o' }));
});

test('configuração local: https obrigatório (http só em loopback) e chave com o formato certo', () => {
  assert.equal(urlPermitida('https://aba-consultorias.vercel.app'), true);
  assert.equal(urlPermitida('http://aba-consultorias.vercel.app'), false);
  assert.equal(urlPermitida('http://localhost:3000'), true);
  assert.equal(urlPermitida('ftp://x'), false);

  const raiz = path.resolve('/raiz');
  const boa = validarConfig({ urlSite: 'https://x.app/', raiz, pastaEstado: raiz, pastaLogs: raiz });
  assert.equal(boa.ok, true);
  assert.equal(boa.config.urlSite, 'https://x.app');
  assert.equal(validarConfig({ urlSite: 'http://x.app', raiz, pastaEstado: raiz, pastaLogs: raiz }).ok, false);
  assert.equal(validarConfig({ urlSite: 'https://x.app', raiz: 'relativo', pastaEstado: raiz, pastaLogs: raiz }).ok, false);

  assert.equal(chaveValida(`abacon_${'a'.repeat(43)}`), true);
  assert.equal(chaveValida(`abacon_${'a'.repeat(42)}`), false);
  assert.equal(chaveValida(undefined), false);
});

test('interpretarConfiguracao ignora regras inválidas ou bloqueadas e não passa de 100 MB', () => {
  const site = interpretarConfiguracao({
    limite_bytes: 999_999_999_999,
    bloqueio: ['RASCUNHO'],
    empreendimentos: [
      {
        codigo_pasta: '250101',
        regras: [
          { caminho_prefixo: '03 - PRODUTOS/LAN' },
          { caminho_prefixo: '../x' },
          { caminho_prefixo: '03/Comprovantes' },
          { caminho_prefixo: 'C:/Windows' },
        ],
      },
      { codigo_pasta: '../..', regras: [] },
    ],
  });
  assert.equal(site.limiteBytes, 104_857_600);
  assert.equal(site.empreendimentos.length, 1);
  assert.deepEqual(site.empreendimentos[0].prefixos, [['03 - PRODUTOS', 'LAN']]);
  assert.equal(site.problemas.length, 4);
  assert.equal(interpretarConfiguracao({ empreendimentos: 'x' }), null);
});
