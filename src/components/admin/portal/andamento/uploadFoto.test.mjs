import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import ts from "typescript";

const pasta = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(pasta, "../../../../..");
const require = createRequire(import.meta.url);
function carregar(arquivo) {
  const modulo = { exports: {} };
  const codigo = ts.transpileModule(readFileSync(arquivo, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  runInThisContext(`(function(require,module,exports){${codigo}\n})`)((nome) => nome.startsWith("@/")
    ? carregar(resolve(raiz, "src", `${nome.slice(2)}.ts`)) : require(nome), modulo, modulo.exports);
  return modulo.exports;
}

const { confirmarFoto, enviarFotosEPublicar, erroDoArquivo, mimeDoArquivo } = carregar(resolve(pasta, "uploadFoto.ts"));
const atualizacaoId = "44444444-4444-4444-8444-444444444444";
const registroId = "55555555-5555-4555-8555-555555555555";
const resposta = (details, status = 200) => new Response(JSON.stringify({ details }), { status });
const foto = (nome) => ({ id: nome, arquivo: new File(["foto"], nome, { type: "image/jpeg" }), estado: "aguardando" });
let fotos;
let chamadas;
let falhar;
let numeroAssinatura;
let statusFalha;
const fetchOriginal = globalThis.fetch;

function preparar(falha = "", status = 503) {
  fotos = [foto("visita-1.jpg"), foto("visita-2.jpg")];
  chamadas = []; falhar = falha; numeroAssinatura = 0;
  statusFalha = status;
}
async function executar(publicar = true) {
  return enviarFotosEPublicar({
    endpoint: "/teste/atualizacoes", endpointFotos: "/teste/atualizacao-fotos", atualizacaoId, fotos, publicar,
    aoAlterar: (id, alteracao) => { fotos = fotos.map((item) => item.id === id ? { ...item, ...alteracao } : item); },
  });
}

try {
  globalThis.fetch = async (url, opcoes) => {
    const acao = opcoes.method === "PUT" ? "PUT" : opcoes.method === "PATCH" ? "PATCH" : url.split("/").pop();
    chamadas.push(acao);
    if (acao === falhar) return resposta("Falha simulada", statusFalha);
    if (acao === "assinar") {
      const entrada = JSON.parse(opcoes.body);
      assert.equal(entrada.atualizacaoId, atualizacaoId);
      assert.equal(entrada.mime, "image/jpeg");
      assert.equal(entrada.tamanho, 4);
      assert.equal(url, "/teste/atualizacao-fotos/upload/assinar");
      numeroAssinatura++;
      return resposta({ signedUrl: `https://storage.invalid/${numeroAssinatura}`, comprovante: `token-${numeroAssinatura}` });
    }
    if (acao === "PUT") {
      assert.equal(opcoes.headers["x-upsert"], "false");
      assert.ok(opcoes.body instanceof File);
      return new Response(null, { status: 200 });
    }
    if (acao === "confirmar") {
      const { comprovante } = JSON.parse(opcoes.body);
      if (falhar === "segunda-confirmacao-4xx" && comprovante === "token-2") return resposta("Envie novamente", statusFalha);
      if (falhar === "segunda-confirmacao" && comprovante === "token-2") throw new TypeError("Rede indisponível");
      return resposta({ id: registroId });
    }
    assert.equal(acao, "PATCH", "Nenhuma chamada real de rede é permitida.");
    assert.deepEqual(JSON.parse(opcoes.body), { id: atualizacaoId, publicado: true });
    assert.ok(fotos.every((item) => item.estado === "concluida"));
    return resposta({ id: atualizacaoId });
  };

  for (const mime of ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]) {
    assert.equal(erroDoArquivo(new File(["a"], "foto", { type: mime })), null);
  }
  assert.equal(mimeDoArquivo(new File(["a"], "foto.HEIC")), "image/heic");
  assert.equal(mimeDoArquivo(new File(["a"], "foto.heif")), "image/heif");
  assert.ok(erroDoArquivo(new File([], "vazia.jpg", { type: "image/jpeg" })));
  assert.ok(erroDoArquivo(new File(["a"], "foto.svg", { type: "image/svg+xml" })));
  assert.equal(erroDoArquivo({ name: "foto.jpg", type: "image/jpeg", size: 10485760 }), null);
  assert.ok(erroDoArquivo({ name: "foto.jpg", type: "image/jpeg", size: 10485761 }));

  preparar();
  assert.deepEqual(await executar(), []);
  assert.deepEqual(chamadas, ["assinar", "PUT", "confirmar", "assinar", "PUT", "confirmar", "PATCH"]);

  for (const falha of ["assinar", "PUT", "confirmar", "segunda-confirmacao"]) {
    preparar(falha);
    assert.ok((await executar()).length > 0);
    assert.ok(!chamadas.includes("PATCH"), `Publicação proibida com falha em ${falha}`);
    assert.ok(fotos.some((item) => item.estado === "erro"));
    falhar = ""; chamadas = [];
    assert.deepEqual(await executar(), []);
    assert.equal(chamadas.at(-1), "PATCH");
    if (falha === "confirmar" || falha === "segunda-confirmacao") {
      assert.ok(!chamadas.includes("assinar"));
      assert.ok(!chamadas.includes("PUT"));
      assert.equal(chamadas.filter((acao) => acao === "confirmar").length, falha === "confirmar" ? 2 : 1);
    }
  }

  for (const status of [400, 401, 403, 404, 409, 422, 429, 499]) {
    preparar("confirmar", status);
    await assert.rejects(confirmarFoto("/teste/atualizacao-fotos", "token-antigo"), (erro) => erro.status === status);
    chamadas = [];
    assert.deepEqual(await executar(), ["visita-1.jpg", "visita-2.jpg"]);
    assert.ok(fotos.every((item) => item.estado === "erro" && item.comprovante === undefined));
    assert.ok(!chamadas.includes("PATCH"));
    falhar = ""; chamadas = [];
    assert.deepEqual(await executar(), []);
    assert.deepEqual(chamadas, ["assinar", "PUT", "confirmar", "assinar", "PUT", "confirmar", "PATCH"]);
    assert.deepEqual(fotos.map((item) => item.comprovante), ["token-3", "token-4"]);
  }

  preparar("segunda-confirmacao-4xx", 400);
  assert.deepEqual(await executar(), ["visita-2.jpg"]);
  assert.equal(fotos[0].estado, "concluida");
  assert.equal(fotos[1].comprovante, undefined);
  falhar = ""; chamadas = [];
  assert.deepEqual(await executar(), []);
  assert.deepEqual(chamadas, ["assinar", "PUT", "confirmar", "PATCH"]);

  preparar("segunda-confirmacao-4xx", 400);
  await executar();
  fotos = fotos.filter((item) => item.estado !== "erro");
  chamadas = [];
  assert.deepEqual(await executar(), []);
  assert.deepEqual(chamadas, ["PATCH"]);

  preparar("PATCH");
  await assert.rejects(executar());
  falhar = ""; chamadas = [];
  assert.deepEqual(await executar(), []);
  assert.deepEqual(chamadas, ["PATCH"]);

  preparar();
  assert.deepEqual(await executar(false), []);
  assert.ok(!chamadas.includes("PATCH"));
  preparar(); fotos = [];
  assert.deepEqual(await executar(false), []);
  assert.deepEqual(chamadas, []);
  assert.deepEqual(await executar(), []);
  assert.deepEqual(chamadas, ["PATCH"]);
  console.log("OK: formatos/limites, ordem dos envios, rascunho em falhas, confirmação repetida sem duplicar, status HTTP, nova assinatura após 4xx, remoção de falhas, retry de publicação e criação sem fotos. Sem rede/Supabase.");
} finally {
  globalThis.fetch = fetchOriginal;
}
