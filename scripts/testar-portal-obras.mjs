import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import ts from "typescript";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const modulos = new Map();
const usuarioId = "11111111-1111-4111-8111-111111111111";
const outroUsuarioId = "99999999-9999-4999-8999-999999999999";
const obraId = "22222222-2222-4222-8222-222222222222";
const outraObraId = "33333333-3333-4333-8333-333333333333";
const relatoId = "44444444-4444-4444-8444-444444444444";
const outroRelatoId = "55555555-5555-4555-8555-555555555555";
const chamadasContas = [];

const substitutos = {
  "server-only": {},
  "react": { cache: (fn) => fn },
  "@/lib/supabase/server": { createClient: async () => { throw new Error("Sessão real proibida neste teste."); } },
  "@/lib/supabase/admin": { createAdminClient: () => { throw new Error("Client admin proibido neste teste."); } },
  "@/lib/portal/comum/contas": {
    listarContas: async (...args) => { chamadasContas.push(["listar", ...args]); return { registros: [], proximaPagina: null }; },
    criarConta: async (...args) => { chamadasContas.push(["criar", ...args]); return { id: usuarioId }; },
    atualizarConta: async (...args) => { chamadasContas.push(["atualizar", ...args]); return { id: usuarioId }; },
  },
};

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
    if (nome.startsWith(".")) return carregar(`${resolve(dirname(arquivo), nome)}.ts`);
    return require(nome);
  };
  runInThisContext(`(function(require, module, exports) {${codigo}\n})`, { filename: arquivo })(importar, modulo, modulo.exports);
  return modulo.exports;
}

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3, 0xff, 0xd9]);
function png() {
  const b = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  return Uint8Array.from(b);
}
const fluxo = (bytes) => new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });

// Sessão simulada: cada tabela responde ao encadeamento usado pelos serviços.
function simularSessao({ obra = { id: obraId }, relato = null, referencias = [], rpc = { data: relatoId, error: null } } = {}) {
  const chamadas = [];
  const sessao = {
    chamadas,
    from(tabela) {
      chamadas.push(["from", tabela]);
      const consulta = {
        select() { return consulta; },
        eq() { return consulta; },
        in() { return Promise.resolve({ data: referencias.map((storage_path) => ({ storage_path })), error: null }); },
        maybeSingle: async () => ({ data: tabela === "obras" ? obra : relato, error: null }),
      };
      return consulta;
    },
    async rpc(nome, argumentos) { chamadas.push(["rpc", nome, argumentos]); return rpc; },
  };
  return sessao;
}

function simularDependencias(sessao, objetos = new Map()) {
  const apagados = [];
  const lidos = [];
  return {
    apagados, lidos,
    sessao: async () => sessao,
    assinar: async (path) => ({ path, signedUrl: `https://storage.invalid/${path}?token=t`, token: "t" }),
    lerObjeto: async (path) => {
      lidos.push(path);
      const objeto = objetos.get(path);
      if (typeof objeto === "function") return objeto();
      if (!objeto) { const { BadRequestError } = carregar("src/app/api/HttpErrors.ts"); throw new BadRequestError("Uma foto não chegou ao armazenamento. Envie novamente."); }
      return { mime: objeto.mime, stream: fluxo(objeto.bytes) };
    },
    apagar: async (paths) => { apagados.push(...paths); },
  };
}

const envAnterior = process.env.SUPABASE_SECRET_KEY;
const consoleAnterior = console.error;
const logs = [];
process.env.SUPABASE_SECRET_KEY = randomBytes(32).toString("hex");
console.error = (...args) => logs.push(args);
let total = 0;
async function teste(nome, corpo) {
  await corpo();
  total++;
  console.log(`ok - ${nome}`);
}

try {
  const { assinarComprovante } = carregar("src/lib/portal/comum/upload.ts");
  const { BadRequestError, ConflictError, ForbiddenError, InternalServerError, NotFoundError } = carregar("src/app/api/HttpErrors.ts");
  const regras = carregar("src/lib/portal/obras/regras.ts");
  const { conferirErro } = carregar("src/lib/portal/obras/erros.ts");
  const { enviarSchema } = carregar("src/app/api/(modules)/portal/empreiteiro/relatos/schema.ts");
  const { enviar } = carregar("src/app/api/(modules)/portal/empreiteiro/relatos/service.ts");
  const { assinarSchema } = carregar("src/app/api/(modules)/portal/empreiteiro/relatos/upload/assinar/schema.ts");
  const { assinar } = carregar("src/app/api/(modules)/portal/empreiteiro/relatos/upload/assinar/service.ts");
  const relatosAdmin = carregar("src/app/api/(modules)/adm-interno/portal/relatos/schema.ts");
  const obrasAdmin = carregar("src/app/api/(modules)/adm-interno/portal/obras/schema.ts");
  const empreiteirosAdmin = carregar("src/app/api/(modules)/adm-interno/portal/empreiteiros/schema.ts");
  const empreiteirosServico = carregar("src/app/api/(modules)/adm-interno/portal/empreiteiros/service.ts");

  // Foto assinada como o endpoint de assinatura faria: path e metadados coerentes com a obra e o relato.
  function foto({ id, mime = "image/jpeg", tamanho = jpeg.length, ordem = 0, obra = obraId, relato = relatoId, usuario = usuarioId, relogio } = {}) {
    const registroId = id ?? `aaaaaaaa-aaaa-4aaa-8aaa-${String(ordem).padStart(12, "0")}`;
    const extensao = { "image/jpeg": "jpg", "image/png": "png" }[mime];
    const path = `relatos/${obra}/${relato}/${registroId}.${extensao}`;
    const comprovante = assinarComprovante({ finalidade: "relato_foto", usuarioId: usuario, registroId, bucket: "obras", path, mime, tamanho, metadados: { obraId: obra, relatoId: relato, ordem } }, relogio);
    return { registroId, path, comprovante, mime, tamanho };
  }
  const corpo = (fotos, extra = {}) => ({ obraId, relatoId, texto: "Concluímos a laje do segundo pavimento.", percentualInformado: 40, situacaoInformada: "em_andamento", comprovantes: fotos.map((f) => f.comprovante), ...extra });
  const objetosDe = (fotos, bytes = jpeg) => new Map(fotos.map((f) => [f.path, { mime: f.mime, bytes }]));

  await teste("schema de envio: limites de texto, percentual, situação e comprovantes", () => {
    const fotos = [foto({ ordem: 0 })];
    assert.equal(enviarSchema.safeParse(corpo(fotos)).success, true);
    assert.equal(enviarSchema.safeParse(corpo([])).success, true);
    assert.equal(enviarSchema.safeParse(corpo(fotos, { percentualInformado: null, situacaoInformada: null })).success, true);
    assert.equal(enviarSchema.safeParse(corpo(fotos, { texto: "  a " })).success, false);
    assert.equal(enviarSchema.safeParse(corpo(fotos, { texto: "a".repeat(5001) })).success, false);
    assert.equal(enviarSchema.safeParse(corpo(fotos, { percentualInformado: 101 })).success, false);
    assert.equal(enviarSchema.safeParse(corpo(fotos, { percentualInformado: -1 })).success, false);
    assert.equal(enviarSchema.safeParse(corpo(fotos, { percentualInformado: 10.5 })).success, false);
    assert.equal(enviarSchema.safeParse(corpo(fotos, { situacaoInformada: "pausada" })).success, false);
    assert.equal(enviarSchema.safeParse(corpo(fotos, { obraId: "nao-e-uuid" })).success, false);
  });

  await teste("schema de envio: no máximo 10 comprovantes e nenhum repetido", () => {
    const onze = Array.from({ length: 11 }, (_, i) => foto({ ordem: i % 10, id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}` }));
    const dez = onze.slice(0, 10);
    assert.equal(enviarSchema.safeParse(corpo(dez)).success, true);
    assert.equal(enviarSchema.safeParse(corpo(onze)).success, false);
    const repetido = [dez[0], dez[0]];
    assert.equal(enviarSchema.safeParse(corpo(repetido)).success, false);
  });

  await teste("schema de assinatura: 1 a 10 fotos, MIME fechado e tamanho até 10 MiB", () => {
    const um = { mime: "image/jpeg", tamanho: 1 };
    assert.equal(assinarSchema.safeParse({ obraId, fotos: [um] }).success, true);
    assert.equal("relatoId" in assinarSchema.parse({ obraId, relatoId, fotos: [um] }), false);
    assert.equal(assinarSchema.safeParse({ obraId, fotos: [] }).success, false);
    assert.equal(assinarSchema.safeParse({ obraId, fotos: Array(11).fill(um) }).success, false);
    assert.equal(assinarSchema.safeParse({ obraId, fotos: Array(10).fill(um) }).success, true);
    assert.equal(assinarSchema.safeParse({ obraId, fotos: [{ mime: "application/pdf", tamanho: 10 }] }).success, false);
    assert.equal(assinarSchema.safeParse({ obraId, fotos: [{ mime: "image/gif", tamanho: 10 }] }).success, false);
    assert.equal(assinarSchema.safeParse({ obraId, fotos: [{ mime: "image/png", tamanho: 10485761 }] }).success, false);
    assert.equal(assinarSchema.safeParse({ obraId, fotos: [{ mime: "image/png", tamanho: 10485760 }] }).success, true);
    assert.equal(assinarSchema.safeParse({ obraId, fotos: [{ mime: "image/png", tamanho: 0 }] }).success, false);
    assert.equal(assinarSchema.safeParse({ obraId: "x", fotos: [um] }).success, false);
  });

  await teste("assinatura: gera relatoId, paths por obra/relato e comprovantes válidos", async () => {
    const sessao = simularSessao();
    const deps = simularDependencias(sessao);
    const resposta = await assinar({ obraId, fotos: [{ mime: "image/jpeg", tamanho: 10 }, { mime: "image/png", tamanho: 20 }] }, usuarioId, deps);
    assert.match(resposta.relatoId, /^[0-9a-f-]{36}$/);
    assert.equal(resposta.fotos.length, 2);
    const { validarComprovante } = carregar("src/lib/portal/comum/upload.ts");
    for (const item of resposta.fotos) {
      assert.match(item.path, new RegExp(`^relatos/${obraId}/${resposta.relatoId}/[0-9a-f-]{36}\\.(jpg|png)$`));
      const comprovante = validarComprovante(item.comprovante, usuarioId);
      assert.equal(comprovante.finalidade, "relato_foto");
      assert.equal(comprovante.bucket, "obras");
      assert.equal(comprovante.path, item.path);
      assert.equal(comprovante.metadados.relatoId, resposta.relatoId);
      assert.match(item.signedUrl, /^https:\/\//);
    }
    assert.throws(() => validarComprovante(resposta.fotos[0].comprovante, outroUsuarioId), BadRequestError);
    const ignorado = await assinar(assinarSchema.parse({ obraId, relatoId, fotos: [{ mime: "image/jpeg", tamanho: 10 }] }), usuarioId, simularDependencias(simularSessao()));
    assert.notEqual(ignorado.relatoId, relatoId);
    assert.ok(ignorado.fotos[0].path.startsWith(`relatos/${obraId}/${ignorado.relatoId}/`));
  });

  await teste("assinatura: obra inacessível vira 404", async () => {
    await assert.rejects(assinar({ obraId, fotos: [{ mime: "image/jpeg", tamanho: 10 }] }, usuarioId, simularDependencias(simularSessao({ obra: null }))), NotFoundError);
  });

  await teste("envio válido: confere os bytes de todas as fotos e chama a RPC com a sessão", async () => {
    const fotos = [foto({ ordem: 0 }), foto({ ordem: 1, mime: "image/png", tamanho: png().length })];
    const objetos = new Map([[fotos[0].path, { mime: "image/jpeg", bytes: jpeg }], [fotos[1].path, { mime: "image/png", bytes: png() }]]);
    const sessao = simularSessao();
    const deps = simularDependencias(sessao, objetos);
    const resposta = await enviar(corpo(fotos), usuarioId, deps);
    assert.deepEqual(resposta, { id: relatoId });
    assert.deepEqual(deps.lidos, fotos.map((f) => f.path));
    assert.deepEqual(deps.apagados, []);
    const rpc = sessao.chamadas.filter(([tipo]) => tipo === "rpc");
    assert.equal(rpc.length, 1);
    assert.equal(rpc[0][1], "enviar_relato_obra");
    assert.deepEqual(rpc[0][2].p_fotos, fotos.map((f) => ({ id: f.registroId, path: f.path, mime: f.mime, tamanho: f.tamanho })));
    assert.equal(rpc[0][2].p_obra, obraId);
    assert.equal(rpc[0][2].p_percentual, 40);
    assert.equal("autor_id" in rpc[0][2], false);
  });

  await teste("envio sem fotos é aceito e não toca no armazenamento", async () => {
    const sessao = simularSessao();
    const deps = simularDependencias(sessao);
    await enviar(corpo([]), usuarioId, deps);
    assert.deepEqual(deps.lidos, []);
    assert.equal(sessao.chamadas.some(([tipo]) => tipo === "rpc"), true);
  });

  await teste("comprovante de outra obra, de outro relato ou de outro usuário é recusado sem RPC", async () => {
    const casos = [
      foto({ obra: outraObraId }),
      foto({ relato: outroRelatoId }),
      foto({ usuario: outroUsuarioId }),
    ];
    for (const intruso of casos) {
      const sessao = simularSessao();
      const deps = simularDependencias(sessao, objetosDe([intruso]));
      await assert.rejects(enviar(corpo([intruso]), usuarioId, deps), BadRequestError);
      assert.equal(sessao.chamadas.some(([tipo]) => tipo === "rpc"), false);
      assert.deepEqual(deps.lidos, []);
    }
    const sessao = simularSessao();
    await assert.rejects(enviar(corpo([foto({ ordem: 0 })], { obraId: outraObraId }), usuarioId, simularDependencias(sessao)), BadRequestError);
  });

  await teste("comprovante de outra finalidade (documento) não vale como foto de relato", async () => {
    const documento = assinarComprovante({ finalidade: "documento", usuarioId, registroId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", bucket: "documentos", path: `${obraId}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf`, mime: "application/pdf", tamanho: 10, sha256: "a".repeat(64), metadados: { empreendimentoId: obraId, titulo: "Documento" } });
    await assert.rejects(enviar(corpo([]) && { ...corpo([]), comprovantes: [documento] }, usuarioId, simularDependencias(simularSessao())), BadRequestError);
  });

  await teste("comprovante adulterado, expirado ou inválido é recusado", async () => {
    const valido = foto({ ordem: 0 });
    const adulterado = `${valido.comprovante.slice(0, -3)}${valido.comprovante.endsWith("aaa") ? "bbb" : "aaa"}`;
    const expirado = foto({ ordem: 1, relogio: { agora: () => Date.now() - 31 * 60 * 1000 } });
    for (const token of [adulterado, expirado.comprovante, "lixo"]) {
      const sessao = simularSessao();
      await assert.rejects(enviar({ ...corpo([]), comprovantes: [token] }, usuarioId, simularDependencias(sessao)), BadRequestError);
      assert.equal(sessao.chamadas.some(([tipo]) => tipo === "rpc"), false);
    }
  });

  await teste("path que não segue relatos/<obra>/<relato>/<id>.<ext> é recusado já na assinatura", () => {
    const registroId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const base = { finalidade: "relato_foto", usuarioId, registroId, bucket: "obras", mime: "image/jpeg", tamanho: 10, metadados: { obraId, relatoId, ordem: 0 } };
    assert.throws(() => assinarComprovante({ ...base, path: `relatos/${obraId}/${relatoId}/${registroId}.png` }), BadRequestError);
    assert.throws(() => assinarComprovante({ ...base, path: `relatos/${outraObraId}/${relatoId}/${registroId}.jpg` }), BadRequestError);
    assert.throws(() => assinarComprovante({ ...base, path: `../relatos/${obraId}/${relatoId}/${registroId}.jpg` }), BadRequestError);
    assert.throws(() => assinarComprovante({ ...base, metadados: { obraId, relatoId, ordem: 10 }, path: `relatos/${obraId}/${relatoId}/${registroId}.jpg` }), BadRequestError);
  });

  await teste("foto com assinatura falsa: 400, nenhuma RPC e objeto apagado", async () => {
    const a = foto({ ordem: 0 });
    const falsa = foto({ ordem: 1 });
    const objetos = new Map([[a.path, { mime: "image/jpeg", bytes: jpeg }], [falsa.path, { mime: "image/jpeg", bytes: Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0]) }]]);
    const sessao = simularSessao();
    const deps = simularDependencias(sessao, objetos);
    await assert.rejects(enviar(corpo([a, falsa]), usuarioId, deps), BadRequestError);
    assert.equal(sessao.chamadas.some(([tipo]) => tipo === "rpc"), false);
    assert.deepEqual(deps.apagados.sort(), [a.path, falsa.path].sort());
  });

  await teste("foto truncada, com tamanho divergente ou MIME divergente: 400 e limpeza", async () => {
    const casos = {
      truncada: { foto: foto({ ordem: 0, tamanho: jpeg.length + 5 }), objeto: { mime: "image/jpeg", bytes: jpeg } },
      maiorQueODeclarado: { foto: foto({ ordem: 0, tamanho: jpeg.length - 2 }), objeto: { mime: "image/jpeg", bytes: jpeg } },
      mimeDivergente: { foto: foto({ ordem: 0 }), objeto: { mime: "image/png", bytes: jpeg } },
      vazia: { foto: foto({ ordem: 0, tamanho: 1 }), objeto: { mime: "image/jpeg", bytes: new Uint8Array(0) } },
      jpegSemFim: { foto: foto({ ordem: 0, tamanho: 6 }), objeto: { mime: "image/jpeg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]) } },
    };
    for (const [nome, { foto: item, objeto }] of Object.entries(casos)) {
      const sessao = simularSessao();
      const deps = simularDependencias(sessao, new Map([[item.path, objeto]]));
      await assert.rejects(enviar(corpo([item]), usuarioId, deps), BadRequestError, nome);
      assert.equal(sessao.chamadas.some(([tipo]) => tipo === "rpc"), false, nome);
      assert.deepEqual(deps.apagados, [item.path], nome);
    }
  });

  await teste("objeto ausente no armazenamento: 400 e limpeza dos demais", async () => {
    const presente = foto({ ordem: 0 });
    const ausente = foto({ ordem: 1 });
    const sessao = simularSessao();
    const deps = simularDependencias(sessao, objetosDe([presente]));
    await assert.rejects(enviar(corpo([presente, ausente]), usuarioId, deps), BadRequestError);
    assert.deepEqual(deps.apagados.sort(), [presente.path, ausente.path].sort());
  });

  await teste("limpeza nunca apaga foto já referenciada por um relato aceito", async () => {
    const a = foto({ ordem: 0 });
    const falsa = foto({ ordem: 1 });
    const objetos = new Map([[a.path, { mime: "image/jpeg", bytes: jpeg }], [falsa.path, { mime: "image/jpeg", bytes: Uint8Array.from([1, 2, 3]) }]]);
    const deps = simularDependencias(simularSessao({ referencias: [a.path] }), new Map(objetos));
    await assert.rejects(enviar(corpo([a, falsa]), usuarioId, deps), BadRequestError);
    assert.deepEqual(deps.apagados, [falsa.path]);
    const aceito = simularDependencias(simularSessao({ relato: { id: relatoId, obra_id: obraId, autor_id: outroUsuarioId, texto: "x", percentual_informado: null, situacao_informada: null, relato_fotos: [] } }), new Map(objetos));
    await assert.rejects(enviar(corpo([a, falsa]), usuarioId, aceito), ConflictError);
    assert.deepEqual(aceito.apagados, []);
  });

  await teste("falha transitória não apaga nada e o mesmo corpo pode ser repetido", async () => {
    const item = foto({ ordem: 0 });
    let tentativas = 0;
    const objetos = new Map([[item.path, () => { tentativas++; if (tentativas === 1) throw new InternalServerError("Não foi possível conferir as fotos."); return { mime: "image/jpeg", stream: fluxo(jpeg) }; }]]);
    const sessao = simularSessao();
    const deps = simularDependencias(sessao, objetos);
    await assert.rejects(enviar(corpo([item]), usuarioId, deps), InternalServerError);
    assert.deepEqual(deps.apagados, []);
    assert.equal(sessao.chamadas.some(([tipo]) => tipo === "rpc"), false);
    assert.deepEqual(await enviar(corpo([item]), usuarioId, deps), { id: relatoId });
    assert.equal(sessao.chamadas.filter(([tipo]) => tipo === "rpc").length, 1);
  });

  await teste("retry idempotente: relato já gravado igual devolve o id sem nova RPC nem leitura", async () => {
    const item = foto({ ordem: 0 });
    const gravado = { id: relatoId, obra_id: obraId, autor_id: usuarioId, texto: "Concluímos a laje do segundo pavimento.", percentual_informado: 40, situacao_informada: "em_andamento", relato_fotos: [{ id: item.registroId, storage_path: item.path, mime: item.mime, tamanho: String(item.tamanho) }] };
    const sessao = simularSessao({ relato: gravado });
    const deps = simularDependencias(sessao);
    assert.deepEqual(await enviar(corpo([item]), usuarioId, deps), { id: relatoId });
    assert.equal(sessao.chamadas.some(([tipo]) => tipo === "rpc"), false);
    assert.deepEqual(deps.lidos, []);
    assert.deepEqual(deps.apagados, []);
    for (const divergente of [{ ...gravado, texto: "Outro texto" }, { ...gravado, percentual_informado: 41 }, { ...gravado, relato_fotos: [] }, { ...gravado, autor_id: outroUsuarioId }]) {
      await assert.rejects(enviar(corpo([item]), usuarioId, simularDependencias(simularSessao({ relato: divergente }))), ConflictError);
    }
  });

  await teste("obra não atribuída (invisível pelo RLS) impede o envio", async () => {
    const sessao = simularSessao({ obra: null });
    const item = foto({ ordem: 0 });
    await assert.rejects(enviar(corpo([item]), usuarioId, simularDependencias(sessao, objetosDe([item]))), NotFoundError);
    assert.equal(sessao.chamadas.some(([tipo]) => tipo === "rpc"), false);
  });

  await teste("erro da RPC é traduzido pelo mapeamento fixo", async () => {
    for (const [code, tipo] of [["42501", ForbiddenError], ["54000", ConflictError], ["23514", BadRequestError], ["P0002", NotFoundError]]) {
      const sessao = simularSessao({ rpc: { data: null, error: { code, message: "detalhe interno com dados", status: 400 } } });
      await assert.rejects(enviar(corpo([]), usuarioId, simularDependencias(sessao)), (erro) => { assert.ok(erro instanceof tipo, code); assert.doesNotMatch(String(erro.message), /detalhe interno/); return true; });
    }
  });

  await teste("mapeamento de erros: 403, 404, 409, 409, 400 e 500 sem vazar detalhes", () => {
    assert.doesNotThrow(() => conferirErro(null));
    assert.throws(() => conferirErro({ code: "42501" }), ForbiddenError);
    assert.throws(() => conferirErro({ code: "P0002" }), NotFoundError);
    assert.throws(() => conferirErro({ code: "55000" }), ConflictError);
    assert.throws(() => conferirErro({ code: "54000" }), ConflictError);
    assert.throws(() => conferirErro({ code: "23514" }), BadRequestError);
    assert.throws(() => conferirErro({ code: "22P02" }), BadRequestError);
    assert.throws(() => conferirErro({ code: "23505" }), ConflictError);
    logs.length = 0;
    assert.throws(() => conferirErro({ code: "XX000", message: "senha=segredo", details: "dado pessoal", status: 500 }), InternalServerError);
    assert.equal(logs.length, 1);
    assert.doesNotMatch(JSON.stringify(logs[0]), /segredo|pessoal/);
  });

  await teste("revisão: aprovar exige percentual e situação; devolver exige motivo de 3 a 500", () => {
    const { atualizarSchema } = relatosAdmin;
    assert.equal(atualizarSchema.safeParse({ id: relatoId, acao: "aprovar", percentual: 55, situacao: "em_andamento" }).success, true);
    assert.equal(atualizarSchema.safeParse({ id: relatoId, acao: "aprovar", percentual: 0, situacao: "planejada" }).success, true);
    assert.equal(atualizarSchema.safeParse({ id: relatoId, acao: "aprovar", situacao: "em_andamento" }).success, false);
    assert.equal(atualizarSchema.safeParse({ id: relatoId, acao: "aprovar", percentual: 55 }).success, false);
    assert.equal(atualizarSchema.safeParse({ id: relatoId, acao: "aprovar", percentual: 101, situacao: "concluida" }).success, false);
    assert.equal(atualizarSchema.safeParse({ id: relatoId, acao: "devolver", motivo: "Faltam fotos da fachada." }).success, true);
    assert.equal(atualizarSchema.safeParse({ id: relatoId, acao: "devolver" }).success, false);
    assert.equal(atualizarSchema.safeParse({ id: relatoId, acao: "devolver", motivo: "   " }).success, false);
    assert.equal(atualizarSchema.safeParse({ id: relatoId, acao: "devolver", motivo: "ab" }).success, false);
    assert.equal(atualizarSchema.safeParse({ id: relatoId, acao: "devolver", motivo: "a".repeat(501) }).success, false);
    assert.equal(atualizarSchema.safeParse({ id: relatoId, acao: "excluir" }).success, false);
    assert.equal(atualizarSchema.safeParse({ id: "x", acao: "devolver", motivo: "Motivo válido" }).success, false);
    const aprovado = atualizarSchema.parse({ id: relatoId, acao: "aprovar", percentual: 55, situacao: "em_andamento", motivo: "ignorado" });
    assert.equal("motivo" in aprovado, false);
  });

  await teste("fila de relatos: status padrão pendente, filtros e paginação limitada", () => {
    const { consultaSchema } = relatosAdmin;
    assert.equal(consultaSchema.parse({}).status, "pendente");
    assert.equal(consultaSchema.parse({ status: "devolvido", obraId, pagina: "2", limite: "100" }).limite, 100);
    assert.equal(consultaSchema.safeParse({ status: "rascunho" }).success, false);
    assert.equal(consultaSchema.safeParse({ limite: "101" }).success, false);
    assert.equal(consultaSchema.safeParse({ obraId: "x" }).success, false);
  });

  await teste("cadastro de obra: nome, datas válidas, fim ≥ início e percentual 0–100", () => {
    const { criarSchema, atualizarSchema, excluirSchema } = obrasAdmin;
    const base = { empreendimentoId: obraId, nome: "Bloco A", previstoInicio: "2026-01-10", previstoFim: "2026-12-31", situacao: "em_andamento", percentual: 10 };
    assert.equal(criarSchema.safeParse(base).success, true);
    assert.equal(criarSchema.safeParse({ ...base, previstoInicio: null, previstoFim: null }).success, true);
    assert.equal(criarSchema.safeParse({ ...base, previstoFim: "2026-01-09" }).success, false);
    assert.equal(criarSchema.safeParse({ ...base, previstoFim: "2026-01-10" }).success, true);
    assert.equal(criarSchema.safeParse({ ...base, previstoInicio: "2026-02-30" }).success, false);
    assert.equal(criarSchema.safeParse({ ...base, nome: "A" }).success, false);
    assert.equal(criarSchema.safeParse({ ...base, percentual: 101 }).success, false);
    assert.equal(criarSchema.safeParse({ ...base, situacao: "pausada" }).success, false);
    const semEmpreendimento = { ...base };
    delete semEmpreendimento.empreendimentoId;
    assert.equal(atualizarSchema.safeParse({ id: obraId, ...semEmpreendimento }).success, true);
    assert.equal("empreendimentoId" in atualizarSchema.parse({ id: obraId, ...base }), false);
    assert.equal(excluirSchema.safeParse({ id: "x" }).success, false);
  });

  await teste("contas de empreiteiro: o papel nunca vem do corpo e é fixo no serviço", async () => {
    const entrada = { nome: "Maria Souza", identificador: "maria.souza", senha: "SenhaForte123", papel: "admin", role: "admin" };
    const criada = empreiteirosAdmin.criarSchema.parse(entrada);
    assert.equal("papel" in criada, false);
    assert.equal("role" in criada, false);
    const atualizada = empreiteirosAdmin.atualizarSchema.parse({ id: usuarioId, nome: "Maria", telefone: null, ativo: true, papel: "staff" });
    assert.equal("papel" in atualizada, false);
    await empreiteirosServico.criar(criada, outroUsuarioId);
    await empreiteirosServico.atualizar(atualizada, outroUsuarioId);
    await empreiteirosServico.listar({ pagina: 1 });
    assert.deepEqual(chamadasContas.map(([acao, papel]) => [acao, papel]), [["criar", "empreiteiro"], ["atualizar", "empreiteiro"], ["listar", "empreiteiro"]]);
    assert.equal(chamadasContas[0][3], outroUsuarioId);
  });

  await teste("regras: sugerirRevisao usa o informado e, se faltar, o oficial atual", () => {
    const obra = { percentual: 30, situacao: "em_andamento" };
    assert.deepEqual(regras.sugerirRevisao({ percentualInformado: 55, situacaoInformada: "concluida" }, obra), { percentual: 55, situacao: "concluida" });
    assert.deepEqual(regras.sugerirRevisao({ percentualInformado: null, situacaoInformada: null }, obra), { percentual: 30, situacao: "em_andamento" });
    assert.deepEqual(regras.sugerirRevisao({ percentualInformado: 0, situacaoInformada: null }, obra), { percentual: 0, situacao: "em_andamento" });
    assert.deepEqual(regras.sugerirRevisao({ percentualInformado: null, situacaoInformada: "planejada" }, obra), { percentual: 30, situacao: "planejada" });
  });

  await teste("regras: avisoDeConsistencia só avisa em concluída < 100% e planejada > 0%", () => {
    assert.match(regras.avisoDeConsistencia(80, "concluida"), /concluída/);
    assert.match(regras.avisoDeConsistencia(10, "planejada"), /planejada/);
    assert.equal(regras.avisoDeConsistencia(100, "concluida"), null);
    assert.equal(regras.avisoDeConsistencia(0, "planejada"), null);
    assert.equal(regras.avisoDeConsistencia(50, "em_andamento"), null);
    assert.equal(regras.avisoDeConsistencia(0, "em_andamento"), null);
  });

  await teste("regras: rótulos e limites do contrato", () => {
    assert.equal(regras.LIMITE_FOTOS_RELATO, 10);
    assert.equal(regras.LIMITE_PENDENTES_RELATO, 5);
    assert.equal(regras.rotuloStatus("pendente"), "Pendente");
    assert.equal(regras.rotuloStatus("aprovado"), "Aprovado");
    assert.equal(regras.rotuloStatus("devolvido"), "Devolvido");
    assert.equal(regras.rotuloSituacao("em_andamento"), "Em andamento");
  });

  console.log(`\n${total} testes passaram.`);
} finally {
  console.error = consoleAnterior;
  if (envAnterior === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = envAnterior;
}
