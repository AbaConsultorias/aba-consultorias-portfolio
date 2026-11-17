import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  CHAVE_TESTE,
  MINUTO,
  PASTA_EMP,
  PREFIXO_REGRA,
  SEGREDO_DA_URL,
  alterarPdf,
  comAmbiente,
  escreverPdf,
  lerEstado,
  lerTodosOsLogs,
} from './ajuda.mjs';

const PDF = (nome) => `${PASTA_EMP}/${PREFIXO_REGRA}/${nome}`;

async function observarEEnviar(a) {
  await a.ciclo();
  a.relogio.avancar(MINUTO + 1000);
  return a.ciclo();
}

test('primeira carga respeita 20 arquivos por ciclo e se espalha por vários ciclos', () =>
  comAmbiente(async (a) => {
    for (let i = 0; i < 25; i += 1) escreverPdf(a.raiz, PDF(`doc-${i}.pdf`), `documento ${i}`);

    const primeiro = await a.ciclo();
    assert.equal(primeiro.contagens.aguardando_estabilidade, 25);
    assert.equal(a.site.contar('POST', '/envios'), 0);

    a.relogio.avancar(MINUTO + 1000);
    const segundo = await a.ciclo();
    assert.equal(segundo.contagens.enviados, 20);
    assert.equal(a.site.contar('POST', '/envios'), 20);

    a.relogio.avancar(MINUTO + 1000);
    const terceiro = await a.ciclo();
    assert.equal(terceiro.contagens.enviados, 5);
    assert.equal(terceiro.contagens.ja_enviados, 20);
    assert.equal(a.site.contar('POST', '/envios'), 25);
    assert.equal(a.site.objetos.size, 25);
  }));

test('o PUT leva só os cabeçalhos recebidos e nunca a chave do servidor', () =>
  comAmbiente(async (a) => {
    escreverPdf(a.raiz, PDF('a.pdf'));
    await observarEEnviar(a);

    assert.equal(a.site.puts.length, 1);
    const { cabecalhos } = a.site.puts[0];
    assert.equal(cabecalhos['content-type'], 'application/pdf');
    assert.ok(cabecalhos['x-amz-checksum-sha256']);
    assert.equal(cabecalhos.authorization, undefined);
    assert.equal(String(cabecalhos['user-agent'] ?? '').includes('ConectorABA'), false);
  }));

test('arquivo instável espera até ficar 60 s sem mudar', () =>
  comAmbiente(async (a) => {
    const abs = escreverPdf(a.raiz, PDF('copiando.pdf'), 'inicio');
    await a.ciclo();

    a.relogio.avancar(30_000);
    alterarPdf(abs, 'mais conteúdo sendo copiado', 200);
    const durante = await a.ciclo();
    assert.equal(durante.contagens.aguardando_estabilidade, 1);
    assert.equal(a.site.contar('POST', '/envios'), 0);

    a.relogio.avancar(MINUTO + 1000);
    const depois = await a.ciclo();
    assert.equal(depois.contagens.enviados, 1);
  }));

test('arquivo alterado depois de enviado vira um novo pedido', () =>
  comAmbiente(async (a) => {
    const abs = escreverPdf(a.raiz, PDF('planta.pdf'), 'versao 1');
    const primeira = await observarEEnviar(a);
    assert.equal(primeira.contagens.enviados, 1);

    alterarPdf(abs, 'versao 2 revisada', 300);
    a.relogio.avancar(MINUTO + 1000);
    const observando = await a.ciclo();
    assert.equal(observando.contagens.aguardando_estabilidade, 1);
    assert.equal(a.site.contar('POST', '/envios'), 1);

    a.relogio.avancar(MINUTO + 1000);
    const segunda = await a.ciclo();
    assert.equal(segunda.contagens.enviados, 1);
    assert.equal(a.site.contar('POST', '/envios'), 2);
    assert.equal(a.site.requisicoes.filter((r) => r.sub === '/envios')[1].json.caminho_relativo, `${PREFIXO_REGRA}/planta.pdf`);
  }));

test('arquivo apagado não gera nenhum pedido e sai do estado', () =>
  comAmbiente(async (a) => {
    const abs = escreverPdf(a.raiz, PDF('some.pdf'));
    await a.ciclo();
    fs.rmSync(abs);

    a.relogio.avancar(MINUTO + 1000);
    const depois = await a.ciclo();
    assert.equal(depois.contagens.examinados, 0);
    assert.equal(a.site.contar('POST', '/envios'), 0);
    assert.deepEqual(Object.keys(lerEstado(a.config).arquivos), []);
  }));

test('duas pastas com o mesmo código geram erro no status e nenhum envio', () =>
  comAmbiente(async (a) => {
    escreverPdf(a.raiz, PDF('a.pdf'));
    fs.mkdirSync(path.join(a.raiz, '250101 - OUTRA PASTA'));

    const resultado = await observarEEnviar(a);
    assert.equal(resultado.contagens.erros, 1);
    assert.equal(resultado.contagens.examinados, 0);
    assert.equal(a.site.contar('POST', '/envios'), 0);

    const status = a.site.statusRecebidos.at(-1);
    assert.equal(status.erros[0].codigo_pasta, '250101');
    assert.match(status.erros[0].mensagem, /250101/);
    assert.equal(status.arvore['250101'], undefined);
  }));

test('nenhuma pasta com o código gera erro no status e nenhum envio', () =>
  comAmbiente(async (a) => {
    escreverPdf(a.raiz, '999999 - OUTRO/x.pdf');

    const resultado = await observarEEnviar(a);
    assert.equal(resultado.contagens.erros, 1);
    assert.equal(a.site.contar('POST', '/envios'), 0);
    assert.equal(a.site.statusRecebidos.at(-1).erros[0].codigo_pasta, '250101');
  }));

test('a lista de bloqueio local impede a leitura, mesmo com regra mais ampla', () =>
  comAmbiente(async (a) => {
    a.site.empreendimentos = [
      {
        codigo_pasta: '250101',
        regras: [
          { id: 'r1', caminho_prefixo: '03 - PRODUTOS/LAN' },
          { id: 'r2', caminho_prefixo: '03 - PRODUTOS/LAN/Comprovantes' },
        ],
      },
    ];
    const lan = `${PASTA_EMP}/03 - PRODUTOS/LAN`;
    escreverPdf(a.raiz, `${lan}/ok.pdf`);
    escreverPdf(a.raiz, `${lan}/Comprovantes/pagamento.pdf`);
    escreverPdf(a.raiz, `${lan}/DADOS DO EMPREENDEDOR/rg.pdf`);
    escreverPdf(a.raiz, `${lan}/Dados do Empreendedór/rg2.pdf`);
    escreverPdf(a.raiz, `${lan}/Notas Fiscais/nf.pdf`);
    escreverPdf(a.raiz, `${lan}/planilha de custos.pdf`);

    const resultado = await observarEEnviar(a);
    assert.equal(resultado.contagens.examinados, 1);
    assert.equal(resultado.contagens.enviados, 1);
    assert.deepEqual(Object.keys(lerEstado(a.config).arquivos), [`250101/${'03 - PRODUTOS/LAN/ok.pdf'.toLowerCase()}`]);
    assert.ok(resultado.erros.some((e) => /Regra ignorada/.test(e.mensagem)));
    for (const pedido of a.site.requisicoes.filter((r) => r.sub === '/envios')) {
      assert.doesNotMatch(pedido.json.caminho_relativo, /comprovante|dados do|notas|planilha/i);
    }
  }));

test('link simbólico ou junção não é seguido', async (t) => {
  await comAmbiente(async (a) => {
    escreverPdf(a.raiz, PDF('ok.pdf'));
    const fora = path.join(a.tmp, 'fora');
    escreverPdf(fora, 'secreto.pdf');
    try {
      fs.symlinkSync(fora, path.join(a.raiz, ...PDF('atalho').split('/')), 'junction');
    } catch {
      t.skip('sem permissão para criar junção/link neste ambiente');
      return;
    }

    const resultado = await observarEEnviar(a);
    assert.equal(resultado.contagens.examinados, 1);
    assert.equal(resultado.contagens.enviados, 1);
    for (const pedido of a.site.requisicoes.filter((r) => r.sub === '/envios')) {
      assert.doesNotMatch(pedido.json.caminho_relativo, /secreto|atalho/);
    }
  });
});

test('regra cujo prefixo é uma junção não leva para fora da pasta', async (t) => {
  await comAmbiente(async (a) => {
    const fora = path.join(a.tmp, 'fora');
    escreverPdf(fora, 'secreto.pdf');
    fs.mkdirSync(path.join(a.raiz, PASTA_EMP, '03 - PRODUTOS'), { recursive: true });
    try {
      fs.symlinkSync(fora, path.join(a.raiz, PASTA_EMP, '03 - PRODUTOS', 'ATALHO'), 'junction');
    } catch {
      t.skip('sem permissão para criar junção/link neste ambiente');
      return;
    }
    a.site.empreendimentos = [{ codigo_pasta: '250101', regras: [{ id: 'r', caminho_prefixo: '03 - PRODUTOS/ATALHO' }] }];

    const resultado = await observarEEnviar(a);
    assert.equal(resultado.contagens.examinados, 0);
    assert.equal(a.site.contar('POST', '/envios'), 0);
  });
});

test('regra do site com .. não amplia a raiz', () =>
  comAmbiente(async (a) => {
    escreverPdf(a.raiz, PDF('ok.pdf'));
    escreverPdf(a.raiz, '999999 - VIZINHO/segredo.pdf');
    a.site.empreendimentos = [{ codigo_pasta: '250101', regras: [{ id: 'r', caminho_prefixo: '../999999 - VIZINHO' }] }];

    const resultado = await observarEEnviar(a);
    assert.equal(resultado.contagens.examinados, 0);
    assert.equal(a.site.contar('POST', '/envios'), 0);
    assert.ok(resultado.erros.some((e) => /Regra ignorada/.test(e.mensagem)));
  }));

test('429 para o ciclo, grava a pausa e não faz mais nenhum pedido até lá', () =>
  comAmbiente(async (a) => {
    for (let i = 0; i < 3; i += 1) escreverPdf(a.raiz, PDF(`d${i}.pdf`), `d${i}`);
    await a.ciclo();
    const statusAntes = a.site.statusRecebidos.length;

    a.site.interceptar = ({ sub }) =>
      sub === '/envios' ? { status: 429, corpo: { erro: 'limite', tentar_depois_s: 3600 } } : undefined;
    a.relogio.avancar(MINUTO + 1000);
    const limitado = await a.ciclo();
    assert.equal(limitado.codigoSaida, 0);
    assert.equal(a.site.contar('POST', '/envios'), 1);
    assert.equal(a.site.statusRecebidos.length, statusAntes);
    assert.ok(lerEstado(a.config).bloqueadoAte > a.relogio.agora());

    const antes = a.site.requisicoes.length;
    a.relogio.avancar(MINUTO + 1000);
    await a.ciclo();
    assert.equal(a.site.requisicoes.length, antes);

    a.site.interceptar = null;
    a.relogio.avancar(3600 * 1000);
    const retomado = await a.ciclo();
    assert.equal(retomado.contagens.enviados, 3);
  }));

test('404 por chave inválida para tudo logo no começo', () =>
  comAmbiente(async (a) => {
    escreverPdf(a.raiz, PDF('a.pdf'));
    const resultado = await a.ciclo({ chave: `abacon_${'B'.repeat(43)}` });
    assert.equal(resultado.codigoSaida, 3);
    assert.equal(a.site.requisicoes.length, 0);
    assert.equal(a.site.statusRecebidos.length, 0);
  }));

test('404 no meio do ciclo para tudo, sem status', () =>
  comAmbiente(async (a) => {
    for (let i = 0; i < 3; i += 1) escreverPdf(a.raiz, PDF(`d${i}.pdf`), `d${i}`);
    await a.ciclo();
    const statusAntes = a.site.statusRecebidos.length;

    a.site.interceptar = ({ sub }) => (sub === '/envios' ? { status: 404 } : undefined);
    a.relogio.avancar(MINUTO + 1000);
    const resultado = await a.ciclo();
    assert.equal(resultado.codigoSaida, 3);
    assert.equal(a.site.contar('POST', '/envios'), 1);
    assert.equal(a.site.statusRecebidos.length, statusAntes);
    assert.match(lerTodosOsLogs(a.config), /recusou a chave/);
  }));

test('recusado não é repetido até o arquivo mudar', () =>
  comAmbiente(async (a) => {
    const abs = escreverPdf(a.raiz, PDF('fora.pdf'), 'v1');
    a.site.interceptar = ({ sub }) =>
      sub === '/envios' ? { status: 200, corpo: { estado: 'recusado', motivo: 'fora de regra' } } : undefined;

    const primeira = await observarEEnviar(a);
    assert.equal(primeira.contagens.recusados, 1);
    assert.equal(a.site.contar('POST', '/envios'), 1);
    assert.equal(Object.values(lerEstado(a.config).arquivos)[0].resultado.motivo, 'fora de regra');

    a.relogio.avancar(MINUTO + 1000);
    const repetido = await a.ciclo();
    assert.equal(repetido.contagens.recusados, 1);
    assert.equal(a.site.contar('POST', '/envios'), 1);

    alterarPdf(abs, 'v2 corrigida', 400);
    await observarEEnviar(a);
    assert.equal(a.site.contar('POST', '/envios'), 2);
  }));

test('ja_enviado não é pedido de novo, nem depois de perder o estado', () =>
  comAmbiente(async (a) => {
    escreverPdf(a.raiz, PDF('a.pdf'));
    await observarEEnviar(a);
    assert.equal(a.site.contar('POST', '/envios'), 1);

    a.relogio.avancar(MINUTO + 1000);
    const conhecido = await a.ciclo();
    assert.equal(conhecido.contagens.ja_enviados, 1);
    assert.equal(a.site.contar('POST', '/envios'), 1);

    fs.rmSync(path.join(a.config.pastaEstado, 'estado.json'));
    a.relogio.avancar(MINUTO + 1000);
    await observarEEnviar(a);
    assert.equal(a.site.contar('POST', '/envios'), 2);
    assert.equal(a.site.puts.length, 1);

    a.relogio.avancar(MINUTO + 1000);
    const depois = await a.ciclo();
    assert.equal(depois.contagens.ja_enviados, 1);
    assert.equal(a.site.contar('POST', '/envios'), 2);
  }));

test('o mesmo conteúdo em outro caminho vira duplicado e não sobe de novo', () =>
  comAmbiente(async (a) => {
    escreverPdf(a.raiz, PDF('a.pdf'), 'igual');
    escreverPdf(a.raiz, PDF('b.pdf'), 'igual');

    const resultado = await observarEEnviar(a);
    assert.equal(resultado.contagens.enviados, 1);
    assert.equal(resultado.contagens.duplicados, 1);
    assert.equal(a.site.puts.length, 1);
  }));

test('falha 5xx no PUT fica para o próximo ciclo e não marca resultado', () =>
  comAmbiente(async (a) => {
    escreverPdf(a.raiz, PDF('a.pdf'));
    a.site.falharPut = 500;

    const falhou = await observarEEnviar(a);
    assert.equal(falhou.contagens.enviados, 0);
    assert.equal(falhou.contagens.erros, 1);
    assert.equal(Object.values(lerEstado(a.config).arquivos)[0].resultado, undefined);

    a.site.falharPut = null;
    a.relogio.avancar(MINUTO + 1000);
    const ok = await a.ciclo();
    assert.equal(ok.contagens.enviados, 1);
  }));

test('status leva contagens, erros e uma árvore só de pastas, limitada a 5 níveis', () =>
  comAmbiente(async (a) => {
    escreverPdf(a.raiz, PDF('a.pdf'));
    fs.mkdirSync(path.join(a.raiz, PASTA_EMP, '01', '02', '03', '04', '05', '06', '07'), { recursive: true });
    fs.mkdirSync(path.join(a.raiz, PASTA_EMP, 'DADOS DO EMPREENDEDOR', 'rg'), { recursive: true });
    fs.mkdirSync(path.join(a.raiz, PASTA_EMP, 'Comprovantes'), { recursive: true });

    await observarEEnviar(a);
    const status = a.site.statusRecebidos.at(-1);
    assert.deepEqual(Object.keys(status.contagens).sort(), [
      'aguardando_estabilidade',
      'duplicados',
      'enviados',
      'erros',
      'examinados',
      'ja_enviados',
      'recusados',
    ]);
    assert.equal(status.versao, '2.0.0');

    const pastas = status.arvore['250101'];
    assert.ok(pastas.includes('01/02/03/04/05'));
    assert.ok(pastas.includes(PREFIXO_REGRA));
    assert.ok(!pastas.includes('01/02/03/04/05/06'));
    assert.ok(pastas.every((p) => p.split('/').length <= 5));
    assert.ok(pastas.every((p) => !/dados do|comprovante/i.test(p)));
    assert.ok(pastas.every((p) => !p.endsWith('.pdf')));
    assert.equal(JSON.stringify(status).includes(JSON.stringify(a.raiz).slice(1, -1)), false);

    a.relogio.avancar(MINUTO + 1000);
    await a.ciclo({ limites: { maxPastasArvore: 3 } });
    const total = Object.values(a.site.statusRecebidos.at(-1).arvore).reduce((soma, lista) => soma + lista.length, 0);
    assert.equal(total, 3);
  }));

test('erros no status: no máximo 100, curtos e sem o caminho do servidor', () =>
  comAmbiente(async (a) => {
    a.site.empreendimentos = Array.from({ length: 120 }, (_, i) => ({
      codigo_pasta: String(300000 + i),
      regras: [{ id: `r${i}`, caminho_prefixo: 'x' }],
    }));

    const resultado = await a.ciclo();
    assert.equal(resultado.contagens.erros, 120);
    const status = a.site.statusRecebidos.at(-1);
    assert.equal(status.erros.length, 100);
    assert.ok(status.erros.every((e) => e.mensagem.length <= 500));
    assert.equal(JSON.stringify(status).includes(JSON.stringify(a.raiz).slice(1, -1)), false);
  }));

test('a chave e as URLs assinadas nunca aparecem no log', () =>
  comAmbiente(async (a) => {
    escreverPdf(a.raiz, PDF('boa.pdf'), 'boa');
    escreverPdf(a.raiz, PDF('ruim.pdf'), 'ruim');
    await a.ciclo();

    a.relogio.avancar(MINUTO + 1000);
    await a.ciclo({ limites: { maxArquivos: 1 } });
    a.site.falharPut = 500;
    a.relogio.avancar(MINUTO + 1000);
    await a.ciclo();
    a.log.erro(`teste de redação ${CHAVE_TESTE} ${a.site.url}/r2/x?X-Amz-Signature=${SEGREDO_DA_URL}`);

    const logs = lerTodosOsLogs(a.config);
    assert.match(logs, /Enviado/);
    assert.equal(logs.includes(CHAVE_TESTE), false);
    assert.equal(logs.includes(SEGREDO_DA_URL), false);
    assert.equal(logs.includes('http://'), false);
    assert.equal(logs.includes(a.raiz), false);
  }));

test('empreendimento sem regra não tem arquivo lido nem enviado, mas informa a árvore para as sugestões', () =>
  comAmbiente(async (a) => {
    a.site.empreendimentos = [{ codigo_pasta: '250101', regras: [] }];
    escreverPdf(a.raiz, PDF('a.pdf'));
    fs.mkdirSync(path.join(a.raiz, PASTA_EMP, 'DADOS DO EMPREENDEDOR'), { recursive: true });

    const resultado = await observarEEnviar(a);
    assert.equal(resultado.contagens.examinados, 0);
    assert.equal(resultado.contagens.erros, 0);
    assert.equal(a.site.contar('POST', '/envios'), 0);

    const pastas = a.site.statusRecebidos.at(-1).arvore['250101'];
    assert.ok(pastas.includes(PREFIXO_REGRA));
    assert.ok(pastas.every((p) => !/dados do/i.test(p)));
  }));
