import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import ts from "typescript";

// Testes puros da frente Andamento: regras, bytes reais de foto, consultas e confirmação de
// upload com dependências simuladas. Nada aqui chama o Supabase nem a rede.
const raiz = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const modulos = new Map();
const usuarioId = "11111111-1111-4111-8111-111111111111";
const empreendimentoId = "33333333-3333-4333-8333-333333333333";
const atualizacaoId = "44444444-4444-4444-8444-444444444444";
let sessaoAtual;
let adminAcessado = 0;

const substitutos = {
  "server-only": {},
  "@/lib/supabase/server": { createClient: async () => sessaoAtual },
  "@/lib/supabase/admin": { createAdminClient: () => { adminAcessado++; throw new Error("Client admin proibido neste teste."); } },
};

function carregar(caminho) {
  const arquivo = resolve(raiz, caminho);
  if (modulos.has(arquivo)) return modulos.get(arquivo).exports;
  const modulo = { exports: {} };
  modulos.set(arquivo, modulo);
  const codigo = ts.transpileModule(readFileSync(arquivo, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: arquivo,
  }).outputText;
  const importar = (nome) => {
    if (Object.hasOwn(substitutos, nome)) return substitutos[nome];
    if (nome.startsWith("@/")) return carregar(`src/${nome.slice(2)}.ts`);
    if (nome.startsWith(".")) return carregar(`${resolve(dirname(arquivo), nome)}.ts`);
    return require(nome);
  };
  runInThisContext(`(function(require, module, exports) {${codigo}\n})`, { filename: arquivo })(importar, modulo, modulo.exports);
  return modulo.exports;
}

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const etapa = (n, ordem, concluidaEm = null) => ({ id: uuid(n), nome: `Etapa ${n}`, ordem, concluidaEm });

// Arquivos mínimos, mas com a estrutura real de cada formato.
function jpeg(extra = 0) { return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xd9]), Buffer.alloc(extra, 7)]); }
function png() {
  const cabecalho = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  return Buffer.concat([cabecalho, Buffer.alloc(13), Buffer.alloc(4)]);
}
function webp(fourcc = "VP8 ") {
  const corpo = Buffer.concat([Buffer.from(`WEBP${fourcc}`, "ascii"), Buffer.alloc(8)]);
  const tamanho = Buffer.alloc(4); tamanho.writeUInt32LE(corpo.length);
  return Buffer.concat([Buffer.from("RIFF", "ascii"), tamanho, corpo]);
}
function ftyp(principal, ...compativeis) {
  const marcas = [principal, ...compativeis];
  const caixa = Buffer.alloc(16 + marcas.length * 4);
  caixa.writeUInt32BE(caixa.length, 0);
  caixa.write("ftyp", 4, "ascii");
  caixa.write(principal, 8, "ascii");
  marcas.forEach((marca, i) => caixa.write(marca, 16 + i * 4, "ascii"));
  return Buffer.concat([caixa, Buffer.alloc(8)]);
}
function fluxo(...partes) {
  return new ReadableStream({ start(controle) { for (const parte of partes) controle.enqueue(new Uint8Array(parte)); controle.close(); } });
}

const envAnterior = process.env.SUPABASE_SECRET_KEY;
const consoleAnterior = console.error;
const logs = [];
process.env.SUPABASE_SECRET_KEY = randomBytes(32).toString("hex");
console.error = (...args) => logs.push(args);

try {
  const { calcularProgresso, obterSituacaoEtapa, podeExibirAtualizacao, reordenarItens, montarArvoreProjetos, compararProjetos, ordenarProjetos, montarGruposProjetos, textoDependentes } = carregar("src/lib/portal/andamento/regras.ts");
  const { montarArvore: montarArvoreAdmin, idsDosIrmaos } = carregar("src/components/admin/portal/empreendimentos/arvore.ts");
  const { validarBytesFoto, lerFotoLimitada, FotoInvalida, LIMITE_FOTO } = carregar("src/lib/portal/andamento/fotos.ts");

  // --- Progresso: 0 / 1 / N etapas ---
  assert.equal(calcularProgresso([], null), 0, "sem etapas");
  assert.equal(calcularProgresso([etapa(1, 1)], null), 0, "uma etapa sem etapa atual");
  assert.equal(calcularProgresso([etapa(1, 1)], uuid(1)), 0, "uma etapa aberta");
  assert.equal(calcularProgresso([etapa(1, 1, "2026-10-01")], uuid(1)), 100, "uma etapa concluída");
  assert.equal(calcularProgresso([etapa(1, 1, "2026-10-01"), etapa(2, 2)], uuid(1)), 0, "conclusão não avança sozinha");
  const quatro = [etapa(1, 1), etapa(2, 2), etapa(3, 3), etapa(4, 4)];
  assert.deepEqual(quatro.map((e) => calcularProgresso(quatro, e.id)), [0, 33, 67, 100]);
  assert.equal(calcularProgresso([etapa(1, 1), etapa(2, 2)], uuid(2)), 100, "última etapa atual é 100 sem conclusão");
  assert.equal(calcularProgresso([etapa(1, 1), etapa(2, 2), etapa(3, 3)], uuid(2)), 50);
  const espacadas = [etapa(3, 300), etapa(1, 10), etapa(2, 20)];
  assert.equal(calcularProgresso(espacadas, uuid(2)), 50, "usa a posição, não o valor bruto de ordem");
  assert.equal(calcularProgresso(espacadas, uuid(3)), 100);
  assert.equal(calcularProgresso(quatro.map((e) => ({ ...e, concluidaEm: "2026-10-01" })), uuid(2)), 33, "não usa proporção de concluídas");
  assert.throws(() => calcularProgresso(quatro, uuid(99)), /não pertence/);
  assert.throws(() => calcularProgresso([], uuid(1)), /não pertence/);
  const antes = JSON.stringify(quatro);
  calcularProgresso([...quatro].reverse(), uuid(3));
  assert.equal(JSON.stringify(quatro), antes, "não muta a entrada");

  const situacoes = (etapas, atual) => etapas.map((e) => obterSituacaoEtapa(etapas, atual, e.id));
  assert.deepEqual(situacoes([], null), []);
  assert.deepEqual(situacoes(quatro, uuid(1)), ["atual", "futura", "futura", "futura"]);
  assert.deepEqual(situacoes(quatro, uuid(3)), ["concluida", "concluida", "atual", "futura"], "anteriores concluídas pela posição, sem data");
  assert.deepEqual(situacoes(quatro, uuid(4)), ["concluida", "concluida", "concluida", "concluida"], "última atual a 100% também concluída");
  assert.deepEqual(situacoes(espacadas, uuid(2)), ["futura", "concluida", "atual"], "ordena pelas posições sem depender da ordem da entrada ou dos intervalos");
  assert.deepEqual(situacoes(quatro, null), ["futura", "futura", "futura", "futura"]);
  assert.deepEqual(situacoes(quatro, uuid(99)), ["futura", "futura", "futura", "futura"], "referência atual ausente preserva a renderização");
  assert.equal(obterSituacaoEtapa([etapa(1, 10)], uuid(1), uuid(1)), "atual", "etapa única aberta continua atual a 0%");
  assert.equal(obterSituacaoEtapa([etapa(1, 10, "2026-10-01")], uuid(1), uuid(1)), "concluida");
  const comDatas = [etapa(1, 10), etapa(2, 20, "2026-10-01"), etapa(3, 30, "2026-10-02"), etapa(4, 40)];
  assert.deepEqual(situacoes(comDatas, uuid(2)), ["concluida", "concluida", "concluida", "futura"], "data conclui tanto a atual quanto uma posterior");
  assert.deepEqual(situacoes(comDatas, null), ["futura", "concluida", "concluida", "futura"], "conclusão explícita independe de etapa atual");
  assert.deepEqual(situacoes(comDatas, uuid(99)), ["futura", "concluida", "concluida", "futura"]);
  assert.throws(() => obterSituacaoEtapa(quatro, uuid(1), uuid(99)), /não pertence/);
  const imutaveis = Object.freeze(espacadas.map((e) => Object.freeze({ ...e })));
  const copiaEtapas = JSON.stringify(imutaveis);
  situacoes(imutaveis, uuid(2));
  assert.equal(JSON.stringify(imutaveis), copiaEtapas, "situação não muta a lista nem as etapas");

  // --- Árvore de projetos ("Depende de") ---
  const proj = (n, projetoPaiId = null) => ({ id: uuid(n), nome: `Projeto ${n}`, projetoPaiId });
  const resumo = (nos) => nos.map((no) => [no.projeto.id, no.nivel, no.pai?.id ?? null]);
  assert.deepEqual(montarArvoreProjetos([]), []);
  assert.deepEqual(resumo(montarArvoreProjetos([proj(1), proj(2)])), [[uuid(1), 0, null], [uuid(2), 0, null]], "sem dependências: ordem de entrada");
  assert.deepEqual(resumo(montarArvoreProjetos([proj(1), proj(2, uuid(1)), proj(3), proj(4, uuid(3)), proj(5, uuid(1))])), [
    [uuid(1), 0, null], [uuid(2), 1, uuid(1)], [uuid(5), 1, uuid(1)], [uuid(3), 0, null], [uuid(4), 1, uuid(3)],
  ], "dependentes logo após o pai, mesmo vindo antes na entrada");
  assert.deepEqual(resumo(montarArvoreProjetos([proj(3, uuid(2)), proj(2, uuid(1)), proj(1)])), [
    [uuid(1), 0, null], [uuid(2), 1, uuid(1)], [uuid(3), 2, uuid(2)],
  ], "cadeia de três níveis");
  assert.deepEqual(resumo(montarArvoreProjetos([proj(2, uuid(99)), proj(1)])), [[uuid(2), 0, null], [uuid(1), 0, null]], "pai ausente vira raiz sem rótulo de pai");
  assert.deepEqual(resumo(montarArvoreProjetos([proj(1, uuid(1))])), [[uuid(1), 0, null]], "auto-referência vira raiz");
  const ciclo = montarArvoreProjetos([proj(1, uuid(2)), proj(2, uuid(1)), proj(3, uuid(2))]);
  assert.deepEqual(ciclo.map((no) => no.projeto.id).sort(), [uuid(1), uuid(2), uuid(3)], "ciclo: cada projeto aparece uma vez e nada trava");
  assert.equal(ciclo.length, 3);
  const entradaArvore = Object.freeze([Object.freeze(proj(2, uuid(1))), Object.freeze(proj(1))]);
  montarArvoreProjetos(entradaArvore);

  // --- Ordem dos projetos: ordem, depois nome, depois id; só compara irmãos ---
  const po = (n, ordem, projetoPaiId = null, nome = `Projeto ${n}`) => ({ id: uuid(n), nome, ordem, projetoPaiId });
  assert.deepEqual(ordenarProjetos([po(1, 2), po(2, 0), po(3, 1), po(4, 1, null, "Aaa")]).map((p) => p.id), [uuid(2), uuid(4), uuid(3), uuid(1)], "ordem, depois nome");
  assert.deepEqual(ordenarProjetos([po(6, 0, null, "Igual"), po(5, 0, null, "Igual")]).map((p) => p.id), [uuid(5), uuid(6)], "empate de ordem e nome desempata pelo id");
  assert.deepEqual(ordenarProjetos([{ id: uuid(2), nome: "Zeta" }, { id: uuid(1), nome: "Água" }]).map((p) => p.id), [uuid(1), uuid(2)], "sem ordem vale 0 e sobra o nome");
  assert.ok(compararProjetos(po(1, 0), po(2, 1)) < 0 && compararProjetos(po(2, 1), po(1, 0)) > 0 && compararProjetos(po(1, 3), po(1, 3)) === 0);
  const congelados = Object.freeze([Object.freeze(po(2, 1)), Object.freeze(po(1, 0))]);
  assert.deepEqual(ordenarProjetos(congelados).map((p) => p.id), [uuid(1), uuid(2)]);
  assert.equal(congelados[0].id, uuid(2), "ordenarProjetos não muta a entrada");

  // Árvore do admin: raízes e dependentes de cada pai na ordem da equipe, não na alfabética.
  const linha = (p, irmaos = []) => ({ ...p, irmaos, nomePaiForaDaPagina: null, modeloNome: null, etapaNome: null, temEtapaAtual: false, documentos: undefined });
  const desordenados = [po(1, 2), po(2, 0), po(3, 1), po(4, 1, uuid(1)), po(5, 0, uuid(1)), po(6, 0, uuid(2))].map((p) => linha(p));
  const arvoreAdmin = montarArvoreAdmin(desordenados);
  assert.deepEqual(arvoreAdmin.map((no) => no.projeto.id), [uuid(2), uuid(3), uuid(1)], "raízes por ordem");
  assert.deepEqual(arvoreAdmin[2].filhos.map((no) => no.projeto.id), [uuid(5), uuid(4)], "dependentes por ordem");
  assert.deepEqual(arvoreAdmin[0].filhos.map((no) => no.projeto.id), [uuid(6)]);
  assert.deepEqual(montarArvoreAdmin([linha(po(2, 0, uuid(99)))]).map((no) => no.projeto.id), [uuid(2)], "pai fora da página vira raiz");
  const irmaos = idsDosIrmaos([po(1, 2), po(2, 0), po(3, 1), po(4, 1, uuid(1)), po(5, 0, uuid(1))]);
  assert.deepEqual(irmaos.get(null), [uuid(2), uuid(3), uuid(1)]);
  assert.deepEqual(irmaos.get(uuid(1)), [uuid(5), uuid(4)]);
  assert.equal(irmaos.get(uuid(2)), undefined, "quem não tem dependentes não tem grupo");

  // Portal do cliente: grupos recolhíveis só para quem tem dependentes; a contagem é de todos os descendentes.
  const resumoGrupos = (grupos) => grupos.map((g) => [g.projeto.id, g.nivel, g.pai?.id ?? null, g.dependentes.length, g.totalDependentes]);
  assert.deepEqual(montarGruposProjetos([]), []);
  assert.deepEqual(resumoGrupos(montarGruposProjetos(ordenarProjetos([po(1, 1), po(2, 0)]))), [[uuid(2), 0, null, 0, 0], [uuid(1), 0, null, 0, 0]], "sem dependentes: nada recolhível");
  const grupos = montarGruposProjetos(ordenarProjetos([po(1, 1), po(2, 0), po(3, 1, uuid(1)), po(4, 0, uuid(1)), po(5, 0, uuid(4)), po(6, 1, uuid(4))]));
  assert.deepEqual(resumoGrupos(grupos), [[uuid(2), 0, null, 0, 0], [uuid(1), 0, null, 2, 4]], "o pai conta os dois dependentes diretos e os dois netos");
  assert.deepEqual(resumoGrupos(grupos[1].dependentes), [[uuid(4), 1, uuid(1), 2, 2], [uuid(3), 1, uuid(1), 0, 0]], "dependentes na ordem da equipe");
  assert.deepEqual(resumoGrupos(grupos[1].dependentes[0].dependentes), [[uuid(5), 2, uuid(4), 0, 0], [uuid(6), 2, uuid(4), 0, 0]]);
  assert.equal(grupos[1].projeto.id, uuid(1));
  assert.equal(grupos[1].pai, null);
  assert.equal(grupos[1].dependentes[0].pai.id, uuid(1), "o rótulo Depende de continua disponível");
  const cicloGrupos = montarGruposProjetos([po(1, 0, uuid(2)), po(2, 0, uuid(1))]);
  assert.equal(cicloGrupos.reduce((total, g) => total + 1 + g.totalDependentes, 0), 2, "ciclo: cada projeto aparece uma vez");
  assert.equal(textoDependentes(1), "1 projeto dependente");
  assert.equal(textoDependentes(3), "3 projetos dependentes");

  // --- Publicação e reordenação ---
  assert.equal(podeExibirAtualizacao(true), true);
  assert.equal(podeExibirAtualizacao(false), false);
  const lista = [{ id: "a", nome: "A", ordem: 0 }, { id: "b", nome: "B", ordem: 1 }, { id: "c", nome: "C", ordem: 2 }];
  assert.deepEqual(reordenarItens(lista, 2, -1).map((i) => i.id), ["a", "c", "b"]);
  assert.deepEqual(reordenarItens(lista, 2, -1).map((i) => i.ordem), [0, 1, 2], "ordem renumerada sem lacunas");
  assert.deepEqual(reordenarItens(lista, 0, -1), lista, "limite superior não muda nada");
  assert.deepEqual(reordenarItens(lista, 2, 1), lista, "limite inferior não muda nada");
  assert.deepEqual(reordenarItens([{ id: "x", nome: "X", ordem: 9 }, { id: "y", nome: "Y", ordem: 2 }], 1, 1).map((i) => i.id), ["y", "x"]);
  assert.equal(lista[0].id, "a", "reordenar não muta a entrada");

  // --- Bytes reais das fotos ---
  assert.equal(validarBytesFoto(jpeg(), "image/jpeg"), true);
  assert.equal(validarBytesFoto(Buffer.concat([jpeg(), Buffer.from("MOTION")]), "image/jpeg"), true, "dados após o EOI");
  assert.equal(validarBytesFoto(jpeg().subarray(0, 8), "image/jpeg"), false, "JPEG truncado sem EOI");
  assert.equal(validarBytesFoto(Buffer.from("GIF89a....."), "image/jpeg"), false);
  assert.equal(validarBytesFoto(png(), "image/png"), true);
  assert.equal(validarBytesFoto(png().subarray(0, 20), "image/png"), false, "PNG truncado");
  assert.equal(validarBytesFoto(jpeg(), "image/png"), false, "JPEG declarado como PNG");
  assert.equal(validarBytesFoto(png(), "image/jpeg"), false, "PNG declarado como JPEG");
  for (const fourcc of ["VP8 ", "VP8L", "VP8X"]) assert.equal(validarBytesFoto(webp(fourcc), "image/webp"), true, fourcc);
  assert.equal(validarBytesFoto(webp("XXXX"), "image/webp"), false);
  assert.equal(validarBytesFoto(Buffer.concat([webp(), Buffer.from("x")]), "image/webp"), false, "tamanho RIFF diferente do arquivo");
  assert.equal(validarBytesFoto(ftyp("heic", "mif1"), "image/heic"), true);
  assert.equal(validarBytesFoto(ftyp("mif1", "heic"), "image/heif"), true);
  assert.equal(validarBytesFoto(ftyp("isom", "iso2", "mp41"), "image/heic"), false, "MP4 comum não é HEIC");
  assert.equal(validarBytesFoto(ftyp("isom", "iso2", "mp41"), "image/heif"), false, "MP4 comum não é HEIF");
  assert.equal(validarBytesFoto(ftyp("mif1", "mif1"), "image/heif"), false, "HEIF exige marca de imagem compatível");
  assert.equal(validarBytesFoto(ftyp("heic", "mif1").subarray(0, 12), "image/heic"), false, "HEIC truncado");
  assert.equal(validarBytesFoto(Buffer.alloc(0), "image/jpeg"), false);

  // --- Leitura limitada em stream ---
  const jp = jpeg(100);
  assert.equal((await lerFotoLimitada(fluxo(jp.subarray(0, 40), jp.subarray(40)), jp.length)).length, jp.length);
  await assert.rejects(lerFotoLimitada(fluxo(jp), jp.length - 1), FotoInvalida, "mais bytes que o assinado");
  await assert.rejects(lerFotoLimitada(fluxo(jp.subarray(0, 10)), jp.length), FotoInvalida, "menos bytes que o assinado");
  await assert.rejects(lerFotoLimitada(fluxo(), 1), FotoInvalida, "objeto vazio");
  await assert.rejects(lerFotoLimitada(fluxo(Buffer.alloc(LIMITE_FOTO + 1)), LIMITE_FOTO + 1), FotoInvalida, "acima de 10 MiB");

  // --- Consultas do cliente (sessão simulada) ---
  function sessaoConsulta(tabelas) {
    const consultadas = [];
    return {
      consultadas,
      from(tabela) {
        const filtros = [];
        const ordens = [];
        let faixa = null;
        const q = {
          select() { return q; },
          eq(coluna, valor) { filtros.push([coluna, (v) => v === valor]); return q; },
          in(coluna, valores) { filtros.push([coluna, (v) => valores.includes(v)]); return q; },
          order(coluna, opcoes) { ordens.push([coluna, opcoes?.ascending !== false]); return q; },
          range(de, ate) { faixa = [de, ate]; return q; },
          then(ok, falha) {
            consultadas.push([tabela, filtros.map(([c]) => c)]);
            let linhas = (tabelas[tabela] ?? []).filter((l) => filtros.every(([c, testa]) => testa(l[c])));
            linhas = [...linhas].sort((a, b) => {
              for (const [coluna, crescente] of ordens) {
                if (a[coluna] === b[coluna] || a[coluna] === undefined || b[coluna] === undefined) continue;
                return (a[coluna] < b[coluna] ? -1 : 1) * (crescente ? 1 : -1);
              }
              return 0;
            });
            if (faixa) linhas = linhas.slice(faixa[0], faixa[1] + 1);
            return Promise.resolve({ data: linhas, error: null }).then(ok, falha);
          },
        };
        return q;
      },
    };
  }
  const { listarProjetos, listarAtualizacoes, listarObras } = carregar("src/lib/portal/andamento/consultas.ts");
  const projetoId = uuid(500);
  sessaoAtual = sessaoConsulta({
    projetos: [{ id: projetoId, nome: "Regularização", etapa_atual_id: uuid(2), projeto_pai_id: uuid(501), ordem: 4, empreendimento_id: empreendimentoId }],
    projeto_etapas: [1, 2, 3].map((n) => ({ id: uuid(n), nome: `Etapa ${n}`, ordem: n * 10, concluida_em: null, projeto_id: projetoId })),
  });
  const projetos = await listarProjetos(empreendimentoId);
  assert.equal(projetos.length, 1);
  assert.equal(projetos[0].progresso, 50);
  assert.equal(projetos[0].projetoPaiId, uuid(501), "expõe o projeto do qual depende");
  assert.equal(projetos[0].ordem, 4, "expõe a ordem definida pela equipe");

  // O cliente recebe os projetos na ordem da equipe (depois nome e id), não na alfabética.
  sessaoAtual = sessaoConsulta({
    projetos: [
      { id: uuid(601), nome: "Alfa", etapa_atual_id: null, projeto_pai_id: null, ordem: 2, empreendimento_id: empreendimentoId },
      { id: uuid(602), nome: "Zeta", etapa_atual_id: null, projeto_pai_id: null, ordem: 0, empreendimento_id: empreendimentoId },
      { id: uuid(603), nome: "Beta", etapa_atual_id: null, projeto_pai_id: null, ordem: 2, empreendimento_id: empreendimentoId },
      { id: uuid(604), nome: "Outro empreendimento", etapa_atual_id: null, projeto_pai_id: null, ordem: 0, empreendimento_id: uuid(999) },
    ],
  });
  assert.deepEqual((await listarProjetos(empreendimentoId)).map((p) => p.nome), ["Zeta", "Alfa", "Beta"], "ordem primeiro, nome no empate");
  assert.deepEqual(Object.keys(projetos[0].etapas[0]).sort(), ["concluidaEm", "id", "nome", "ordem"]);

  // Etapa atual fora da lista (leituras não atômicas): a página não cai e o progresso fica em 0.
  const consoleOriginal = console.error;
  console.error = () => {};
  try {
    sessaoAtual = sessaoConsulta({
      projetos: [{ id: projetoId, nome: "Regularização", etapa_atual_id: uuid(99), projeto_pai_id: null, ordem: 0, empreendimento_id: empreendimentoId }],
      projeto_etapas: [1, 2, 3].map((n) => ({ id: uuid(n), nome: `Etapa ${n}`, ordem: n * 10, concluida_em: null, projeto_id: projetoId })),
    });
    const inconsistentes = await listarProjetos(empreendimentoId);
    assert.equal(inconsistentes.length, 1);
    assert.equal(inconsistentes[0].progresso, 0);
  } finally {
    console.error = consoleOriginal;
  }

  const atualizacoes = Array.from({ length: 51 }, (_, i) => ({
    id: uuid(1000 + i), titulo: `Visita ${i}`, texto: null, data_visita: "2026-10-20", publicado: true, empreendimento_id: empreendimentoId,
  }));
  sessaoAtual = sessaoConsulta({
    atualizacoes: [...atualizacoes, { id: uuid(2000), titulo: "Rascunho", texto: null, data_visita: null, publicado: false, empreendimento_id: empreendimentoId }],
    atualizacao_fotos: [{ id: uuid(3000), mime: "image/jpeg", ordem: 0, atualizacao_id: uuid(1000), storage_path: "atualizacoes/segredo/x.jpg" }],
  });
  const sessaoPagina1 = sessaoAtual;
  const pagina1 = await listarAtualizacoes(empreendimentoId);
  assert.equal(sessaoPagina1.consultadas.filter(([tabela]) => tabela === "atualizacao_fotos").length, 1, "fotos da página numa consulta só");
  assert.equal(pagina1.registros.length, 50);
  assert.equal(pagina1.proximaPagina, 2);
  assert.ok(pagina1.registros.every((a) => a.titulo !== "Rascunho"), "rascunho nunca aparece ao cliente");
  assert.deepEqual(pagina1.registros[0].fotos, [{ id: uuid(3000), mime: "image/jpeg", urlDaRota: `/api/portal/atualizacao-fotos/${uuid(3000)}` }]);
  assert.ok(!JSON.stringify(pagina1).includes("segredo"), "DTO não vaza storage_path");
  const pagina2 = await listarAtualizacoes(empreendimentoId, { pagina: 2 });
  assert.equal(pagina2.registros.length, 1);
  assert.equal(pagina2.proximaPagina, null);
  await assert.rejects(listarAtualizacoes(empreendimentoId, { limite: 101 }), "limite acima de 100");

  const obraId = uuid(700);
  sessaoAtual = sessaoConsulta({
    obras: [{ id: obraId, nome: "Casa 1", percentual: 40, situacao: "em_andamento", empreendimento_id: empreendimentoId }],
    relatos_obra: [
      { id: uuid(710), obra_id: obraId, texto: "Aprovado", criado_em: "2026-10-20T10:00:00Z", status: "aprovado" },
      { id: uuid(711), obra_id: obraId, texto: "Pendente", criado_em: "2026-10-21T10:00:00Z", status: "pendente" },
      { id: uuid(712), obra_id: obraId, texto: "Devolvido", criado_em: "2026-10-22T10:00:00Z", status: "devolvido" },
    ],
    relato_fotos: [{ id: uuid(720), mime: "image/png", relato_id: uuid(710), storage_path: "relatos/x" }],
  });
  const { obras, relatos } = await listarObras(empreendimentoId);
  assert.deepEqual(relatos.registros.map((r) => r.texto), ["Aprovado"], "só relatos aprovados");
  assert.equal(relatos.registros[0].obraNome, "Casa 1");
  assert.equal(relatos.registros[0].fotos[0].urlDaRota, `/api/portal/relato-fotos/${uuid(720)}`);
  assert.equal(obras[0].percentual, 40);
  assert.ok(!("relatos" in obras[0]), "a obra não carrega os relatos");

  // Relatos do mais novo ao mais antigo, 10 por página, com uma única consulta de fotos por página.
  const aprovados = Array.from({ length: 11 }, (_, i) => ({
    id: uuid(800 + i), obra_id: obraId, texto: `Relato ${i}`, criado_em: `2026-10-${String(10 + i).padStart(2, "0")}T10:00:00Z`, status: "aprovado",
  }));
  const sessaoRelatos = sessaoConsulta({
    obras: [{ id: obraId, nome: "Casa 1", percentual: 40, situacao: "em_andamento", empreendimento_id: empreendimentoId }],
    relatos_obra: aprovados,
    relato_fotos: [uuid(800), uuid(805), uuid(810)].map((relato_id, i) => ({ id: uuid(900 + i), mime: "image/png", relato_id, storage_path: "relatos/y" })),
  });
  sessaoAtual = sessaoRelatos;
  const primeira = await listarObras(empreendimentoId);
  assert.deepEqual(primeira.relatos.registros.map((r) => r.texto), aprovados.slice(1).reverse().map((r) => r.texto), "mais novo primeiro");
  assert.equal(primeira.relatos.proximaPagina, 2);
  assert.equal(sessaoRelatos.consultadas.filter(([tabela]) => tabela === "relato_fotos").length, 1, "fotos da página numa consulta só");
  assert.deepEqual(primeira.relatos.registros.filter((r) => r.fotos.length).map((r) => r.texto), ["Relato 10", "Relato 5"]);
  const segunda = await listarObras(empreendimentoId, { pagina: 2 });
  assert.deepEqual(segunda.relatos.registros.map((r) => r.texto), ["Relato 0"]);
  assert.equal(segunda.relatos.proximaPagina, null);
  assert.equal(segunda.relatos.registros[0].fotos.length, 1);

  sessaoAtual = sessaoConsulta({});
  const semObras = await listarObras(empreendimentoId);
  assert.deepEqual(semObras, { obras: [], relatos: { registros: [], proximaPagina: null } });

  // --- Upload de fotos: assinar e confirmar ---
  const { assinar, confirmar } = carregar("src/app/api/(modules)/adm-interno/portal/atualizacao-fotos/upload/service.ts");
  const { validarComprovante } = carregar("src/lib/portal/comum/upload.ts");
  const { BadRequestError, ConflictError, InternalServerError, NotFoundError } = carregar("src/app/api/HttpErrors.ts");
  const paiFake = { id: atualizacaoId, empreendimento_id: empreendimentoId, empreendimentos: { id: empreendimentoId } };
  function sessaoUpload({ pai = paiFake, fotos = [], falhaInsert = null } = {}) {
    const inseridos = [];
    return {
      inseridos,
      from(tabela) {
        if (tabela === "atualizacoes") return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: pai, error: null }; } };
        assert.equal(tabela, "atualizacao_fotos");
        return {
          select() { return this; },
          or() { return Promise.resolve({ data: [...fotos, ...inseridos], error: null }); },
          async insert(registro) {
            if (falhaInsert) return { error: falhaInsert };
            inseridos.push(registro);
            return { error: null };
          },
        };
      },
    };
  }
  function dependencias(sessao, objeto, excluidos = []) {
    const apagados = [];
    const assinados = [];
    return {
      apagados, assinados,
      registroExcluido: async (id) => excluidos.includes(id),
      sessao: async () => sessao,
      assinar: async (path) => { assinados.push(path); return { path, signedUrl: "https://storage.invalid/envio", token: "token-simulado" }; },
      lerObjeto: async () => ({ mime: objeto.mime, stream: fluxo(objeto.bytes) }),
      apagar: async (path) => { apagados.push(path); },
    };
  }

  const entradaAssinar = { atualizacaoId, mime: "image/jpeg", tamanho: jpeg().length, ordem: 2 };
  const sessaoA = sessaoUpload();
  const depsA = dependencias(sessaoA, { mime: "image/jpeg", bytes: jpeg() });
  const assinatura = await assinar(entradaAssinar, usuarioId, depsA);
  assert.match(assinatura.path, new RegExp(`^atualizacoes/${empreendimentoId}/${atualizacaoId}/[0-9a-f-]{36}\\.jpg$`));
  assert.deepEqual(depsA.assinados, [assinatura.path], "URL assinada para o path gerado pelo servidor");
  assert.equal(assinatura.signedUrl, "https://storage.invalid/envio");
  const comprovante = validarComprovante(assinatura.comprovante, usuarioId);
  assert.equal(comprovante.path, assinatura.path);
  assert.equal(comprovante.bucket, "obras");
  assert.equal(comprovante.metadados.ordem, 2);
  assert.throws(() => validarComprovante(assinatura.comprovante, uuid(9)), BadRequestError, "comprovante de outro usuário");
  await assert.rejects(assinar(entradaAssinar, usuarioId, dependencias(sessaoUpload({ pai: null }), { mime: "image/jpeg", bytes: jpeg() })), NotFoundError, "atualização inacessível");

  const confirmado = await confirmar({ comprovante: assinatura.comprovante }, usuarioId, depsA);
  assert.equal(confirmado.id, comprovante.registroId);
  assert.deepEqual(sessaoA.inseridos, [{
    id: comprovante.registroId, atualizacao_id: atualizacaoId, storage_path: comprovante.path,
    mime: "image/jpeg", tamanho: comprovante.tamanho, ordem: 2,
  }], "linha só com dados do comprovante e bytes conferidos, pela sessão");
  assert.equal(adminAcessado, 0, "a confirmação grava com a sessão, nunca com o client admin");
  assert.equal((await confirmar({ comprovante: assinatura.comprovante }, usuarioId, depsA)).id, confirmado.id, "replay devolve o mesmo id");
  assert.equal(sessaoA.inseridos.length, 1, "replay não duplica");
  assert.deepEqual(depsA.apagados, [], "replay não apaga objeto referenciado");

  // Replay com id já ligado a outro registro: conflito sem apagar o objeto.
  const conflito = dependencias(sessaoUpload({ fotos: [{ id: comprovante.registroId, atualizacao_id: atualizacaoId, storage_path: "atualizacoes/outro.jpg", mime: "image/jpeg", tamanho: 1, ordem: 0 }] }), { mime: "image/jpeg", bytes: jpeg() });
  await assert.rejects(confirmar({ comprovante: assinatura.comprovante }, usuarioId, conflito), ConflictError);
  assert.deepEqual(conflito.apagados, []);

  // Foto já excluída: o comprovante ainda vale, mas o id consumido não ressuscita e o objeto reenviado é descartado.
  const sessaoExcluida = sessaoUpload();
  const depsExcluida = dependencias(sessaoExcluida, { mime: "image/jpeg", bytes: jpeg() }, [comprovante.registroId]);
  await assert.rejects(confirmar({ comprovante: assinatura.comprovante }, usuarioId, depsExcluida), BadRequestError, "id de foto excluída");
  assert.equal(sessaoExcluida.inseridos.length, 0);
  assert.deepEqual(depsExcluida.apagados, [comprovante.path]);

  // Conteúdo que não bate com o formato: rejeita e apaga o objeto ainda não referenciado.
  async function assinarPara(mime, bytes) {
    const resposta = await assinar({ atualizacaoId, mime, tamanho: bytes.length, ordem: 0 }, usuarioId, dependencias(sessaoUpload(), { mime, bytes }));
    return resposta.comprovante;
  }
  for (const [rotulo, mime, bytes, mimeRecebido] of [
    ["PNG enviado como JPEG", "image/jpeg", png(), "image/jpeg"],
    ["JPEG truncado", "image/jpeg", jpeg().subarray(0, 8), "image/jpeg"],
    ["MP4 enviado como HEIC", "image/heic", ftyp("isom", "iso2"), "image/heic"],
    ["tipo do objeto diferente do assinado", "image/jpeg", jpeg(), "image/png"],
  ]) {
    const sessao = sessaoUpload();
    const deps = dependencias(sessao, { mime: mimeRecebido, bytes });
    await assert.rejects(confirmar({ comprovante: await assinarPara(mime, bytes) }, usuarioId, deps), BadRequestError, rotulo);
    assert.equal(sessao.inseridos.length, 0, `${rotulo}: não grava linha`);
    assert.equal(deps.apagados.length, 1, `${rotulo}: apaga o objeto não referenciado`);
  }

  // Tamanho real diferente do assinado.
  {
    const maior = Buffer.concat([jpeg(), Buffer.alloc(5)]);
    const comprovanteCurto = await assinarPara("image/jpeg", jpeg());
    const deps = dependencias(sessaoUpload(), { mime: "image/jpeg", bytes: maior });
    await assert.rejects(confirmar({ comprovante: comprovanteCurto }, usuarioId, deps), BadRequestError);
    assert.equal(deps.apagados.length, 1);
  }

  // Falha transitória de banco: permite repetir a confirmação sem apagar nada.
  {
    const token = await assinarPara("image/jpeg", jpeg());
    const falha = sessaoUpload({ falhaInsert: { code: "08006", status: 503 } });
    const depsFalha = dependencias(falha, { mime: "image/jpeg", bytes: jpeg() });
    await assert.rejects(confirmar({ comprovante: token }, usuarioId, depsFalha), InternalServerError);
    assert.deepEqual(depsFalha.apagados, [], "falha transitória não apaga o objeto");
    const ok = sessaoUpload();
    const depsOk = dependencias(ok, { mime: "image/jpeg", bytes: jpeg() });
    assert.ok((await confirmar({ comprovante: token }, usuarioId, depsOk)).id);
    assert.equal(ok.inseridos.length, 1);
  }

  // Comprovante de outro bucket ou adulterado.
  await assert.rejects(confirmar({ comprovante: "invalido" }, usuarioId, depsA), BadRequestError);
  await assert.rejects(confirmar({ comprovante: `${assinatura.comprovante.slice(0, -2)}aa` }, usuarioId, depsA), BadRequestError);

  assert.ok(!logs.flat().some((item) => String(item).includes(process.env.SUPABASE_SECRET_KEY)), "chave nunca aparece em log");
  console.log("OK: testes do portal (andamento) passaram.");
} finally {
  console.error = consoleAnterior;
  if (envAnterior === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = envAnterior;
}
