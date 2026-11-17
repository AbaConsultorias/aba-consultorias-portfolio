// Teste de integração do módulo src/lib/r2/cliente.ts contra o balde R2 de desenvolvimento.
// Só roda se R2_BUCKET_DOCUMENTOS terminar em "-dev"; com qualquer outro balde sai com aviso, sem tocar em nada.
// Uso: node --env-file=.env scripts/testar-r2.mjs
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import ts from "typescript";

const bucket = process.env.R2_BUCKET_DOCUMENTOS ?? "";
if (!bucket.endsWith("-dev")) {
  console.warn("testar-r2: ignorado. R2_BUCKET_DOCUMENTOS precisa terminar em \"-dev\" (este teste grava e apaga objetos).");
  exit(0);
}
const faltando = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].filter((nome) => !process.env[nome]);
if (faltando.length > 0) {
  console.error(`testar-r2: faltam no .env: ${faltando.join(", ")}`);
  exit(1);
}

const raiz = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const modulos = new Map();
const substitutos = { "server-only": {} };

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

const r2 = carregar("src/lib/r2/cliente.ts");
const pasta = randomUUID();
const chave = `${pasta}/${randomUUID()}.pdf`;
const chaveRecusada = `${pasta}/${randomUUID()}.pdf`;
const conteudo = Buffer.from(`%PDF-1.4\n% teste de integracao ${randomUUID()}\n%%EOF\n`);
const menorConteudo = conteudo.subarray(0, conteudo.length - 1);
const sha256Base64 = (bytes) => createHash("sha256").update(bytes).digest("base64");
const etapas = [];
const etapa = (nome) => { etapas.push(nome); console.log(`ok  ${nome}`); };

try {
  const mesmoTamanho = Buffer.from(conteudo);
  mesmoTamanho[mesmoTamanho.length - 3] = "X".charCodeAt(0);
  assert.equal(mesmoTamanho.length, conteudo.length);

  // assinar PUT
  const envio = await r2.presignPut(chave, { tamanho: conteudo.length, sha256Base64: sha256Base64(conteudo) }, 300);
  const urlEnvio = new URL(envio.url);
  assert.equal(urlEnvio.searchParams.get("X-Amz-Expires"), "300");
  assert.ok(urlEnvio.searchParams.get("X-Amz-Signature"));
  assert.ok(urlEnvio.searchParams.get("X-Amz-SignedHeaders").split(";").includes("content-length"));
  assert.deepEqual(envio.cabecalhos, { "content-type": "application/pdf", "x-amz-checksum-sha256": sha256Base64(conteudo) });
  etapa("presignPut devolve URL de 300 s e só os cabeçalhos que o navegador manda");

  // PUT correto
  const enviado = await fetch(envio.url, { method: "PUT", headers: envio.cabecalhos, body: conteudo });
  assert.equal(enviado.status, 200, `PUT correto: ${enviado.status}`);
  etapa("PUT com o conteúdo assinado: 200");

  // PUT com conteúdo diferente (mesmo tamanho), com outro tamanho e sem o cabeçalho do checksum: recusados
  const alvo = await r2.presignPut(chaveRecusada, { tamanho: conteudo.length, sha256Base64: sha256Base64(conteudo) });
  const diferente = await fetch(alvo.url, { method: "PUT", headers: alvo.cabecalhos, body: mesmoTamanho });
  assert.equal(diferente.status, 400, `conteúdo diferente: ${diferente.status}`);
  const menor = await fetch(alvo.url, { method: "PUT", headers: alvo.cabecalhos, body: menorConteudo });
  assert.equal(menor.status, 403, `tamanho diferente: ${menor.status}`);
  const semChecksum = await fetch(alvo.url, { method: "PUT", headers: { "content-type": "application/pdf" }, body: conteudo });
  assert.equal(semChecksum.status, 403, `sem checksum: ${semChecksum.status}`);
  assert.equal(await r2.head(chaveRecusada), null, "nada foi gravado");
  etapa("PUT com conteúdo, tamanho ou cabeçalho diferente: recusado e nada gravado");

  // head
  const info = await r2.head(chave);
  assert.deepEqual(info, { tamanho: conteudo.length, sha256Base64: sha256Base64(conteudo), contentType: "application/pdf" });
  assert.equal(await r2.head(`${pasta}/${randomUUID()}.pdf`), null);
  etapa("head devolve tamanho, checksum e tipo; ausente é null");

  // faixa
  assert.equal(Buffer.from(await r2.lerFaixa(chave, 0, 4)).toString("latin1"), "%PDF-");
  assert.equal(await r2.lerFaixa(`${pasta}/${randomUUID()}.pdf`, 0, 4), null);
  etapa("lerFaixa(0, 4) devolve %PDF-; ausente é null");

  // GET assinado
  const urlBaixar = await r2.presignGet(chave, 60, { nomeArquivo: "Ação nº 1 (final).pdf", anexo: true });
  const baixado = await fetch(urlBaixar);
  assert.equal(baixado.status, 200, `GET assinado: ${baixado.status}`);
  assert.deepEqual(Buffer.from(await baixado.arrayBuffer()), conteudo);
  assert.equal(baixado.headers.get("content-type"), "application/pdf");
  const disposicao = baixado.headers.get("content-disposition") ?? "";
  assert.match(disposicao, /^attachment; filename="Acao n_ 1 _final_.pdf"; filename\*=UTF-8''A%C3%A7%C3%A3o%20n%C2%BA%201%20%28final%29\.pdf$/);
  const semAssinatura = new URL(urlBaixar);
  semAssinatura.searchParams.delete("X-Amz-Signature");
  assert.notEqual((await fetch(semAssinatura)).status, 200, "sem assinatura não baixa");
  etapa("presignGet baixa o arquivo com Content-Disposition RFC 6266/5987");

  // listar
  const pagina = await r2.listar(`${pasta}/`);
  assert.equal(pagina.proximo, null);
  assert.deepEqual(pagina.objetos.map((o) => [o.chave, o.tamanho]), [[chave, conteudo.length]]);
  assert.ok(Math.abs(Date.now() - pagina.objetos[0].modificadoEm.getTime()) < 10 * 60 * 1000, "modificadoEm recente");
  const geral = await r2.listar();
  assert.ok(Array.isArray(geral.objetos));
  etapa("listar com prefixo devolve só o objeto do teste");

  // remover (idempotente)
  await r2.remover(chave);
  assert.equal(await r2.head(chave), null);
  await r2.remover(chave);
  etapa("remover apaga e é idempotente");

  console.log(`testar-r2: OK (${etapas.length} etapas, balde ${bucket})`);
} finally {
  for (const objeto of [chave, chaveRecusada]) await r2.remover(objeto).catch(() => console.error("testar-r2: não foi possível apagar um objeto de teste"));
}
