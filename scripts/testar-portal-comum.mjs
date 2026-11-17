import assert from "node:assert/strict";
import { randomBytes, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import ts from "typescript";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const modulos = new Map();
const usuarioId = "11111111-1111-4111-8111-111111111111";
const registroId = "22222222-2222-4222-8222-222222222222";
const empreendimentoId = "33333333-3333-4333-8333-333333333333";
const paiId = "44444444-4444-4444-8444-444444444444";
let papel = "equipe";
let falhaGuard = false;
let permissoesDaConta = [];
let falhaPermissoes = false;
let consultasPermissoes = 0;
let limitePermitido = true;
const limites = [];
const invalidacoes = [];
let sessaoAtual;
let acessosAdmin = 0;
let adminContas;
let falhaStorage = false;
let falhaLog = false;
const eventosPadrao = [];

const substitutos = {
  "server-only": {},
  "next/cache": { revalidatePath: (...args) => invalidacoes.push(args) },
  "react": { cache: (fn) => fn },
  "next/navigation": { notFound: () => { throw new Error("NEXT_NOT_FOUND"); } },
  "@/lib/auth/guard": {
    exigirPapelApi: async (papeis) => {
      const { UnauthorizedError, ForbiddenError } = carregar("src/app/api/HttpErrors.ts");
      if (falhaGuard) throw new UnauthorizedError("Sessão inválida.");
      if (!papeis.includes(papel)) throw new ForbiddenError("Acesso negado.");
      return { user: { id: usuarioId }, perfil: { papel } };
    },
  },
  "@/lib/supabase/server": { createClient: async () => clienteDaSessao() },
  "@/lib/supabase/admin": {
    createAdminClient: () => {
      acessosAdmin++;
      if (adminContas) return adminContas;
      return {
        storage: { from: (bucket) => ({ createSignedUrl: async (path, segundos, opcoes) => {
          eventosPadrao.push(["storage", bucket, path, segundos, opcoes]);
          return falhaStorage ? { error: { code: "TEST_STORAGE", status: 503 } }
            : { data: { signedUrl: "https://storage.invalid/arquivo?token=simulado" }, error: null };
        } }) },
        from: (tabela) => ({ insert: async (registro) => {
          assert.equal(tabela, "downloads_log");
          eventosPadrao.push(["log", registro]);
          return { error: falhaLog ? { code: "TEST_LOG", status: 503 } : null };
        } }),
      };
    },
  },
  "@/lib/r2/cliente": {
    presignGet: async (chave, segundos, opcoes) => {
      eventosPadrao.push(["r2", chave, segundos, opcoes]);
      if (falhaStorage) throw new (carregar("src/app/api/HttpErrors.ts").InternalServerError)(null);
      return "https://r2.invalid/arquivo?assinatura=simulada";
    },
  },
  "@/lib/rate-limit": {
    limitar: async (...args) => { limites.push(args); return limitePermitido; },
    chaveIp: (_request, prefixo) => `${prefixo}:${"a".repeat(64)}`,
  },
};

// A sessão simulada de cada caso responde as tabelas; `minhas_permissoes` é a única rpc tratada aqui.
function clienteDaSessao() {
  return new Proxy({}, {
    get: (_, propriedade) => {
      if (propriedade === "rpc") {
        return async (nome, ...args) => {
          if (nome !== "minhas_permissoes") return sessaoAtual.rpc(nome, ...args);
          consultasPermissoes++;
          return falhaPermissoes ? { data: null, error: { code: "TEST_PERMISSOES", status: 503 } } : { data: permissoesDaConta, error: null };
        };
      }
      const valor = sessaoAtual?.[propriedade];
      return typeof valor === "function" ? valor.bind(sessaoAtual) : valor;
    },
  });
}

// Transpila os módulos reais em memória; apenas as fronteiras externas são simuladas.
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

function simularSessao(dados, erro = null) {
  const chamadas = [];
  const consulta = {
    select(campos) { chamadas.push(["select", campos]); return this; },
    eq(campo, valor) { chamadas.push(["eq", campo, valor]); return this; },
    async maybeSingle() { return { data: dados, error: erro }; },
  };
  return { chamadas, from(tabela) { chamadas.push(["from", tabela]); return consulta; } };
}

const instante = Date.parse("2026-10-28T12:00:00.000Z");
const relogio = { agora: () => instante };
const request = new Request("https://portal.invalid/api/portal/documentos/id/download");
const entrada = {
  usuarioId, registroId, bucket: "documentos", path: `${empreendimentoId}/${registroId}.pdf`,
  mime: "application/pdf", tamanho: 128, sha256: "a".repeat(64),
  metadados: { empreendimentoId, titulo: "Documento de teste" },
};
const documento = {
  id: registroId, storage_path: entrada.path, mime: "application/pdf", titulo: "Planta: Ação nº 1/2", liberado_cliente: true,
  empreendimento_id: empreendimentoId,
};
const envAnterior = process.env.SUPABASE_SECRET_KEY;
const fetchAnterior = globalThis.fetch;
const consoleAnterior = console.error;
const logs = [];
process.env.SUPABASE_SECRET_KEY = randomBytes(32).toString("hex");
globalThis.fetch = async () => { throw new Error("Rede proibida neste teste."); };
console.error = (...args) => logs.push(args);

try {
  const { assinarComprovante, validarComprovante } = carregar("src/lib/portal/comum/upload.ts");
  const { entregarArquivoPrivado, entregarVisualizacaoDeSimo } = carregar("src/lib/portal/comum/arquivos.ts");
  const { autorizarPortal, invalidarPortal } = carregar("src/lib/portal/comum/servidor.ts");
  const { PERMISSOES } = carregar("src/lib/auth/permissoes.ts");
  permissoesDaConta = [...PERMISSOES];
  const { BadRequestError, TooManyRequestsError, UnauthorizedError, ForbiddenError } = carregar("src/app/api/HttpErrors.ts");
  const token = assinarComprovante(entrada, relogio);
  const comprovante = validarComprovante(token, usuarioId, relogio);
  assert.equal(comprovante.expiraEm, "2026-10-28T12:30:00.000Z");
  assert.equal(comprovante.versao, 1);
  assert.equal(comprovante.path, entrada.path);
  assert.equal(validarComprovante(token, usuarioId, { agora: () => instante + 1799999 }).registroId, registroId);
  assert.throws(() => validarComprovante(token, usuarioId, { agora: () => instante + 1800000 }), BadRequestError);
  assert.throws(() => validarComprovante(token, paiId, relogio), BadRequestError);
  assert.throws(() => validarComprovante(`${token[0] === "a" ? "b" : "a"}${token.slice(1)}`, usuarioId, relogio), BadRequestError);
  assert.throws(() => validarComprovante(`${token.slice(0, -2)}aa`, usuarioId, relogio), BadRequestError);
  assert.throws(() => validarComprovante("invalido", usuarioId, relogio), BadRequestError);
  assert.throws(() => validarComprovante("a".repeat(4097), usuarioId, relogio), BadRequestError);
  assert.equal(comprovante.sha256, "a".repeat(64));
  assert.equal(validarComprovante(assinarComprovante({ ...entrada, tamanho: 104857600 }, relogio), usuarioId, relogio).tamanho, 104857600);
  assert.throws(() => assinarComprovante({ ...entrada, tamanho: 104857601 }, relogio), BadRequestError);
  for (const sha256 of [undefined, "", "a".repeat(63), "A".repeat(64), "g".repeat(64), "a".repeat(65)]) {
    assert.throws(() => assinarComprovante({ ...entrada, sha256 }, relogio), BadRequestError, `sha256 ${String(sha256)}`);
  }
  assert.throws(() => assinarComprovante({ ...entrada, path: `../${registroId}.pdf` }, relogio), BadRequestError);
  assert.throws(() => assinarComprovante({ ...entrada, metadados: { ...entrada.metadados, mime: "application/pdf" } }, relogio), BadRequestError);
  function assinarPayload(dados, contexto = "portal-upload-v1") {
    const payload = Buffer.from(JSON.stringify(dados)).toString("base64url");
    const mac = createHmac("sha256", process.env.SUPABASE_SECRET_KEY).update(`${contexto}.${payload}`).digest("base64url");
    return `${payload}.${mac}`;
  }
  assert.throws(() => validarComprovante(assinarPayload({ ...comprovante, tamanho: -1 }), usuarioId, relogio), BadRequestError);
  assert.throws(() => validarComprovante(assinarPayload({ ...comprovante, expiraEm: "2026-10-28T13:00:00.000Z" }), usuarioId, relogio), BadRequestError);
  assert.throws(() => validarComprovante(assinarPayload(comprovante, "outro-contexto"), usuarioId, relogio), BadRequestError);
  for (const [mime, ext] of Object.entries({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" })) {
    const foto = { usuarioId, registroId, bucket: "obras", mime, tamanho: 10485760,
      path: `atualizacoes/${empreendimentoId}/${paiId}/${registroId}.${ext}`, metadados: { atualizacaoId: paiId, ordem: 0 } };
    assert.equal(validarComprovante(assinarComprovante(foto, relogio), usuarioId, relogio).mime, mime);
    assert.throws(() => assinarComprovante({ ...foto, tamanho: 10485761 }, relogio), BadRequestError);
    const relato = { ...foto, finalidade: "relato_foto", path: `relatos/${empreendimentoId}/${paiId}/${registroId}.${ext}`,
      metadados: { obraId: empreendimentoId, relatoId: paiId, ordem: 0 } };
    const assinado = assinarComprovante(relato, relogio);
    assert.equal(validarComprovante(assinado, usuarioId, relogio).finalidade, "relato_foto");
    assert.throws(() => validarComprovante(assinado, paiId, relogio), BadRequestError);
    assert.throws(() => validarComprovante(assinado, usuarioId, { agora: () => instante + 1800000 }), BadRequestError);
    assert.throws(() => assinarComprovante({ ...relato, path: foto.path }, relogio), BadRequestError);
    assert.throws(() => assinarComprovante({ ...relato, metadados: { ...relato.metadados, obraId: registroId } }, relogio), BadRequestError);
    assert.throws(() => assinarComprovante({ ...relato, metadados: { ...relato.metadados, relatoId: registroId } }, relogio), BadRequestError);
    assert.throws(() => assinarComprovante({ ...relato, tamanho: 10485761 }, relogio), BadRequestError);
    assert.throws(() => assinarComprovante({ ...relato, finalidade: "atualizacao_foto" }, relogio), BadRequestError);
  }
  const legado = { ...comprovante };
  delete legado.finalidade;
  assert.equal(validarComprovante(assinarPayload(legado), usuarioId, relogio).finalidade, "documento");
  const uploadFotoAtualizacao = carregar("src/app/api/(modules)/adm-interno/portal/atualizacao-fotos/upload/service.ts");
  const tokenRelato = assinarComprovante({
    usuarioId, registroId, finalidade: "relato_foto", bucket: "obras", mime: "image/jpeg", tamanho: 100,
    path: `relatos/${empreendimentoId}/${paiId}/${registroId}.jpg`, metadados: { obraId: empreendimentoId, relatoId: paiId, ordem: 0 },
  });
  await assert.rejects(() => uploadFotoAtualizacao.confirmar({ comprovante: tokenRelato }, usuarioId, {
    sessao: async () => { assert.fail("Comprovante de relato deve ser recusado antes de consultar a atualização."); },
  }), (erro) => erro instanceof BadRequestError && erro.details === "Comprovante incompatível.");
  for (const finalidade of ["fornecedor_contrato", "fornecedor_documento"]) {
    for (const [mime, ext] of Object.entries({ "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" })) {
      const pasta = finalidade === "fornecedor_contrato" ? "contratos" : "documentos";
      const dados = { usuarioId, registroId, finalidade, bucket: "fornecedores", mime, tamanho: 20971520,
        path: `${paiId}/${pasta}/${registroId}.${ext}`,
        metadados: { fornecedorId: paiId, empreendimentoId, titulo: "Arquivo de teste", ...(finalidade === "fornecedor_documento" ? { tipo: "nota_fiscal" } : {}) } };
      if (finalidade === "fornecedor_contrato" && mime !== "application/pdf") {
        assert.throws(() => assinarComprovante(dados, relogio), BadRequestError);
        continue;
      }
      const assinado = assinarComprovante(dados, relogio);
      assert.equal(validarComprovante(assinado, usuarioId, relogio).finalidade, finalidade);
      assert.throws(() => validarComprovante(assinado, paiId, relogio), BadRequestError);
      assert.throws(() => validarComprovante(assinado, usuarioId, { agora: () => instante + 1800000 }), BadRequestError);
      assert.throws(() => assinarComprovante({ ...dados, tamanho: 20971521 }, relogio), BadRequestError);
      assert.throws(() => assinarComprovante({ ...dados, path: `${registroId}/${pasta}/${registroId}.${ext}` }, relogio), BadRequestError);
      assert.throws(() => assinarComprovante({ ...dados, bucket: "documentos" }, relogio), BadRequestError);
      assert.throws(() => assinarComprovante({ ...dados, finalidade: finalidade === "fornecedor_contrato" ? "fornecedor_documento" : "fornecedor_contrato" }, relogio), BadRequestError);
      assert.throws(() => assinarComprovante({ ...dados, path: dados.path + ".pdf" }, relogio), BadRequestError);
      if (finalidade === "fornecedor_documento") {
        assert.throws(() => assinarComprovante({ ...dados, metadados: { ...dados.metadados, tipo: "livre" } }, relogio), BadRequestError);
      }
    }
  }

  const esperados = { leitura: [120, 60], escrita: [60, 60], assinar: [30, 600], confirmar: [60, 600], download: [120, 60], foto: [600, 60], criar_conta: [10, 3600], enviar_relato: [20, 3600], enviar_documento: [30, 3600] };
  for (const [acao, [limite, janela]] of Object.entries(esperados)) {
    const acesso = await autorizarPortal(acao, "documentos.ver");
    assert.equal(acesso.user.id, usuarioId);
    assert.ok(acesso.permissoes.has("documentos.ver"));
    assert.deepEqual(limites.at(-1), [`portal:${acao}:${usuarioId}`, limite, janela, { falhaAberta: false }]);
  }
  // Com a permissão, o limite decide; sem ela, a negação vem antes e o limite nem é consultado.
  limitePermitido = false;
  await assert.rejects(() => autorizarPortal("escrita", "financeiro.editar"), TooManyRequestsError);
  permissoesDaConta = ["financeiro.ver"];
  let limitesAntes = limites.length;
  await assert.rejects(() => autorizarPortal("escrita", "financeiro.editar"), ForbiddenError);
  assert.equal(limites.length, limitesAntes);
  limitePermitido = true;
  permissoesDaConta = ["site.ver", "financeiro.ver"];
  await autorizarPortal("leitura", "financeiro.ver");
  await assert.rejects(() => autorizarPortal("escrita", "financeiro.editar"), ForbiddenError);
  await assert.rejects(() => autorizarPortal("leitura", { qualquer: [] }), ForbiddenError);
  await autorizarPortal("leitura", { qualquer: ["obras.ver", "financeiro.ver"] });
  // "so-admin" não vale para equipe, nem com as 22 permissões.
  permissoesDaConta = [...PERMISSOES];
  limitesAntes = limites.length;
  await assert.rejects(() => autorizarPortal("escrita", "so-admin"), ForbiddenError);
  assert.equal(limites.length, limitesAntes);
  papel = "admin";
  await autorizarPortal("escrita", "so-admin");
  papel = "equipe";
  // Erro ao ler as permissões vale como conjunto vazio: nega, sem chamar o limite.
  falhaPermissoes = true;
  limitesAntes = limites.length;
  await assert.rejects(() => autorizarPortal("leitura", "documentos.ver"), ForbiddenError);
  assert.equal(limites.length, limitesAntes);
  falhaPermissoes = false;
  // Sem sessão: 401 antes de ler permissão ou chamar o limite.
  falhaGuard = true;
  limitesAntes = limites.length;
  consultasPermissoes = 0;
  await assert.rejects(() => autorizarPortal("leitura", "documentos.ver"), UnauthorizedError);
  assert.equal(limites.length, limitesAntes);
  assert.equal(consultasPermissoes, 0);
  falhaGuard = false;
  // Papel externo: nunca passa em regra interna, mesmo com permissões no banco; só entra por `externos`.
  papel = "cliente";
  consultasPermissoes = 0;
  limitesAntes = limites.length;
  await assert.rejects(() => autorizarPortal("escrita", "documentos.ver"), ForbiddenError);
  await assert.rejects(() => autorizarPortal("download", { qualquer: [...PERMISSOES] }), ForbiddenError);
  await assert.rejects(() => autorizarPortal("download", "so-admin"), ForbiddenError);
  await assert.rejects(() => autorizarPortal("download", { externos: ["empreiteiro"], interna: "documentos.ver" }), ForbiddenError);
  assert.equal(limites.length, limitesAntes);
  assert.equal(consultasPermissoes, 0);
  await autorizarPortal("download", { externos: ["cliente"] });
  await autorizarPortal("foto", { externos: ["cliente"], interna: "atualizacoes.ver" });
  assert.equal(consultasPermissoes, 0);
  papel = "equipe";
  // Equipe entra por `interna`, nunca por `externos`.
  permissoesDaConta = ["atualizacoes.ver"];
  await autorizarPortal("foto", { externos: ["cliente"], interna: "atualizacoes.ver" });
  await assert.rejects(() => autorizarPortal("foto", { externos: ["cliente"] }), ForbiddenError);
  await assert.rejects(() => autorizarPortal("foto", { externos: ["cliente"], interna: "documentos.ver" }), ForbiddenError);
  permissoesDaConta = [...PERMISSOES];
  papel = "cliente";
  invalidarPortal();
  assert.deepEqual(invalidacoes, [["/cliente", "layout"], ["/empreiteiro", "layout"], ["/fornecedor", "layout"], ["/adm-interno/(protegido)/portal", "layout"]]);

  const eventos = [];
  const autorizacoes = [];
  let falharLogInjetado = false;
  const dependencias = {
    autorizar: async (...args) => { autorizacoes.push(args); return { user: { id: usuarioId }, perfil: { papel: "cliente" } }; },
    criarSessao: async () => sessaoAtual,
    assinarUrl: async (...args) => { eventos.push(["storage", ...args]); return "https://storage.invalid/assinado"; },
    assinarUrlDocumento: async (...args) => { eventos.push(["r2", ...args]); return "https://r2.invalid/assinado"; },
    registrarDownload: async (registro) => { eventos.push(["log", registro]); if (falharLogInjetado) throw new Error("Falha simulada"); },
    hashIp: () => null,
    agora: () => new Date(instante),
  };
  function conferirCabecalhos(resposta) {
    assert.equal(resposta.headers.get("Cache-Control"), "private, no-store");
    assert.equal(resposta.headers.get("Referrer-Policy"), "no-referrer");
  }
  async function entregar(dados, tipo = "documento") {
    sessaoAtual = simularSessao(dados);
    eventos.length = 0;
    const resposta = await entregarArquivoPrivado(request, tipo, registroId, dependencias);
    conferirCabecalhos(resposta);
    assert.deepEqual(sessaoAtual.chamadas.at(-1), ["eq", "id", registroId]);
    if (tipo !== "relato_foto") assert.match(sessaoAtual.chamadas[1][1], /empreendimento_id/);
    return resposta;
  }
  const ausente = await entregar(null);
  assert.equal(ausente.status, 404);
  assert.equal(eventos.length, 0);
  const oculto = await entregar({ ...documento, liberado_cliente: false });
  assert.equal(oculto.status, 404);
  assert.equal(await oculto.text(), await ausente.text());
  assert.equal(eventos.length, 0);
  assert.equal((await entregar({ ...documento, mime: "application/zip" })).status, 404);
  assert.equal((await entregar({ ...documento, storage_path: `${paiId}/arquivo.pdf` })).status, 404);
  falharLogInjetado = true;
  const semLog = await entregar(documento);
  assert.equal(semLog.status, 500);
  assert.equal(semLog.headers.get("Location"), null);
  assert.ok(!(await semLog.text()).includes("https://"));
  falharLogInjetado = false;
  autorizacoes.length = 0;
  const sucesso = await entregar(documento);
  assert.deepEqual(autorizacoes, [["download", { externos: ["cliente"], interna: "documentos.ver" }]]);
  assert.equal(sucesso.status, 307);
  assert.equal(sucesso.headers.get("Location"), "https://r2.invalid/assinado");
  assert.deepEqual(eventos, [
    ["r2", documento.storage_path, 60, "Planta Ação nº 1 2.pdf"],
    ["log", { arquivo_tipo: "documento", arquivo_id: registroId, profile_id: usuarioId, ip_hash: null, em: "2026-10-28T12:00:00.000Z" }],
  ]);
  // SIMO: o cliente não baixa (404 igual ao padrão, sem assinar nem registrar nada) e só visualiza; o Laudo baixa como os demais.
  const corpoDo404 = await (await entregar(null)).text();
  const simoLiberado = { ...documento, equipamento: "BOMBAS", equipamento_papel: "simo" };
  const laudoLiberado = { ...documento, equipamento: "BOMBAS", equipamento_papel: "laudo" };
  const simoBaixado = await entregar(simoLiberado);
  assert.equal(simoBaixado.status, 404);
  assert.equal(await simoBaixado.text(), corpoDo404);
  assert.equal(simoBaixado.headers.get("Location"), null);
  assert.equal(eventos.length, 0);
  assert.equal((await entregar(laudoLiberado)).status, 307);
  assert.equal((await entregar({ ...documento, equipamento: null, equipamento_papel: null })).status, 307, "documento comum com os campos nulos");

  async function visualizar(dados, id = registroId, deps = dependencias) {
    sessaoAtual = simularSessao(dados);
    eventos.length = 0;
    const resposta = await entregarVisualizacaoDeSimo(request, id, deps);
    conferirCabecalhos(resposta);
    return resposta;
  }
  autorizacoes.length = 0;
  const visualizada = await visualizar(simoLiberado);
  assert.equal(visualizada.status, 200);
  assert.deepEqual(await visualizada.json(), { url: "https://r2.invalid/assinado" });
  assert.deepEqual(autorizacoes, [["download", { externos: ["cliente"], interna: "documentos.ver" }]]);
  assert.deepEqual(sessaoAtual.chamadas.at(-1), ["eq", "id", registroId]);
  assert.deepEqual(eventos, [
    ["r2", documento.storage_path, 60, "Planta Ação nº 1 2.pdf", false],
    ["log", { arquivo_tipo: "documento", arquivo_id: registroId, profile_id: usuarioId, ip_hash: null, em: "2026-10-28T12:00:00.000Z" }],
  ], "URL inline de 60 s e registro em downloads_log");
  const laudoVisualizado = await visualizar(laudoLiberado);
  assert.equal(laudoVisualizado.status, 200, "Laudo liberado também se visualiza");
  assert.deepEqual(await laudoVisualizado.json(), { url: "https://r2.invalid/assinado" });
  assert.equal((await visualizar({ ...laudoLiberado, liberado_cliente: false })).status, 404, "Laudo oculto não se visualiza");
  for (const [rotulo, dados] of [
    ["documento comum", documento], ["SIMO oculto", { ...simoLiberado, liberado_cliente: false }],
    ["SIMO de outro tipo de arquivo", { ...simoLiberado, mime: "application/zip" }], ["SIMO fora da pasta do empreendimento", { ...simoLiberado, storage_path: `${paiId}/arquivo.pdf` }],
    ["ausente", null],
  ]) {
    const negada = await visualizar(dados);
    assert.equal(negada.status, 404, rotulo);
    assert.equal(await negada.text(), corpoDo404, `${rotulo}: mesmo corpo do 404 padrão`);
    assert.equal(eventos.length, 0, `${rotulo}: nada assinado nem registrado`);
  }
  assert.equal((await visualizar(simoLiberado, "nao-uuid")).status, 404);
  falharLogInjetado = true;
  const visualizacaoSemLog = await visualizar(simoLiberado);
  assert.equal(visualizacaoSemLog.status, 500, "sem registro não entrega a URL");
  assert.ok(!(await visualizacaoSemLog.text()).includes("https://"));
  falharLogInjetado = false;
  // A equipe baixa o SIMO normalmente e visualiza mesmo oculto; documento que não é SIMO nem Laudo continua 404 para ela também.
  const dependenciasDaEquipe = { ...dependencias, autorizar: async () => ({ user: { id: usuarioId }, perfil: { papel: "equipe" } }) };
  sessaoAtual = simularSessao({ ...simoLiberado, liberado_cliente: false });
  assert.equal((await entregarArquivoPrivado(request, "documento", registroId, dependenciasDaEquipe)).status, 307, "equipe baixa o SIMO");
  assert.equal((await visualizar({ ...simoLiberado, liberado_cliente: false }, registroId, dependenciasDaEquipe)).status, 200);
  assert.equal((await visualizar(laudoLiberado, registroId, dependenciasDaEquipe)).status, 200, "equipe visualiza o Laudo");
  assert.equal((await visualizar(documento, registroId, dependenciasDaEquipe)).status, 404);

  const fotoAtualizacao = { id: registroId, mime: "image/jpeg", storage_path: `atualizacoes/${empreendimentoId}/${paiId}/${registroId}.jpg`,
    atualizacoes: { id: paiId, publicado: false, empreendimento_id: empreendimentoId } };
  assert.equal((await entregar(fotoAtualizacao, "atualizacao_foto")).status, 404);
  assert.equal(eventos.length, 0);
  fotoAtualizacao.atualizacoes.publicado = true;
  assert.equal((await entregar(fotoAtualizacao, "atualizacao_foto")).status, 307);
  assert.deepEqual(eventos, [["storage", "obras", fotoAtualizacao.storage_path, 60, false]]);
  const fotoRelato = { id: registroId, mime: "image/jpeg", storage_path: `relatos/${empreendimentoId}/${paiId}/${registroId}.jpg`,
    relatos_obra: { id: paiId, status: "pendente", obras: { id: empreendimentoId, empreendimentos: { id: empreendimentoId } } } };
  assert.equal((await entregar(fotoRelato, "relato_foto")).status, 404);
  assert.equal(eventos.length, 0);
  fotoRelato.relatos_obra.status = "aprovado";
  assert.equal((await entregar(fotoRelato, "relato_foto")).status, 307);
  assert.deepEqual(eventos, [["storage", "obras", fotoRelato.storage_path, 60, false]]);

  sessaoAtual = simularSessao(null);
  acessosAdmin = 0;
  assert.equal((await entregarArquivoPrivado(request, "documento", registroId)).status, 404);
  assert.equal(acessosAdmin, 0);
  sessaoAtual = simularSessao(documento, { code: "TEST_DB", status: 503 });
  assert.equal((await entregarArquivoPrivado(request, "documento", registroId)).status, 500);
  assert.equal(acessosAdmin, 0);
  sessaoAtual = simularSessao(documento);
  falhaStorage = true;
  eventosPadrao.length = 0;
  const semStorage = await entregarArquivoPrivado(request, "documento", registroId);
  assert.equal(semStorage.status, 500);
  assert.equal(semStorage.headers.get("Location"), null);
  assert.equal(eventosPadrao.length, 1);
  falhaStorage = false;
  falhaLog = true;
  assert.equal((await entregarArquivoPrivado(request, "documento", registroId)).headers.get("Location"), null);
  falhaLog = false;
  eventosPadrao.length = 0;
  const padrao = await entregarArquivoPrivado(request, "documento", registroId);
  assert.equal(padrao.status, 307);
  conferirCabecalhos(padrao);
  assert.deepEqual(eventosPadrao[0], ["r2", entrada.path, 60, { nomeArquivo: "Planta Ação nº 1 2.pdf", anexo: true }]);
  assert.equal(eventosPadrao[1][1].ip_hash, "a".repeat(64));
  papel = "fornecedor";
  assert.equal((await entregarArquivoPrivado(request, "documento", registroId)).status, 403);
  const tipos = ["documento", "atualizacao_foto", "relato_foto", "fornecedor_documento", "fornecedor_contrato"];
  for (const papelTeste of ["cliente", "empreiteiro", "fornecedor", "equipe", "admin"]) {
    papel = papelTeste;
    for (const tipo of tipos) {
      const permitidos = tipo.startsWith("fornecedor_") ? ["fornecedor", "equipe", "admin"]
        : tipo === "relato_foto" ? ["cliente", "empreiteiro", "equipe", "admin"] : ["cliente", "equipe", "admin"];
      const dados = tipo === "documento" ? documento : tipo === "atualizacao_foto" ? fotoAtualizacao : tipo === "relato_foto"
        ? { ...fotoRelato, relatos_obra: { id: paiId, status: "aprovado", obras: { id: empreendimentoId } } }
        : { id: registroId, fornecedor_id: paiId, mime: "application/pdf", storage_path: `${paiId}/${tipo === "fornecedor_contrato" ? "contratos" : "documentos"}/${registroId}.pdf` };
      sessaoAtual = simularSessao(dados);
      eventosPadrao.length = 0;
      const resposta = await entregarArquivoPrivado(request, tipo, registroId);
      conferirCabecalhos(resposta);
      assert.equal(resposta.status, permitidos.includes(papel) ? 307 : 403, `${papel}: ${tipo}`);
      if (!permitidos.includes(papel)) { assert.equal(eventosPadrao.length, 0); continue; }
      const foto = tipo.endsWith("_foto");
      assert.equal(eventosPadrao.length, foto ? 1 : 2);
      if (!foto) assert.equal(eventosPadrao[1][1].arquivo_tipo, tipo);
      if (tipo.startsWith("fornecedor_")) {
        assert.deepEqual(eventosPadrao[0], ["storage", "fornecedores", dados.storage_path, 60, { download: true }]);
        sessaoAtual = simularSessao({ ...dados, storage_path: `outro/${dados.storage_path}` });
        assert.equal((await entregarArquivoPrivado(request, tipo, registroId)).status, 404);
        sessaoAtual = simularSessao(null);
        assert.equal((await entregarArquivoPrivado(request, tipo, registroId)).status, 404);
      }
    }
  }
  // Equipe baixa só o arquivo do módulo em que tem `ver`; sem nenhuma permissão, nada sai nem é registrado.
  const permissaoPorTipo = { documento: "documentos.ver", atualizacao_foto: "atualizacoes.ver", relato_foto: "obras.ver", fornecedor_documento: "fornecedores.ver", fornecedor_contrato: "fornecedores.ver" };
  const dadosPorTipo = (tipo) => tipo === "documento" ? documento : tipo === "atualizacao_foto" ? fotoAtualizacao : tipo === "relato_foto"
    ? { ...fotoRelato, relatos_obra: { id: paiId, status: "aprovado", obras: { id: empreendimentoId } } }
    : { id: registroId, fornecedor_id: paiId, mime: "application/pdf", storage_path: `${paiId}/${tipo === "fornecedor_contrato" ? "contratos" : "documentos"}/${registroId}.pdf` };
  papel = "equipe";
  for (const concedidas of [[], ...Object.values(permissaoPorTipo).map((permissao) => [permissao]), ["documentos.editar", "documentos.liberar", "painel.servidor"]]) {
    permissoesDaConta = concedidas;
    for (const tipo of tipos) {
      sessaoAtual = simularSessao(dadosPorTipo(tipo));
      eventosPadrao.length = 0;
      const resposta = await entregarArquivoPrivado(request, tipo, registroId);
      conferirCabecalhos(resposta);
      const permitido = concedidas.includes(permissaoPorTipo[tipo]);
      assert.equal(resposta.status, permitido ? 307 : 403, `equipe [${concedidas.join(",")}]: ${tipo}`);
      if (!permitido) {
        assert.equal(eventosPadrao.length, 0);
        assert.equal(sessaoAtual.chamadas.length, 0);
      }
    }
  }
  permissoesDaConta = [...PERMISSOES];
  papel = "empreiteiro";
  sessaoAtual = simularSessao({ ...fotoRelato, relatos_obra: { id: paiId, status: "pendente", obras: { id: empreendimentoId } } });
  assert.equal((await entregarArquivoPrivado(request, "relato_foto", registroId)).status, 307);
  assert.ok(!sessaoAtual.chamadas[1][1].includes("empreendimentos"));
  sessaoAtual = simularSessao(null);
  assert.equal((await entregarArquivoPrivado(request, "relato_foto", registroId)).status, 404);
  papel = "equipe";
  sessaoAtual = simularSessao({ ...documento, liberado_cliente: false });
  assert.equal((await entregarArquivoPrivado(request, "documento", registroId)).status, 307);
  falhaGuard = true;
  const semSessao = await entregarArquivoPrivado(request, "documento", registroId);
  assert.equal(semSessao.status, 401);
  conferirCabecalhos(semSessao);
  falhaGuard = false;
  const invalido = await entregarArquivoPrivado(request, "documento", "nao-uuid");
  assert.equal(invalido.status, 404);
  conferirCabecalhos(invalido);

  const { obterEmpreendimento, listarEmpreendimentos } = carregar("src/lib/portal/comum/consultas.ts");
  const resumo = { id: empreendimentoId, nome: "Teste", cidade: null, situacao: "arquivado" };
  sessaoAtual = simularSessao(resumo);
  assert.deepEqual(await obterEmpreendimento(empreendimentoId), resumo);
  sessaoAtual = simularSessao(null);
  assert.equal(await obterEmpreendimento(empreendimentoId), null);
  sessaoAtual = simularSessao(null, { code: "TEST_DB" });
  await assert.rejects(() => obterEmpreendimento(empreendimentoId));
  const paginas = [];
  sessaoAtual = { from(tabela) {
    assert.equal(tabela, "empreendimentos");
    return { select(campos) { assert.equal(campos, "id,nome,cidade,situacao"); return this; }, order() { return this; },
      async range(inicio, fim) { paginas.push([inicio, fim]); return { error: null, data: inicio === 0 ? Array.from({ length: 100 }, () => resumo) : [resumo] }; } };
  } };
  assert.equal((await listarEmpreendimentos()).length, 101);
  assert.deepEqual(paginas, [[0, 99], [100, 199]]);
  const contas = carregar("src/lib/portal/comum/contas.ts");
  const schemasContas = carregar("src/lib/portal/comum/contas-schema.ts");
  const clientes = carregar("src/app/api/(modules)/adm-interno/portal/clientes/service.ts");
  const criarEntrada = { nome: "Conta Teste", telefone: null, identificador: "usuario.teste", senha: "SenhaTeste123", papel: "admin" };
  const atualizarEntrada = { id: registroId, nome: "Nome atualizado", telefone: "123", ativo: false, papel: "admin", senha: "nao-deve-ir", precisa_trocar_senha: false };
  assert.ok(!("papel" in schemasContas.criarContaSchema.parse(criarEntrada)));
  assert.deepEqual(Object.keys(schemasContas.atualizarContaSchema.parse(atualizarEntrada)).sort(), ["ativo", "id", "nome", "telefone"]);
  for (const senha of ["curta1", "somenteletras", "123456789012", "a1".repeat(65)]) {
    assert.equal(schemasContas.criarContaSchema.safeParse({ ...criarEntrada, senha }).success, false);
  }
  assert.equal(contas.identificadorParaEmail(" Usuario.Teste "), "usuario.teste@acesso.abaconsultorias.com.br");
  assert.equal(clientes.identificadorClienteParaEmail("Teste@EXAMPLE.com"), "teste@example.com");
  const eventosContas = [];
  let erroAuth = null;
  let erroPerfil = null;
  let erroAuditoria = null;
  let erroCompensacao = null;
  adminContas = {
    auth: { admin: {
      async createUser(dados) { eventosContas.push(["auth", dados]); return { data: { user: erroAuth ? null : { id: registroId } }, error: erroAuth }; },
      async deleteUser(id) { eventosContas.push(["desfazer", id]); return { error: erroCompensacao }; },
    } },
    from(tabela) {
      return {
        async insert(dados) { eventosContas.push(["insert", tabela, dados]); return { error: tabela === "profiles" ? erroPerfil : erroAuditoria }; },
        update(dados) {
          eventosContas.push(["update", tabela, dados]);
          return { eq(campo, valor) { eventosContas.push(["eq", campo, valor]); return this; }, select() { return this; }, async maybeSingle() { return { data: { id: registroId }, error: null }; } };
        },
      };
    },
  };
  const perfilConta = { id: registroId, nome: "Conta", telefone: null, ativo: true, precisa_trocar_senha: true };
  for (const papelConta of ["cliente", "empreiteiro", "fornecedor"]) {
    eventosContas.length = 0;
    assert.deepEqual(await contas.criarConta(papelConta, criarEntrada, usuarioId), { id: registroId });
    assert.equal(eventosContas[0][1].email_confirm, true);
    const perfilCriado = eventosContas.find((e) => e[0] === "insert" && e[1] === "profiles")[2];
    assert.equal(perfilCriado.papel, papelConta);
    assert.equal(perfilCriado.ativo, true);
    assert.equal(perfilCriado.precisa_trocar_senha, true);
    assert.ok(!("senha" in perfilCriado));
    assert.equal(eventosContas.find((e) => e[1] === "auditoria")[2].ator_id, usuarioId);
    sessaoAtual = simularSessao(perfilConta);
    eventosContas.length = 0;
    await contas.atualizarConta(papelConta, atualizarEntrada, usuarioId);
    assert.ok(sessaoAtual.chamadas.some((e) => e[0] === "eq" && e[1] === "papel" && e[2] === papelConta));
    assert.deepEqual(eventosContas[0], ["update", "profiles", { nome: "Nome atualizado", telefone: "123", ativo: false }]);
    assert.ok(eventosContas.some((e) => e[0] === "eq" && e[1] === "papel" && e[2] === papelConta));
    sessaoAtual = simularSessao(null);
    eventosContas.length = 0;
    await assert.rejects(() => contas.atualizarConta(papelConta, atualizarEntrada, usuarioId), (erro) => erro.status === 404);
    assert.equal(eventosContas.length, 0);
    sessaoAtual = { from(tabela) {
      assert.equal(tabela, "profiles");
      return { select() { return this; }, eq(campo, valor) { assert.equal(campo, "papel"); assert.equal(valor, papelConta); return this; }, order() { return this; },
        async range(inicio, fim) { assert.deepEqual([inicio, fim], [0, 50]); return { data: [perfilConta], error: null }; } };
    } };
    assert.deepEqual(await contas.listarContas(papelConta), { registros: [{ id: registroId, nome: "Conta", telefone: null, ativo: true, precisaTrocarSenha: true }], proximaPagina: null });
    if (papelConta === "cliente") assert.deepEqual((await clientes.listar({ pagina: 1, limite: 50 })).registros, [perfilConta]);
  }
  await assert.rejects(() => contas.criarConta("admin", criarEntrada, usuarioId));
  await assert.rejects(() => contas.atualizarConta("equipe", atualizarEntrada, usuarioId));
  eventosContas.length = 0;
  await clientes.criar(criarEntrada, usuarioId);
  assert.equal(eventosContas.find((e) => e[1] === "profiles")[2].papel, "cliente");
  erroAuth = { code: "email_exists", message: "segredo-que-nao-pode-vazar", status: 422 };
  eventosContas.length = 0;
  await assert.rejects(() => contas.criarConta("fornecedor", criarEntrada, usuarioId), (erro) => erro.status === 409 && !JSON.stringify(erro).includes(erroAuth.message));
  assert.equal(eventosContas.length, 1);
  erroAuth = null;
  erroPerfil = { code: "23505" };
  eventosContas.length = 0;
  await assert.rejects(() => contas.criarConta("empreiteiro", criarEntrada, usuarioId));
  assert.deepEqual(eventosContas.at(-1), ["desfazer", registroId]);
  erroPerfil = null;
  erroAuditoria = { code: "TEST_AUDIT" };
  eventosContas.length = 0;
  await assert.rejects(() => contas.criarConta("cliente", criarEntrada, usuarioId));
  assert.equal(eventosContas.filter((e) => e[1] === "auditoria").length, 3);
  assert.deepEqual(eventosContas.at(-1), ["desfazer", registroId]);
  erroCompensacao = { code: "TEST_AUTH", status: 503 };
  await assert.rejects(() => contas.criarConta("cliente", criarEntrada, usuarioId), (erro) => String(erro.details).includes("reconciliar"));
  erroCompensacao = null;
  sessaoAtual = simularSessao(perfilConta);
  eventosContas.length = 0;
  await assert.rejects(() => contas.atualizarConta("cliente", atualizarEntrada, usuarioId), (erro) => String(erro.details).includes("auditoria"));
  assert.ok(!eventosContas.some((e) => e[0] === "desfazer"));
  adminContas = undefined;
  const { enviarArquivoAssinado } = carregar("src/components/portal/comum/enviarArquivoAssinado.ts");
  const arquivo = new Blob(["%PDF-teste"], { type: "application/pdf" });
  let envioCapturado;
  globalThis.fetch = async (url, opcoes) => { envioCapturado = { url, opcoes }; return new Response(null, { status: 200 }); };
  const signal = new AbortController().signal;
  await enviarArquivoAssinado({ signedUrl: "https://storage.invalid/upload?token=simulado", arquivo, mime: "application/pdf", signal });
  assert.equal(envioCapturado.opcoes.method, "PUT");
  assert.equal(envioCapturado.opcoes.headers["x-upsert"], "false");
  assert.equal(envioCapturado.opcoes.headers["Content-Type"], "application/pdf");
  assert.equal(envioCapturado.opcoes.body, arquivo);
  assert.equal(envioCapturado.opcoes.signal, signal);
  assert.equal(envioCapturado.opcoes.credentials, "omit");
  assert.equal(envioCapturado.opcoes.redirect, "error");
  globalThis.fetch = async () => new Response(null, { status: 503 });
  await assert.rejects(() => enviarArquivoAssinado({ signedUrl: "https://storage.invalid/upload", arquivo, mime: "application/pdf" }));
  await assert.rejects(() => enviarArquivoAssinado({ signedUrl: "javascript:alert(1)", arquivo, mime: "application/pdf" }));
  globalThis.fetch = async () => { throw new Error("Rede proibida neste teste."); };
  assert.ok(logs.every((args) => args.length <= 3));
  console.log("OK: comprovantes das Etapas 4/5; papéis e limites; arquivos privados e downloads; consultas e invalidação; contas com papel fixo, compatibilidade clientes, auditoria e compensação. Sem rede/Supabase.");
} finally {
  if (envAnterior === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = envAnterior;
  globalThis.fetch = fetchAnterior;
  console.error = consoleAnterior;
}
