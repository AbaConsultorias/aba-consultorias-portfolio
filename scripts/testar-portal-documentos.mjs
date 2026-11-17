import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import ts from "typescript";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const modulos = new Map();
const staffId = "11111111-1111-4111-8111-111111111111";
const outroId = "11111111-1111-4111-8111-999999999999";
const empId = "33333333-3333-4333-8333-333333333333";
const projetoId = "44444444-4444-4444-8444-444444444444";
const projetoOutroId = "44444444-4444-4444-8444-555555555555";
const categoriaId = "55555555-5555-4555-8555-555555555555";
const novoId = "66666666-6666-4666-8666-666666666666";
const docId = "77777777-7777-4777-8777-777777777777";
const PDF_VALIDO = Buffer.from("%PDF-1.4\n%%EOF\n");
const SHA_PDF_VALIDO = "14bcd090baf31edba64e9cbd8cdfc15f943344aa72cb3675ad8e91bfcbce03ad";
let papel = "equipe";
let permissoesDaConta = [];
let sessaoAtual;
let falhaLog = false;
let falhaR2 = false;
const eventos = [];
const invalidacoes = [];

const substitutos = {
  "server-only": {},
  "next/cache": { revalidatePath: (...args) => invalidacoes.push(args) },
  "react": { cache: (fn) => fn },
  "next/navigation": { notFound: () => { throw new Error("NEXT_NOT_FOUND"); } },
  "@/lib/auth/guard": {
    exigirPapelApi: async (papeis) => {
      const { ForbiddenError } = carregar("src/app/api/HttpErrors.ts");
      if (!papeis.includes(papel)) throw new ForbiddenError("Acesso negado.");
      return { user: { id: staffId }, perfil: { papel } };
    },
  },
  "@/lib/supabase/server": { createClient: async () => clienteDaSessao() },
  "@/lib/supabase/admin": {
    createAdminClient: () => ({
      from: (tabela) => ({ insert: async (registro) => {
        assert.equal(tabela, "downloads_log");
        eventos.push(["log", registro]);
        return { error: falhaLog ? { code: "TEST_LOG", status: 503 } : null };
      } }),
    }),
  },
  "@/lib/r2/cliente": {
    presignGet: async (chave, segundos, opcoes) => {
      eventos.push(["assinar-download-r2", chave, segundos, opcoes]);
      if (falhaR2) throw new (carregar("src/app/api/HttpErrors.ts").InternalServerError)(null);
      return `https://r2.invalid/${chave}?assinatura=simulada`;
    },
  },
  "@/lib/rate-limit": {
    limitar: async () => true,
    chaveIp: (_request, prefixo) => `${prefixo}:${"a".repeat(64)}`,
  },
};

const OPCOES_EMPREENDIMENTOS = [{ id: empId, nome: "Empreendimento de teste", cidade: null }];

// A sessão de cada caso responde as tabelas; `minhas_permissoes` vem de `permissoesDaConta`.
function clienteDaSessao() {
  return new Proxy({}, {
    get: (_, propriedade) => {
      if (propriedade === "rpc") {
        return async (nome, ...args) => {
          if (nome === "minhas_permissoes") return { data: permissoesDaConta, error: null };
          if (typeof sessaoAtual?.rpc === "function") return sessaoAtual.rpc(nome, ...args);
          return { data: nome === "opcoes_empreendimentos" ? OPCOES_EMPREENDIMENTOS : null, error: null };
        };
      }
      const valor = sessaoAtual?.[propriedade];
      return typeof valor === "function" ? valor.bind(sessaoAtual) : valor;
    },
  });
}

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
    if (nome.startsWith(".")) {
      // permissoes-servidor.ts importa "./guard": é o mesmo módulo simulado de "@/lib/auth/guard".
      const destino = resolve(dirname(arquivo), nome);
      const apelido = `@/${relative(resolve(raiz, "src"), destino).split("\\").join("/")}`;
      return Object.hasOwn(substitutos, apelido) ? substitutos[apelido] : carregar(`${destino}.ts`);
    }
    return require(nome);
  };
  runInThisContext(`(function(require, module, exports) {${codigo}\n})`, { filename: arquivo })(importar, modulo, modulo.exports);
  return modulo.exports;
}

// Banco simulado em memória: só o necessário para as consultas dos módulos de documentos.
function criarEstado(extra = {}) {
  return {
    tabelas: {
      empreendimentos: [{ id: empId }],
      projetos: [{ id: projetoId, empreendimento_id: empId }, { id: projetoOutroId, empreendimento_id: "99999999-9999-4999-8999-999999999999" }],
      projeto_categorias_documento: [{ id: categoriaId, projeto_id: projetoId }],
      documentos: [],
      downloads_log: [],
    },
    falhas: [],
    chamadas: [],
    nomes: {},
    ...extra,
  };
}

function criarSessao(estado) {
  class Consulta {
    constructor(tabela) { this.tabela = tabela; this.filtros = []; this.operacao = "select"; this.retorna = false; }
    select() { if (this.operacao !== "select") this.retorna = true; return this; }
    eq(campo, valor) { this.filtros.push([campo, valor]); return this; }
    order() { return this; }
    range() { return this; }
    limit() { return this; }
    in() { return this; }
    insert(linha) { this.operacao = "insert"; this.linha = linha; return this; }
    update(campos) { this.operacao = "update"; this.campos = campos; return this; }
    delete() { this.operacao = "delete"; return this; }
    maybeSingle() { return this.executar(true); }
    single() { return this.executar(true); }
    then(resolver, rejeitar) { return this.executar(false).then(resolver, rejeitar); }
    async executar(unico) {
      estado.chamadas.push([this.operacao, this.tabela, this.campos ?? this.linha ?? null]);
      const falha = estado.falhas.find((item) => item.tabela === this.tabela && item.operacao === this.operacao && item.vezes > 0);
      if (falha) { falha.vezes--; return { data: null, error: { code: falha.code } }; }
      const linhas = estado.tabelas[this.tabela];
      const casa = (linha) => this.filtros.every(([campo, valor]) => linha[campo] === valor);
      if (this.operacao === "insert") {
        if (linhas.some((linha) => linha.id === this.linha.id || linha.storage_path === this.linha.storage_path)) return { data: null, error: { code: "23505" } };
        linhas.push({ ...this.linha, criado_em: "2026-10-28T12:00:00.000Z", liberado_em: null });
        return { data: this.retorna ? { id: this.linha.id } : null, error: null };
      }
      const alvo = linhas.filter(casa);
      if (this.operacao === "update") for (const linha of alvo) Object.assign(linha, this.campos);
      if (this.operacao === "delete") estado.tabelas[this.tabela] = linhas.filter((linha) => !casa(linha));
      const dados = this.operacao === "delete" && !this.retorna ? null : unico ? alvo[0] ?? null : alvo;
      return { data: dados, error: null };
    }
  }
  return {
    from: (tabela) => new Consulta(tabela),
    rpc: async (nome, args) => nome === "opcoes_empreendimentos"
      ? { data: estado.tabelas.empreendimentos.map((empreendimento) => ({ id: empreendimento.id, nome: "Empreendimento de teste", cidade: null })), error: null }
      : { data: estado.nomes[args?.p_profile] ?? null, error: null },
  };
}

function linhaDocumento(extra = {}) {
  return {
    id: docId, empreendimento_id: empId, projeto_id: null, categoria_id: null, grupo: null, titulo: "Planta", mime: "application/pdf",
    tamanho: PDF_VALIDO.length, sha256: SHA_PDF_VALIDO, storage_path: `${empId}/${docId}.pdf`, liberado_cliente: false,
    liberado_por: null, liberado_em: null, criado_em: "2026-10-28T12:00:00.000Z", ...extra,
  };
}

const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha256Base64 = (bytes) => createHash("sha256").update(bytes).digest("base64");

// O R2 guarda o tamanho e o checksum do que recebeu; o objeto simulado devolve os valores reais dos bytes (ou os forçados em `objeto`).
function criarArmazenamento(estado, objetos = {}) {
  return {
    async criarUrlAssinada(path, objeto) {
      eventos.push(["upload-assinado", path, objeto]);
      return {
        url: `https://r2.invalid/${path}?assinatura=simulada`,
        cabecalhos: { "content-type": "application/pdf", "x-amz-checksum-sha256": Buffer.from(objeto.sha256, "hex").toString("base64") },
      };
    },
    async consultarObjeto(path) {
      estado.chamadas.push(["storage-head", path]);
      const objeto = objetos[path];
      if (!objeto) return null;
      return {
        tamanho: objeto.bytes.length,
        sha256Base64: objeto.sha256Base64 === undefined ? sha256Base64(objeto.bytes) : objeto.sha256Base64,
        contentType: objeto.contentType === undefined ? "application/pdf" : objeto.contentType,
      };
    },
    async lerCabecalho(path) {
      estado.chamadas.push(["storage-faixa", path]);
      const objeto = objetos[path];
      return objeto ? new Uint8Array(objeto.bytes.subarray(0, 5)) : null;
    },
    async removerObjeto(path) {
      estado.chamadas.push(["storage-remover", path]);
      const falha = estado.falhasStorage?.shift();
      if (falha) throw new Error("storage");
    },
  };
}

let relogioAtual = Date.parse("2026-10-28T12:00:00.000Z");
const relogio = { agora: () => relogioAtual };
const envAnterior = process.env.SUPABASE_SECRET_KEY;
const fetchAnterior = globalThis.fetch;
const consoleAnterior = console.error;
const logs = [];
process.env.SUPABASE_SECRET_KEY = randomBytes(32).toString("hex");
globalThis.fetch = async () => { throw new Error("Rede proibida neste teste."); };
console.error = (...args) => logs.push(args);

try {
  const regras = carregar("src/lib/portal/documentos/regras.ts");
  const { assinarSchema, confirmarSchema } = carregar("src/app/api/(modules)/adm-interno/portal/documentos/upload/schema.ts");
  const upload = carregar("src/app/api/(modules)/adm-interno/portal/documentos/upload/service.ts");
  const crud = carregar("src/app/api/(modules)/adm-interno/portal/documentos/service.ts");
  const crudSchema = carregar("src/app/api/(modules)/adm-interno/portal/documentos/schema.ts");
  const { baixar } = carregar("src/app/api/(modules)/portal/documentos/[id]/download/service.ts");
  const { BadRequestError, ConflictError, ForbiddenError, InternalServerError, NotFoundError } = carregar("src/app/api/HttpErrors.ts");
  const { PERMISSOES } = carregar("src/lib/auth/permissoes.ts");
  const todasAsPermissoes = new Set(PERMISSOES);
  permissoesDaConta = [...PERMISSOES];
  const { validarComprovante } = carregar("src/lib/portal/comum/upload.ts");

  // PDF falso/truncado e SHA-256 conhecido.
  assert.equal(regras.comecaComPdf(PDF_VALIDO), true);
  assert.equal(regras.comecaComPdf(Buffer.from("PK\u0003\u0004zip")), false);
  assert.equal(regras.comecaComPdf(Buffer.from("%PDF")), false, "cabeçalho truncado");
  assert.equal(regras.comecaComPdf(Buffer.alloc(0)), false);
  assert.equal(regras.LIMITE_PDF_BYTES, 104857600);
  assert.equal(regras.formatarTamanho(512), "512 B");
  assert.equal(regras.formatarTamanho(1536), "1,5 KB");
  assert.equal(regras.formatarTamanho(104857600), "100 MB");

  // Nome do arquivo baixado: derivado do título, sempre .pdf, sem separadores de caminho.
  assert.equal(regras.nomeArquivoPdf("Planta"), "Planta.pdf");
  assert.equal(regras.nomeArquivoPdf("Contrato.PDF"), "Contrato.pdf");
  assert.equal(regras.nomeArquivoPdf("Ação nº 1/2: \"final\"\r\n"), "Ação nº 1 2 final.pdf");
  assert.equal(regras.nomeArquivoPdf("../../etc/passwd"), "etc passwd.pdf");
  assert.equal(regras.nomeArquivoPdf("  ...  "), "documento.pdf");
  assert.equal(regras.nomeArquivoPdf("a".repeat(300)), `${"a".repeat(120)}.pdf`);

  // Agrupamento por projeto/categoria.
  const base = { liberadoEm: null, tamanho: 1, downloadHref: "/x" };
  const grupos = regras.agruparDocumentos([
    { ...base, id: "a", titulo: "A", projetoId: null, categoriaId: null },
    { ...base, id: "b", titulo: "B", projetoId, categoriaId },
    { ...base, id: "c", titulo: "C", projetoId, categoriaId: null },
    { ...base, id: "d", titulo: "D", projetoId, categoriaId },
  ], [{ id: projetoId, nome: "Casa" }], [{ id: categoriaId, projetoId, nome: "Contratos", ordem: 0 }]);
  assert.deepEqual(grupos.map((g) => [g.projeto, g.categoria, g.documentos.map((d) => d.id)]),
    [["Casa", "Contratos", ["b", "d"]], ["Casa", null, ["c"]], [null, null, ["a"]]]);

  const documentosAgrupados = Object.freeze([
    Object.freeze({ id: "geral", projetoId: null, categoriaId: null, liberadoCliente: true }),
    Object.freeze({ id: "sem", projetoId, categoriaId: null, liberadoCliente: false }),
    Object.freeze({ id: "segundo", projetoId, categoriaId: "cat-2", liberadoCliente: true }),
    Object.freeze({ id: "primeiro", projetoId, categoriaId, liberadoCliente: true }),
    Object.freeze({ id: "homonimo", projetoId: projetoOutroId, categoriaId: "cat-outro", liberadoCliente: false }),
    Object.freeze({ id: "repetido", projetoId, categoriaId, liberadoCliente: false }),
  ]);
  const projetosAgrupados = Object.freeze([
    { id: projetoOutroId, nome: "Casa" }, { id: projetoId, nome: "Casa" },
  ]);
  const categoriasAgrupadas = Object.freeze([
    { id: "cat-2", projetoId, nome: "Documentos", ordem: 20 },
    { id: categoriaId, projetoId, nome: "Projetos", ordem: 3 },
    { id: "cat-outro", projetoId: projetoOutroId, nome: "Projetos", ordem: 0 },
  ]);
  const cartoes = regras.agruparDocumentosPorProjeto(documentosAgrupados, projetosAgrupados, categoriasAgrupadas);
  assert.deepEqual(cartoes.map((p) => [p.projetoId, p.nome, p.quantidade]), [
    [projetoId, "Casa", 4], [projetoOutroId, "Casa", 1], [null, "Documentos gerais", 1],
  ], "projetos homônimos não se misturam; gerais ficam no fim");
  assert.deepEqual(cartoes[0].categorias.map((g) => [g.categoria, g.documentos.map((d) => d.id)]), [
    ["Projetos", ["primeiro", "repetido"]], ["Documentos", ["segundo"]], [null, ["sem"]],
  ], "ordem cadastrada, sem categoria por último e ordem dos documentos preservada");
  assert.equal(cartoes[0].categorias[0].documentos[0], documentosAgrupados[3], "preserva os campos e a identidade dos documentos admin");
  assert.deepEqual(regras.agruparDocumentosPorProjeto([], projetosAgrupados, categoriasAgrupadas), []);
  const comGrupos = regras.agruparDocumentosPorProjeto([
    { id: "g1", projetoId: null, categoriaId: null, grupo: null },
    { id: "o1", projetoId: null, categoriaId: null, grupo: "orcamentos" },
    { id: "c1", projetoId: null, categoriaId: null, grupo: "contratos" },
    { id: "p1", projetoId, categoriaId: null, grupo: "contratos" },
    { id: "c2", projetoId: null, categoriaId: null, grupo: "contratos" },
  ], projetosAgrupados, categoriasAgrupadas);
  assert.deepEqual(comGrupos.map((p) => [p.chave, p.nome, p.grupo, p.categorias.flatMap((g) => g.documentos.map((d) => d.id))]), [
    [projetoId, "Casa", null, ["p1"]],
    ["grupo:contratos", "Contratos", "contratos", ["c1", "c2"]],
    ["grupo:orcamentos", "Orçamentos", "orcamentos", ["o1"]],
    ["gerais", "Documentos gerais", null, ["g1"]],
  ], "contratos e orçamentos viram seções próprias, depois dos projetos e antes dos gerais; grupo com projeto é ignorado");
  const comArquivo = regras.agruparDocumentosPorProjeto([
    { id: "g1", projetoId: null, categoriaId: null, grupo: null },
    { id: "a1", projetoId: null, categoriaId: null, grupo: "arquivo", pastaRotulo: "Projeto Urbanístico" },
    { id: "a2", projetoId: null, categoriaId: null, grupo: "arquivo", pastaRotulo: "Conjunto Motobomba" },
    { id: "a3", projetoId: null, categoriaId: null, grupo: "arquivo", pastaRotulo: "Projeto Urbanístico" },
    { id: "c1", projetoId: null, categoriaId: null, grupo: "contratos" },
    { id: "p1", projetoId, categoriaId: null, grupo: "arquivo", pastaRotulo: "Solto" },
  ], projetosAgrupados, categoriasAgrupadas);
  assert.deepEqual(comArquivo.map((p) => [p.chave, p.nome, p.grupo, p.categorias.flatMap((g) => g.documentos.map((d) => d.id))]), [
    [projetoId, "Casa", null, ["p1"]],
    ["grupo:contratos", "Contratos", "contratos", ["c1"]],
    ["arquivo:Conjunto Motobomba", "Outros projetos › Conjunto Motobomba", "arquivo", ["a2"]],
    ["arquivo:Projeto Urbanístico", "Outros projetos › Projeto Urbanístico", "arquivo", ["a1", "a3"]],
    ["gerais", "Documentos gerais", null, ["g1"]],
  ], "um cartão por rótulo em Outros projetos (ordem alfabética), depois de contratos e antes dos gerais; o rótulo de documento com projeto é ignorado");
  assert.equal(regras.nomeDoGrupoSemProjeto("arquivo", "Drenagem"), "Outros projetos › Drenagem");
  assert.equal(regras.nomeDoGrupoSemProjeto("arquivo", null), "Outros projetos");
  assert.equal(regras.nomeDoGrupoSemProjeto("contratos", null), "Contratos");
  assert.equal(regras.NOME_DO_GRUPO.arquivo, "Outros projetos");
  const referenciasInvalidas = regras.agruparDocumentosPorProjeto([
    { projetoId, categoriaId: "cat-outro" },
    { projetoId, categoriaId: "inexistente" },
    { projetoId: "projeto-sem-metadados", categoriaId: null },
    { projetoId: null, categoriaId },
  ], projetosAgrupados, categoriasAgrupadas);
  assert.equal(referenciasInvalidas.find((p) => p.projetoId === projetoId).categorias[0].categoria, null,
    "categoria ausente ou de outro projeto vai para Sem categoria");
  assert.equal(referenciasInvalidas.find((p) => p.projetoId === projetoId).quantidade, 2);
  assert.equal(referenciasInvalidas.find((p) => p.projetoId === "projeto-sem-metadados").nome, "Projeto sem nome disponível",
    "metadados ausentes não transformam documento de projeto em geral");
  assert.equal(referenciasInvalidas.at(-1).categorias[0].categoria, null);

  const ordemAlfabetica = regras.agruparDocumentosPorProjeto([
    { projetoId: "z", categoriaId: null }, { projetoId: "a", categoriaId: null },
  ], [{ id: "z", nome: "Zeta" }, { id: "a", nome: "Água" }], []);
  assert.deepEqual(ordemAlfabetica.map((p) => p.nome), ["Água", "Zeta"]);

  // Com a ordem definida pela equipe, ela vale antes do nome; o nome só desempata.
  const comOrdem = [{ id: "z", nome: "Zeta", ordem: 0 }, { id: "a", nome: "Água", ordem: 2 }, { id: "b", nome: "Beta", ordem: 2 }];
  assert.deepEqual(regras.agruparDocumentosPorProjeto([
    { projetoId: "a", categoriaId: null }, { projetoId: "b", categoriaId: null }, { projetoId: "z", categoriaId: null }, { projetoId: null, categoriaId: null },
  ], comOrdem, []).map((p) => p.nome), ["Zeta", "Água", "Beta", "Documentos gerais"], "ordem da equipe, nome no empate, gerais no fim");

  // Cartões em árvore: dependentes logo após o pai, rótulo "Depende de", gerais no fim.
  const projetosArvore = [
    { id: "a", nome: "Alfa", projetoPaiId: null }, { id: "b", nome: "Beta", projetoPaiId: "z" },
    { id: "c", nome: "Casa", projetoPaiId: null }, { id: "z", nome: "Zeta", projetoPaiId: "c" },
  ];
  const cartoesArvore = ["a", "b", "z", "c", null].map((id) => ({ projetoId: id }));
  assert.deepEqual(regras.ordenarCartoesPorArvore(cartoesArvore, projetosArvore).map((n) => [n.cartao.projetoId, n.nivel, n.dependeDe]), [
    ["a", 0, null], ["c", 0, null], ["z", 1, "Casa"], ["b", 2, "Zeta"], [null, 0, null],
  ]);
  // A ordem da equipe manda entre irmãos (raízes e dependentes), qualquer que seja a ordem de entrada dos cartões.
  const projetosOrdenados = [
    { id: "a", nome: "Alfa", projetoPaiId: null, ordem: 1 }, { id: "c", nome: "Casa", projetoPaiId: null, ordem: 0 },
    { id: "b", nome: "Beta", projetoPaiId: "c", ordem: 1 }, { id: "z", nome: "Zeta", projetoPaiId: "c", ordem: 0 },
  ];
  const resumoOrdenado = (cartoesEntrada) => regras.ordenarCartoesPorArvore(cartoesEntrada, projetosOrdenados).map((n) => [n.cartao.projetoId, n.nivel, n.dependeDe]);
  const ordemEsperada = [["c", 0, null], ["z", 1, "Casa"], ["b", 1, "Casa"], ["a", 0, null], [null, 0, null]];
  assert.deepEqual(resumoOrdenado(["a", "b", "z", "c", null].map((id) => ({ projetoId: id }))), ordemEsperada);
  assert.deepEqual(resumoOrdenado([null, "c", "z", "b", "a"].map((id) => ({ projetoId: id }))), ordemEsperada, "a ordem de entrada não interfere");
  // Pai sem cartão na página: o dependente vira raiz, mas o rótulo continua.
  assert.deepEqual(regras.ordenarCartoesPorArvore([{ projetoId: "b" }], projetosArvore).map((n) => [n.cartao.projetoId, n.nivel, n.dependeDe]), [["b", 0, "Zeta"]]);
  // Cadeia quebrada: o pai imediato não tem cartão, o recuo sobe até o primeiro ancestral com cartão; o rótulo segue o pai imediato.
  const cadeia = [
    { id: "a", nome: "Alfa", projetoPaiId: null }, { id: "b", nome: "Beta", projetoPaiId: "a" },
    { id: "c", nome: "Casa", projetoPaiId: "b" }, { id: "d", nome: "Dado", projetoPaiId: null },
  ];
  assert.deepEqual(regras.ordenarCartoesPorArvore([{ projetoId: "a" }, { projetoId: "c" }, { projetoId: "d" }], cadeia).map((n) => [n.cartao.projetoId, n.nivel, n.dependeDe]), [
    ["a", 0, null], ["c", 1, "Beta"], ["d", 0, null],
  ]);
  const ciclo = [{ id: "a", nome: "Alfa", projetoPaiId: "b" }, { id: "b", nome: "Beta", projetoPaiId: "a" }, { id: "c", nome: "Casa", projetoPaiId: "b" }];
  assert.equal(regras.ordenarCartoesPorArvore([{ projetoId: "c" }], ciclo).length, 1, "ciclo entre ancestrais sem cartão não trava");
  assert.deepEqual(regras.ordenarCartoesPorArvore([{ projetoId: "a" }, { projetoId: "x" }], [{ id: "a", nome: "Alfa" }]).map((n) => [n.cartao.projetoId, n.dependeDe]),
    [["a", null], ["x", null]], "projetos sem metadados ou sem projetoPaiId ficam como raízes");

  assert.equal(regras.projetoDoHash(`#projeto-${projetoId}`), projetoId);
  assert.equal(regras.projetoDoHash(`#projeto-${"abcdefab-cdef-4abc-8abc-abcdefabcdef".toUpperCase()}`), "abcdefab-cdef-4abc-8abc-abcdefabcdef");
  for (const hash of ["", "#documentos-gerais", "#projeto-invalido", `#projeto-${projetoId}/extra`, `#projeto-${projetoId}?pagina=2`]) {
    assert.equal(regras.projetoDoHash(hash), null);
  }

  const { listarDocumentos } = carregar("src/lib/portal/documentos/consultas.ts");
  const estadoFiltro = criarEstado();
  estadoFiltro.tabelas.documentos = [
    linhaDocumento({ projeto_id: projetoId, liberado_cliente: true }),
    linhaDocumento({ id: novoId, projeto_id: projetoOutroId, liberado_cliente: true }),
    linhaDocumento({ id: outroId, projeto_id: projetoId, liberado_cliente: false }),
    linhaDocumento({ id: staffId, projeto_id: projetoId, liberado_cliente: true, mime: "application/zip" }),
    linhaDocumento({ id: empId, projeto_id: projetoId, liberado_cliente: true, empreendimento_id: outroId }),
  ];
  sessaoAtual = criarSessao(estadoFiltro);
  assert.deepEqual((await listarDocumentos(empId, {}, projetoId)).registros.map((d) => d.id), [docId],
    "filtro da âncora preserva empreendimento, PDF e liberação do cliente");
  assert.deepEqual((await listarDocumentos(empId)).registros.map((d) => d.id), [docId, novoId]);
  assert.deepEqual((await listarDocumentos(empId, {}, "invalido")).registros, []);

  // Schemas: limites e campos livres.
  const entradaAssinar = { empreendimentoId: empId, titulo: "Contrato", mime: "application/pdf", tamanho: 104857600, sha256: SHA_PDF_VALIDO };
  assert.equal(assinarSchema.safeParse(entradaAssinar).success, true);
  assert.equal(assinarSchema.safeParse({ ...entradaAssinar, tamanho: 104857601 }).success, false);
  const semSha256 = { ...entradaAssinar };
  delete semSha256.sha256;
  assert.equal(assinarSchema.safeParse(semSha256).success, false, "assinar exige sha256");
  for (const sha256 of ["", SHA_PDF_VALIDO.slice(1), `${SHA_PDF_VALIDO}0`, SHA_PDF_VALIDO.toUpperCase(), `g${SHA_PDF_VALIDO.slice(1)}`,
    Buffer.from(SHA_PDF_VALIDO, "hex").toString("base64"), null, 123]) {
    assert.equal(assinarSchema.safeParse({ ...entradaAssinar, sha256 }).success, false, `sha256 ${String(sha256)}`);
  }
  assert.equal(assinarSchema.safeParse({ ...entradaAssinar, tamanho: 0 }).success, false);
  assert.equal(assinarSchema.safeParse({ ...entradaAssinar, mime: "image/png" }).success, false);
  assert.equal(assinarSchema.safeParse({ ...entradaAssinar, path: "x" }).success, false, "path livre");
  assert.equal(assinarSchema.safeParse({ ...entradaAssinar, categoriaId }).success, false, "categoria sem projeto");
  assert.equal(assinarSchema.safeParse({ ...entradaAssinar, titulo: "a" }).success, false);
  assert.equal(confirmarSchema.safeParse({ comprovante: "x", sha256: "y" }).success, false, "hash livre");
  assert.equal(crudSchema.atualizarSchema.safeParse({ id: docId }).success, false, "PATCH vazio");
  assert.equal(crudSchema.atualizarSchema.safeParse({ id: docId, storage_path: "x", titulo: "Ok" }).success, false, "path em PATCH");
  assert.equal(crudSchema.atualizarSchema.safeParse({ id: docId, liberado: true }).success, true);

  // Assinar: relações com a sessão, path UUID, comprovante amarrado ao usuário.
  async function assinar(estado, entrada) {
    sessaoAtual = criarSessao(estado);
    const armazenamento = criarArmazenamento(estado);
    return upload.assinarEnvio(entrada, staffId, { criarSessao: async () => sessaoAtual, armazenamento, novoId: () => novoId, relogio });
  }
  const estadoAssinar = criarEstado();
  const assinatura = await assinar(estadoAssinar, { ...entradaAssinar, tamanho: 1000, projetoId, categoriaId });
  assert.equal(assinatura.path, `${empId}/${novoId}.pdf`);
  assert.deepEqual(Object.keys(assinatura).sort(), ["cabecalhos", "comprovante", "path", "url"]);
  assert.equal(assinatura.url, `https://r2.invalid/${empId}/${novoId}.pdf?assinatura=simulada`);
  assert.deepEqual(assinatura.cabecalhos, { "content-type": "application/pdf", "x-amz-checksum-sha256": Buffer.from(SHA_PDF_VALIDO, "hex").toString("base64") });
  assert.deepEqual(eventos.find((e) => e[0] === "upload-assinado").slice(1), [`${empId}/${novoId}.pdf`, { tamanho: 1000, sha256: SHA_PDF_VALIDO }],
    "o armazenamento recebe o tamanho e o sha256 que o comprovante carrega");
  const comprovanteEmitido = validarComprovante(assinatura.comprovante, staffId, relogio);
  assert.equal(comprovanteEmitido.registroId, novoId);
  assert.equal(comprovanteEmitido.sha256, SHA_PDF_VALIDO);
  await assert.rejects(assinar(criarEstado(), { ...entradaAssinar, tamanho: 1000, projetoId: projetoOutroId }), BadRequestError);
  await assert.rejects(assinar(criarEstado(), { ...entradaAssinar, tamanho: 1000, projetoId, categoriaId: "88888888-8888-4888-8888-888888888888" }), BadRequestError);
  await assert.rejects(assinar(criarEstado(), { ...entradaAssinar, empreendimentoId: "99999999-9999-4999-8999-999999999999", tamanho: 1000 }), BadRequestError);
  await assert.rejects(assinar(criarEstado(), { ...entradaAssinar, tamanho: 104857601 }), BadRequestError, "limite também no comprovante");
  await assert.rejects(assinar(criarEstado(), { ...entradaAssinar, tamanho: 1000, sha256: "não é hex" }), BadRequestError, "sha256 também no comprovante");
  await assert.rejects(assinar(criarEstado(), { ...entradaAssinar, tamanho: 1000, sha256: undefined }), BadRequestError, "sem sha256 não há comprovante");
  assert.equal(eventos.filter((e) => e[0] === "upload-assinado").length, 1, "só a assinatura válida chegou ao Storage");

  // Confirmar.
  async function preparar(bytes, opcoes = {}) {
    const estado = criarEstado(opcoes.estado);
    sessaoAtual = criarSessao(estado);
    const tamanhoAssinado = opcoes.tamanho ?? bytes.length;
    const shaAssinado = opcoes.sha256 ?? sha256Hex(bytes);
    // contentType e sha256Base64 forçam o que o R2 devolveria no HEAD (objeto de outro tipo ou sem checksum).
    const armazenamento = criarArmazenamento(estado, { [`${empId}/${novoId}.pdf`]: { bytes, contentType: opcoes.contentType, sha256Base64: opcoes.sha256Base64 } });
    estado.excluidos = [];
    const dependencias = { criarSessao: async () => sessaoAtual, armazenamento, novoId: () => novoId, relogio, registroExcluido: async (id) => estado.excluidos.includes(id) };
    const emitido = await upload.assinarEnvio({ ...entradaAssinar, tamanho: tamanhoAssinado, sha256: shaAssinado, projetoId, categoriaId }, staffId, dependencias);
    return { estado, dependencias, comprovante: emitido.comprovante };
  }
  const removidos = (estado) => estado.chamadas.filter((c) => c[0] === "storage-remover");
  const inserts = (estado) => estado.chamadas.filter((c) => c[0] === "insert");
  const leituras = (estado) => estado.chamadas.filter((c) => c[0] === "storage-head" || c[0] === "storage-faixa").map((c) => c[0]);

  // válido: nasce oculto, sha256 do comprovante, linha criada pela sessão; confere por HEAD + faixa, sem ler o arquivo
  let caso = await preparar(PDF_VALIDO);
  assert.deepEqual(await upload.confirmarEnvio({ comprovante: caso.comprovante }, staffId, caso.dependencias), { id: novoId });
  const gravada = caso.estado.tabelas.documentos[0];
  assert.equal(gravada.sha256, SHA_PDF_VALIDO);
  assert.equal(gravada.liberado_cliente, false);
  assert.equal(gravada.storage_path, `${empId}/${novoId}.pdf`);
  assert.equal(gravada.tamanho, PDF_VALIDO.length);
  assert.equal(gravada.projeto_id, projetoId);
  assert.equal(Object.hasOwn(gravada, "liberado_por"), false);
  assert.equal(removidos(caso.estado).length, 0);
  assert.deepEqual(leituras(caso.estado), ["storage-head", "storage-faixa"]);

  // arquivo no limite exato: 100 MiB aceitos; o sha256 gravado é o do comprovante (nada relido)
  const grande = Buffer.alloc(104857600, 0x30);
  PDF_VALIDO.copy(grande);
  caso = await preparar(grande);
  await upload.confirmarEnvio({ comprovante: caso.comprovante }, staffId, caso.dependencias);
  assert.equal(caso.estado.tabelas.documentos[0].sha256, sha256Hex(grande));
  assert.equal(caso.estado.tabelas.documentos[0].tamanho, 104857600);
  assert.deepEqual(leituras(caso.estado), ["storage-head", "storage-faixa"]);

  // falso, truncado, maior que o assinado, checksum divergente, tipo errado: recusa, apaga o objeto, não grava linha
  const recusas = [
    ["PDF falso", Buffer.from("PK\u0003\u0004 não sou pdf ........"), {}],
    ["truncado (menos bytes que o assinado)", PDF_VALIDO.subarray(0, 8), { tamanho: PDF_VALIDO.length, sha256: SHA_PDF_VALIDO }],
    ["cabeçalho truncado", Buffer.from("%PDF"), {}],
    ["maior que o assinado", Buffer.concat([PDF_VALIDO, Buffer.from("extra")]), { tamanho: PDF_VALIDO.length, sha256: SHA_PDF_VALIDO }],
    ["vazio", Buffer.alloc(0), { tamanho: 10 }],
    ["checksum divergente (mesmo tamanho)", PDF_VALIDO, { sha256: sha256Hex(Buffer.from("%PDF-1.4\n%%EOX\n")) }],
    ["objeto sem checksum", PDF_VALIDO, { sha256Base64: null }],
    ["Content-Type de outro tipo", PDF_VALIDO, { contentType: "text/html" }],
  ];
  for (const [nome, bytes, opcoes] of recusas) {
    caso = await preparar(bytes, opcoes);
    await assert.rejects(upload.confirmarEnvio({ comprovante: caso.comprovante }, staffId, caso.dependencias), BadRequestError, nome);
    assert.deepEqual(removidos(caso.estado), [["storage-remover", `${empId}/${novoId}.pdf`]], `${nome}: objeto apagado`);
    assert.equal(inserts(caso.estado).length, 0, `${nome}: sem linha`);
  }

  // comprovante adulterado, de outro usuário ou expirado: nada é tocado
  caso = await preparar(PDF_VALIDO);
  caso.estado.chamadas.length = 0;
  const [payload, mac] = caso.comprovante.split(".");
  const adulterados = [
    `${payload}.${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`,
    `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url")), tamanho: 1 })).toString("base64url")}.${mac}`,
    `${payload}x.${mac}`,
    "lixo",
  ];
  for (const token of adulterados) {
    await assert.rejects(upload.confirmarEnvio({ comprovante: token }, staffId, caso.dependencias), BadRequestError);
  }
  await assert.rejects(upload.confirmarEnvio({ comprovante: caso.comprovante }, outroId, caso.dependencias), BadRequestError, "outro autor");
  relogioAtual += 31 * 60 * 1000;
  await assert.rejects(upload.confirmarEnvio({ comprovante: caso.comprovante }, staffId, caso.dependencias), BadRequestError, "expirado");
  relogioAtual -= 31 * 60 * 1000;
  assert.equal(removidos(caso.estado).length, 0, "comprovante inválido nunca apaga objeto");
  assert.equal(caso.estado.chamadas.length, 0, "nem consulta o banco");

  // replay: mesma resposta, sem regravar nem apagar; replay incompatível não apaga o objeto referenciado
  caso = await preparar(PDF_VALIDO);
  await upload.confirmarEnvio({ comprovante: caso.comprovante }, staffId, caso.dependencias);
  assert.deepEqual(await upload.confirmarEnvio({ comprovante: caso.comprovante }, staffId, caso.dependencias), { id: novoId });
  assert.equal(inserts(caso.estado).length, 1);
  caso.estado.tabelas.documentos[0].titulo = "Editado depois";
  assert.deepEqual(await upload.confirmarEnvio({ comprovante: caso.comprovante }, staffId, caso.dependencias), { id: novoId });
  caso.estado.tabelas.documentos[0].tamanho = 999;
  await assert.rejects(upload.confirmarEnvio({ comprovante: caso.comprovante }, staffId, caso.dependencias), ConflictError);
  assert.equal(removidos(caso.estado).length, 0);

  // documento já excluído: o comprovante ainda vale, mas o id consumido não ressuscita (objeto reenviado é descartado)
  caso = await preparar(PDF_VALIDO);
  await upload.confirmarEnvio({ comprovante: caso.comprovante }, staffId, caso.dependencias);
  caso.estado.tabelas.documentos.length = 0;
  caso.estado.excluidos.push(novoId);
  await assert.rejects(upload.confirmarEnvio({ comprovante: caso.comprovante }, staffId, caso.dependencias), BadRequestError, "id de documento excluído");
  assert.deepEqual(removidos(caso.estado), [["storage-remover", `${empId}/${novoId}.pdf`]], "objeto reenviado é apagado");
  assert.equal(inserts(caso.estado).length, 1, "nenhuma segunda linha");

  // concorrência: perde na PK, devolve o vencedor compatível, sem apagar
  caso = await preparar(PDF_VALIDO);
  caso.estado.falhas.push({ tabela: "documentos", operacao: "insert", code: "23505", vezes: 1 });
  const vencedor = linhaDocumento({ id: novoId, storage_path: `${empId}/${novoId}.pdf` });
  const sessaoConcorrente = criarSessao(caso.estado);
  const falhaInsert = sessaoConcorrente.from;
  sessaoConcorrente.from = (tabela) => {
    const consulta = falhaInsert(tabela);
    const insertOriginal = consulta.insert.bind(consulta);
    consulta.insert = (linha) => { if (tabela === "documentos") caso.estado.tabelas.documentos.push(vencedor); return insertOriginal(linha); };
    return consulta;
  };
  assert.deepEqual(await upload.confirmarEnvio({ comprovante: caso.comprovante }, staffId, { ...caso.dependencias, criarSessao: async () => sessaoConcorrente }), { id: novoId });
  assert.equal(removidos(caso.estado).length, 0);

  // falha transitória de banco: não apaga e permite repetir
  caso = await preparar(PDF_VALIDO);
  caso.estado.falhas.push({ tabela: "documentos", operacao: "insert", code: "08006", vezes: 1 });
  await assert.rejects(upload.confirmarEnvio({ comprovante: caso.comprovante }, staffId, caso.dependencias), InternalServerError);
  assert.equal(removidos(caso.estado).length, 0);
  caso.dependencias.armazenamento = criarArmazenamento(caso.estado, { [`${empId}/${novoId}.pdf`]: { bytes: PDF_VALIDO } });
  assert.deepEqual(await upload.confirmarEnvio({ comprovante: caso.comprovante }, staffId, caso.dependencias), { id: novoId });

  // pai some entre assinar e confirmar; objeto ausente; comprovante de foto
  caso = await preparar(PDF_VALIDO);
  caso.estado.tabelas.projetos = [];
  await assert.rejects(upload.confirmarEnvio({ comprovante: caso.comprovante }, staffId, caso.dependencias), BadRequestError);
  assert.equal(removidos(caso.estado).length, 1);
  caso = await preparar(PDF_VALIDO);
  caso.dependencias.armazenamento = criarArmazenamento(caso.estado, {});
  await assert.rejects(upload.confirmarEnvio({ comprovante: caso.comprovante }, staffId, caso.dependencias),
    (erro) => erro instanceof BadRequestError && erro.details === "O arquivo não chegou ao armazenamento. Envie novamente.");
  assert.equal(removidos(caso.estado).length, 0, "objeto ausente: nada a apagar");
  assert.equal(inserts(caso.estado).length, 0);
  const { assinarComprovante } = carregar("src/lib/portal/comum/upload.ts");
  const foto = assinarComprovante({
    usuarioId: staffId, registroId: novoId, bucket: "obras", path: `atualizacoes/${empId}/${projetoId}/${novoId}.jpg`,
    mime: "image/jpeg", tamanho: 10, metadados: { atualizacaoId: projetoId, ordem: 0 },
  }, relogio);
  await assert.rejects(upload.confirmarEnvio({ comprovante: foto }, staffId, caso.dependencias), BadRequestError);

  // Exclusão: oculta → apaga objeto → apaga linha; repetição idempotente.
  function dependenciasExclusao(estado) {
    return { criarSessao: async () => criarSessao(estado), armazenamento: criarArmazenamento(estado) };
  }
  let estado = criarEstado();
  estado.tabelas.documentos.push(linhaDocumento({ liberado_cliente: true }));
  await crud.excluir(docId, todasAsPermissoes, dependenciasExclusao(estado));
  assert.deepEqual(estado.chamadas.filter((c) => c[0] !== "select").map((c) => c[0]), ["update", "storage-remover", "delete"]);
  assert.deepEqual(estado.chamadas.find((c) => c[0] === "update")[2], { liberado_cliente: false });
  assert.equal(estado.tabelas.documentos.length, 0);
  await assert.rejects(crud.excluir(docId, todasAsPermissoes, dependenciasExclusao(estado)), NotFoundError, "exclusão repetida de linha já apagada");

  estado = criarEstado({ falhasStorage: [true] });
  estado.tabelas.documentos.push(linhaDocumento({ liberado_cliente: true }));
  await assert.rejects(crud.excluir(docId, todasAsPermissoes, dependenciasExclusao(estado)), Error);
  assert.equal(estado.tabelas.documentos.length, 1, "Storage falhou: registro continua");
  assert.equal(estado.tabelas.documentos[0].liberado_cliente, false, "e continua oculto");
  assert.equal(estado.chamadas.some((c) => c[0] === "delete"), false);
  await crud.excluir(docId, todasAsPermissoes, dependenciasExclusao(estado));
  assert.equal(estado.tabelas.documentos.length, 0);

  estado = criarEstado();
  estado.tabelas.documentos.push(linhaDocumento());
  estado.falhas.push({ tabela: "documentos", operacao: "delete", code: "08006", vezes: 1 });
  await assert.rejects(crud.excluir(docId, todasAsPermissoes, dependenciasExclusao(estado)), InternalServerError);
  assert.equal(estado.tabelas.documentos.length, 1);
  await crud.excluir(docId, todasAsPermissoes, dependenciasExclusao(estado));
  assert.equal(removidos(estado).length, 2, "remoção do objeto repetida sem erro");
  assert.equal(estado.tabelas.documentos.length, 0);

  estado = criarEstado();
  estado.tabelas.documentos.push(linhaDocumento({ storage_path: `99999999-9999-4999-8999-999999999999/${docId}.pdf` }));
  await assert.rejects(crud.excluir(docId, todasAsPermissoes, dependenciasExclusao(estado)), InternalServerError, "caminho de outro empreendimento");
  assert.equal(removidos(estado).length, 0);

  // PATCH: liberar não manda carimbo; projeto troca limpa categoria; relações coerentes.
  estado = criarEstado();
  estado.tabelas.documentos.push(linhaDocumento({ projeto_id: projetoId, categoria_id: categoriaId }));
  const dependenciasPatch = dependenciasExclusao(estado);
  const liberado = await crud.atualizar({ id: docId, liberado: true }, dependenciasPatch);
  assert.deepEqual(estado.chamadas.find((c) => c[0] === "update")[2], { liberado_cliente: true });
  assert.equal(liberado.liberadoCliente, true);
  assert.equal(Object.hasOwn(liberado, "storage_path"), false);
  await crud.atualizar({ id: docId, projetoId: null }, dependenciasPatch);
  assert.deepEqual([estado.tabelas.documentos[0].projeto_id, estado.tabelas.documentos[0].categoria_id], [null, null]);
  await assert.rejects(crud.atualizar({ id: docId, categoriaId }, dependenciasPatch), BadRequestError, "categoria sem projeto");
  await assert.rejects(crud.atualizar({ id: docId, projetoId: projetoOutroId }, dependenciasPatch), BadRequestError, "projeto de outro empreendimento");
  await crud.atualizar({ id: docId, projetoId, categoriaId }, dependenciasPatch);
  await assert.rejects(crud.atualizar({ id: "77777777-7777-4777-8777-000000000000", titulo: "Ok" }, dependenciasPatch), NotFoundError);
  estado.tabelas.documentos[0].mime = "application/zip";
  await assert.rejects(crud.atualizar({ id: docId, liberado: true }, dependenciasPatch), BadRequestError, "só PDF é liberado");

  // Download do cliente: autorização, log e falha de log.
  const request = new Request(`https://portal.invalid/api/portal/documentos/${docId}/download`);
  const linhaDownload = (extra = {}) => ({ id: docId, storage_path: `${empId}/${docId}.pdf`, mime: "application/pdf", titulo: "Planta baixa: Ação 1/2", liberado_cliente: true, empreendimento_id: empId, ...extra });
  const sessaoDownload = (dados) => ({ from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: dados, error: null }) }) });
  papel = "cliente";
  eventos.length = 0;
  sessaoAtual = sessaoDownload(linhaDownload());
  let resposta = await baixar(request, { id: docId });
  assert.equal(resposta.status, 307);
  assert.equal(resposta.headers.get("Cache-Control"), "private, no-store");
  assert.equal(resposta.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(resposta.headers.get("Location"), `https://r2.invalid/${empId}/${docId}.pdf?assinatura=simulada`, "o download vai para o R2");
  assert.deepEqual(eventos.find((e) => e[0] === "assinar-download-r2").slice(1), [`${empId}/${docId}.pdf`, 60, { nomeArquivo: "Planta baixa Ação 1 2.pdf", anexo: true }]);
  assert.equal(eventos.filter((e) => e[0] === "assinar-download-r2").length, 1);
  assert.equal(eventos.find((e) => e[0] === "log")[1].arquivo_tipo, "documento");
  assert.equal(eventos.find((e) => e[0] === "log")[1].profile_id, staffId);

  falhaR2 = true;
  eventos.length = 0;
  resposta = await baixar(request, { id: docId });
  assert.equal(resposta.status, 500, "falha do R2 não entrega URL");
  assert.equal(resposta.headers.get("Location"), null);
  assert.equal(eventos.some((e) => e[0] === "log"), false, "sem URL, sem registro de download");
  falhaR2 = false;

  sessaoAtual = sessaoDownload(linhaDownload({ liberado_cliente: false }));
  resposta = await baixar(request, { id: docId });
  assert.equal(resposta.status, 404, "documento oculto");
  sessaoAtual = sessaoDownload(linhaDownload({ mime: "application/zip" }));
  assert.equal((await baixar(request, { id: docId })).status, 404, "não-PDF para cliente");
  sessaoAtual = sessaoDownload(null);
  const ausente = await baixar(request, { id: docId });
  assert.equal(ausente.status, 404);
  const invalido = await baixar(request, { id: "../../etc/passwd" });
  assert.equal(invalido.status, 404);
  assert.deepEqual(await invalido.json(), await ausente.json(), "inválido e ausente respondem igual");
  assert.equal(invalido.headers.get("Cache-Control"), "private, no-store");

  falhaLog = true;
  sessaoAtual = sessaoDownload(linhaDownload());
  resposta = await baixar(request, { id: docId });
  assert.equal(resposta.status, 500, "falha de log não entrega URL");
  assert.equal(resposta.headers.get("Location"), null);
  assert.equal(JSON.stringify(await resposta.json()).includes("r2.invalid"), false);
  falhaLog = false;

  // Log de downloads: só admin.
  const rotaDownloads = carregar("src/app/api/(modules)/adm-interno/portal/documentos/downloads/route.ts");
  estado = criarEstado();
  estado.nomes = { [staffId]: "Fulano" };
  estado.tabelas.downloads_log.push({ id: novoId, profile_id: staffId, ip_hash: "abcdef0123456789".repeat(4), em: "2026-10-28T12:00:00.000Z", arquivo_tipo: "documento", arquivo_id: docId });
  sessaoAtual = criarSessao(estado);
  const urlLog = `https://portal.invalid/api/adm-interno/portal/documentos/downloads?documentoId=${docId}`;
  papel = "equipe";
  assert.equal((await rotaDownloads.GET(new Request(urlLog))).status, 403, "equipe não vê o log");
  papel = "admin";
  const corpoLog = await (await rotaDownloads.GET(new Request(urlLog))).json();
  assert.equal(corpoLog.details.registros[0].nome, "Fulano");
  assert.equal(corpoLog.details.registros[0].origem, "abcdef01");
  assert.equal(JSON.stringify(corpoLog).includes("abcdef0123456789abcdef"), false, "hash do IP não sai inteiro");
  assert.equal((await rotaDownloads.GET(new Request(`${urlLog.split("?")[0]}?documentoId=x`))).status, 400);

  // Download por conta interna: precisa de documentos.ver; sem ela, nada é assinado nem registrado.
  papel = "equipe";
  for (const [concedidas, esperado] of [[[], 403], [["documentos.editar", "documentos.liberar", "financeiro.ver"], 403], [["documentos.ver"], 307]]) {
    permissoesDaConta = concedidas;
    eventos.length = 0;
    sessaoAtual = sessaoDownload(linhaDownload({ liberado_cliente: false }));
    assert.equal((await baixar(request, { id: docId })).status, esperado, `equipe [${concedidas.join(",")}]`);
    assert.equal(eventos.length > 0, esperado === 307, "assinatura e log só com a permissão");
  }
  permissoesDaConta = [...PERMISSOES];

  // Exclusão: a permissão é conferida antes de qualquer consulta ou remoção no R2 (R17), e documento liberado exige também documentos.liberar (R12).
  const { armazenamentoPadrao } = carregar("src/lib/portal/documentos/armazenamento.ts");
  const removerOriginal = armazenamentoPadrao.removerObjeto;
  armazenamentoPadrao.removerObjeto = async (path) => { eventos.push(["r2-remover", path]); };
  try {
    const rotaDocumentos = carregar("src/app/api/(modules)/adm-interno/portal/documentos/route.ts");
    const requisicao = (metodo, corpo) => new Request("https://portal.invalid/api/adm-interno/portal/documentos", {
      method: metodo, headers: { "content-type": "application/json" }, body: JSON.stringify(corpo),
    });
    const removidoNoR2 = () => eventos.filter((e) => e[0] === "r2-remover");
    const prepararExclusao = (extra = {}) => {
      eventos.length = 0;
      const novo = criarEstado();
      novo.tabelas.documentos.push(linhaDocumento(extra));
      sessaoAtual = criarSessao(novo);
      return novo;
    };

    // Serviço: liberado sem documentos.liberar não apaga nada, nem o objeto, nem a linha, nem despublica.
    estado = criarEstado();
    estado.tabelas.documentos.push(linhaDocumento({ liberado_cliente: true }));
    for (const concedidas of [[], ["documentos.ver", "documentos.editar"]]) {
      await assert.rejects(crud.excluir(docId, new Set(concedidas), dependenciasExclusao(estado)), ForbiddenError, `liberado sem liberar [${concedidas.join(",")}]`);
    }
    assert.equal(estado.chamadas.some((c) => c[0] === "storage-remover" || c[0] === "delete" || c[0] === "update"), false);
    assert.equal(estado.tabelas.documentos.length, 1);
    assert.equal(estado.tabelas.documentos[0].liberado_cliente, true);
    await crud.excluir(docId, new Set(["documentos.editar", "documentos.liberar"]), dependenciasExclusao(estado));
    assert.equal(estado.tabelas.documentos.length, 0);
    // Não liberado: documentos.liberar não é exigido no serviço (a rota exige documentos.editar).
    estado = criarEstado();
    estado.tabelas.documentos.push(linhaDocumento());
    await crud.excluir(docId, new Set(["documentos.editar"]), dependenciasExclusao(estado));
    assert.equal(estado.tabelas.documentos.length, 0);

    // Rota: sem documentos.editar, nem lê o documento.
    papel = "equipe";
    for (const concedidas of [[], ["documentos.ver"], ["documentos.ver", "documentos.liberar"], ["financeiro.ver", "financeiro.editar"]]) {
      permissoesDaConta = concedidas;
      for (const liberado of [false, true]) {
        const novo = prepararExclusao({ liberado_cliente: liberado });
        assert.equal((await rotaDocumentos.DELETE(requisicao("DELETE", { id: docId }))).status, 403, `sem editar [${concedidas.join(",")}] liberado=${liberado}`);
        assert.equal(novo.chamadas.length, 0, "nenhuma consulta antes da permissão");
        assert.equal(removidoNoR2().length, 0, "nada apagado do R2");
        assert.equal(novo.tabelas.documentos.length, 1);
      }
    }
    // Com documentos.editar: documento oculto sai; liberado só com documentos.liberar também.
    permissoesDaConta = ["documentos.ver", "documentos.editar"];
    let novo = prepararExclusao();
    assert.equal((await rotaDocumentos.DELETE(requisicao("DELETE", { id: docId }))).status, 200);
    assert.deepEqual(removidoNoR2().map((e) => e[1]), [`${empId}/${docId}.pdf`]);
    assert.equal(novo.tabelas.documentos.length, 0);
    novo = prepararExclusao({ liberado_cliente: true });
    assert.equal((await rotaDocumentos.DELETE(requisicao("DELETE", { id: docId }))).status, 403, "liberado sem documentos.liberar");
    assert.equal(removidoNoR2().length, 0);
    assert.equal(novo.chamadas.some((c) => c[0] === "update" || c[0] === "delete"), false);
    assert.equal(novo.tabelas.documentos[0].liberado_cliente, true);
    permissoesDaConta = ["documentos.ver", "documentos.editar", "documentos.liberar"];
    assert.equal((await rotaDocumentos.DELETE(requisicao("DELETE", { id: docId }))).status, 200);
    assert.equal(removidoNoR2().length, 1);
    assert.equal(novo.tabelas.documentos.length, 0);
    // Externos nunca excluem, mesmo com permissões no banco.
    for (const externo of ["cliente", "empreiteiro", "fornecedor"]) {
      papel = externo;
      permissoesDaConta = [...PERMISSOES];
      novo = prepararExclusao();
      assert.equal((await rotaDocumentos.DELETE(requisicao("DELETE", { id: docId }))).status, 403, externo);
      assert.equal(novo.chamadas.length, 0);
      assert.equal(removidoNoR2().length, 0);
    }
    papel = "equipe";

    // PATCH: cada campo exige a sua permissão.
    const { exigirPermissoesDaAlteracao } = crud;
    assert.throws(() => exigirPermissoesDaAlteracao({ id: docId, titulo: "x" }, new Set(["documentos.liberar"])), ForbiddenError);
    assert.throws(() => exigirPermissoesDaAlteracao({ id: docId, liberado: true }, new Set(["documentos.editar"])), ForbiddenError);
    assert.throws(() => exigirPermissoesDaAlteracao({ id: docId, titulo: "x", liberado: true }, new Set(["documentos.editar"])), ForbiddenError);
    exigirPermissoesDaAlteracao({ id: docId, titulo: "x", liberado: true }, new Set(["documentos.editar", "documentos.liberar"]));
    exigirPermissoesDaAlteracao({ id: docId, liberado: false }, new Set(["documentos.liberar"]));
    permissoesDaConta = ["documentos.ver"];
    novo = prepararExclusao();
    assert.equal((await rotaDocumentos.PATCH(requisicao("PATCH", { id: docId, titulo: "Novo" }))).status, 403);
    assert.equal(novo.chamadas.length, 0);
    permissoesDaConta = [...PERMISSOES];
  } finally {
    armazenamentoPadrao.removerObjeto = removerOriginal;
    permissoesDaConta = [...PERMISSOES];
    papel = "equipe";
  }

  {
    // Aba Documentos do cliente: ordem da aba Projetos, dependente logo após o pai, só projetos com documento,
    // contagem real, etapa atual, SIMOS fora das categorias, contratação e gerais separados.
    const { montarPainelDeDocumentos, tomDaEtapa } = carregar("src/lib/portal/documentos/painel.ts");
    const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const etapas = [{ id: id(901), nome: "Não Iniciado", ordem: 0 }, { id: id(902), nome: "Em análise", ordem: 1 }, { id: id(903), nome: "Aprovado", ordem: 2 }, { id: id(904), nome: "Obras finalizadas", ordem: 3 }];
    const projeto = (n, nome, ordem, pai = null, etapa = null) => ({ id: id(n), nome, ordem, projetoPaiId: pai, etapaAtualId: etapa, etapas, progresso: 0 });
    const projetos = [projeto(3, "Termo", 3), projeto(2, "DT", 2, id(1), id(903)), projeto(1, "SAA", 1, null, id(902)), projeto(4, "Vazio", 0)];
    const doc = (n, extra) => ({ id: id(100 + n), titulo: `Doc ${n}`, projetoId: null, categoriaId: null, grupo: null, tamanho: 10, liberadoEm: null, equipamento: null, equipamentoPapel: null, downloadHref: "x", ...extra });
    const categorias = [{ id: id(50), projetoId: id(1), nome: "Laudos", ordem: 2 }, { id: id(51), projetoId: id(1), nome: "Projetos", ordem: 1 }];
    const documentos = [
      doc(1, { projetoId: id(2) }), doc(2, { projetoId: id(1), categoriaId: id(50) }), doc(3, { projetoId: id(1), categoriaId: id(51) }),
      doc(4, { projetoId: id(1), equipamento: "EAT 1", equipamentoPapel: "laudo" }), doc(5, { projetoId: id(3) }),
      doc(6, { grupo: "orcamentos" }), doc(7, { grupo: "contratos" }), doc(8, {}), doc(9, { projetoId: id(999) }),
      doc(10, { grupo: "arquivo", pastaRotulo: "Projeto Urbanístico" }), doc(11, { grupo: "arquivo", pastaRotulo: "Conjunto Motobomba" }),
      doc(12, { grupo: "arquivo", pastaRotulo: "Projeto Urbanístico" }), doc(13, { grupo: "arquivo", pastaRotulo: "Água e esgoto" }),
    ];
    const painel = montarPainelDeDocumentos(documentos, projetos, categorias);
    assert.deepEqual(painel.projetos.map((c) => c.nome), ["SAA", "DT", "Termo"], "ordem da aba Projetos, dependente após o pai, sem projeto vazio");
    assert.deepEqual(painel.projetos.map((c) => c.nivel), [0, 1, 0]);
    assert.equal(painel.projetos[1].dependeDe, "SAA");
    assert.equal(painel.projetos[0].total, 3, "total conta todos os documentos do projeto, inclusive SIMOS e Laudos");
    assert.deepEqual(painel.projetos[0].categorias.map((c) => c.nome), ["Projetos", "Laudos"], "categorias na ordem cadastrada");
    assert.deepEqual(painel.projetos[0].equipamentos.map((d) => d.id), [id(104)]);
    assert.deepEqual(painel.projetos[0].etapa, { nome: "Em análise", tom: "info" });
    assert.deepEqual(painel.projetos[1].etapa, { nome: "Aprovado", tom: "ok" });
    assert.equal(painel.projetos[2].etapa, null);
    assert.deepEqual(painel.contratacao.map((c) => c.nome), ["Contratos", "Orçamentos"], "Outros projetos não entram na contratação");
    assert.deepEqual(painel.outros.map((c) => [c.chave, c.nome, c.total]), [
      ["arquivo:Água e esgoto", "Água e esgoto", 1], ["arquivo:Conjunto Motobomba", "Conjunto Motobomba", 1], ["arquivo:Projeto Urbanístico", "Projeto Urbanístico", 2],
    ], "um cartão por rótulo, em ordem alfabética (pt-BR)");
    assert.deepEqual(painel.outros[2].categorias.map((c) => [c.nome, c.documentos.map((d) => d.id)]), [[null, [id(110), id(112)]]], "ordem dos documentos preservada");
    assert.deepEqual(painel.outros.map((c) => [c.projetoId, c.etapa, c.nivel, c.dependeDe, c.equipamentos.length]), [[null, null, 0, null, 0], [null, null, 0, null, 0], [null, null, 0, null, 0]]);
    assert.deepEqual(painel.gerais.categorias[0].documentos.map((d) => d.id), [id(108), id(109)], "projeto desconhecido vai para Outros documentos");
    assert.deepEqual(montarPainelDeDocumentos([], projetos, categorias).outros, [], "sem documento de arquivo não há bloco");
    assert.deepEqual(tomDaEtapa(etapas, id(901)), { nome: "Não Iniciado", tom: "neutro" });
    assert.deepEqual(tomDaEtapa(etapas, id(904)), { nome: "Obras finalizadas", tom: "ok" });
  }

  assert.equal(logs.flat().some((item) => typeof item === "string" && item.includes(process.env.SUPABASE_SECRET_KEY)), false, "segredo nunca vai a log");
  assert.equal(logs.flat().some((item) => typeof item === "string" && /r2\.invalid|assinatura=|x-amz/i.test(item)), false, "URL assinada nunca vai a log");
  console.log("testar-portal-documentos: OK");
} finally {
  globalThis.fetch = fetchAnterior;
  console.error = consoleAnterior;
  if (envAnterior === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = envAnterior;
}
