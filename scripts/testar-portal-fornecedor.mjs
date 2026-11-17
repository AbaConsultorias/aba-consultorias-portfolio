import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import ts from "typescript";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const modulos = new Map();
let sessao;
const contasChamadas = [];
const substitutos = {
  "server-only": {}, react: { cache: (fn) => fn },
  "@/lib/supabase/server": { createClient: async () => sessao },
  "@/lib/supabase/admin": { createAdminClient() { throw new Error("Admin real não pode ser chamado pelo teste."); } },
  "@/lib/portal/comum/contas": Object.fromEntries(["listarContas", "criarConta", "atualizarConta"].map((nome) => [nome, async (...args) => { contasChamadas.push([nome, ...args]); return { id: id(1) }; }])),
};
function carregar(caminho) {
  const arquivo = resolve(raiz, caminho);
  if (modulos.has(arquivo)) return modulos.get(arquivo).exports;
  const modulo = { exports: {} }; modulos.set(arquivo, modulo);
  const codigo = ts.transpileModule(readFileSync(arquivo, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, esModuleInterop: true }, fileName: arquivo }).outputText;
  function importar(nome) {
    if (Object.hasOwn(substitutos, nome)) return substitutos[nome];
    if (nome.startsWith("@/")) return carregar(`src/${nome.slice(2)}.ts`);
    if (nome.startsWith(".")) return carregar(`${resolve(dirname(arquivo), nome)}.ts`);
    return require(nome);
  }
  runInThisContext(`(function(require,module,exports){${codigo}\n})`, { filename: arquivo })(importar, modulo, modulo.exports);
  return modulo.exports;
}
function banco(resolver, rpc = () => ({ data: null, error: null })) {
  return {
    from(tabela) {
      const estado = { tabela, filtros: [], operacao: "select", inicio: 0, fim: Infinity, unico: false };
      const q = {
        select(campos) { estado.campos = campos; return q; },
        eq(campo, valor) { estado.filtros.push([campo, valor]); return q; },
        order() { return q; }, range(inicio, fim) { Object.assign(estado, { inicio, fim }); return q; },
        limit(n) { estado.fim = n - 1; return q; },
        maybeSingle() { estado.unico = true; return q; }, single() { estado.unico = true; return q; },
        insert(dados) { Object.assign(estado, { operacao: "insert", dados }); return q; },
        update(dados) { Object.assign(estado, { operacao: "update", dados }); return q; },
        delete() { estado.operacao = "delete"; return q; },
        then(ok, fail) { return Promise.resolve().then(() => resolver(estado)).then(ok, fail); },
      }; return q;
    }, rpc: async (nome, dados) => rpc(nome, dados),
  };
}
const id = (n) => `51000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const testes = [];
const teste = (nome, executar) => testes.push([nome, executar]);
const { normalizarCnpj, formatarCnpj, agruparPorEmpreendimento, LIMITE_ARQUIVO_FORNECEDOR } = carregar("src/lib/portal/fornecedor/regras.ts");
const cadastro = carregar("src/app/api/(modules)/adm-interno/portal/fornecedores/schema.ts");
const documento = carregar("src/app/api/(modules)/portal/fornecedor/documentos/upload/schema.ts");
const contrato = carregar("src/app/api/(modules)/adm-interno/portal/fornecedor-contratos/upload/schema.ts");
const revisao = carregar("src/app/api/(modules)/adm-interno/portal/fornecedor-documentos/schema.ts");
const { conferirErro } = carregar("src/lib/portal/fornecedor/erros.ts");
const { validarArquivoFornecedor } = carregar("src/lib/portal/fornecedor/bytes.ts");
const { assinarComprovante } = carregar("src/lib/portal/comum/upload.ts");
const upload = carregar("src/lib/portal/fornecedor/upload.ts");
const consultas = carregar("src/lib/portal/fornecedor/consultas.ts");
const fornecedores = carregar("src/app/api/(modules)/adm-interno/portal/fornecedores/service.ts");
const stream = (bytes) => new ReadableStream({ start(c) { c.enqueue(Buffer.from(bytes)); c.close(); } });
const entrada = { fornecedorId: id(2), titulo: "Nota de materiais", tipo: "nota_fiscal", mime: "application/pdf", tamanho: 8 };

teste("CNPJ válido, máscara, dígitos verificadores, repetidos e caracteres inválidos", () => {
  assert.equal(normalizarCnpj("11.222.333/0001-81"), "11222333000181");
  assert.equal(normalizarCnpj("11222333000181"), "11222333000181");
  for (const texto of ["11222333000180", "11222333000191", "00000000000000", "11111111111111", "", "abc11222333000181", "1122233300018"]) assert.equal(normalizarCnpj(texto), null);
  assert.equal(formatarCnpj("11222333000181"), "11.222.333/0001-81");
  assert.equal(cadastro.criarSchema.parse({ razaoSocial: "Fornecedor", cnpj: "" }).cnpj, null);
  assert.equal(cadastro.criarSchema.parse({ razaoSocial: "Fornecedor", cnpj: "11.222.333/0001-81", papel: "admin" }).papel, undefined);
});
teste("schemas: tipos fechados, MIME e limite de 20 MiB", () => {
  assert.equal(documento.assinarSchema.safeParse(entrada).success, true);
  for (const campos of [{ tipo: "script" }, { mime: "image/webp" }, { tamanho: 0 }, { tamanho: LIMITE_ARQUIVO_FORNECEDOR + 1 }]) assert.equal(documento.assinarSchema.safeParse({ ...entrada, ...campos }).success, false);
  assert.equal(documento.assinarSchema.safeParse({ ...entrada, tamanho: LIMITE_ARQUIVO_FORNECEDOR }).success, true);
  assert.equal(contrato.assinarSchema.parse(entrada).mime, undefined);
});
teste("recusar exige motivo; aprovar descarta motivo e campos de autoria", () => {
  for (const motivo of [undefined, "", "  ", "ab"]) assert.equal(revisao.atualizarSchema.safeParse({ id: id(1), status: "recusado", motivo }).success, false);
  assert.equal(revisao.atualizarSchema.parse({ id: id(1), status: "recusado", motivo: "  Corrigir valor  " }).motivo, "Corrigir valor");
  assert.deepEqual(revisao.atualizarSchema.parse({ id: id(1), status: "aprovado", motivo: "não persistir", revisado_por: id(9) }), { id: id(1), status: "aprovado" });
});
teste("mapeamento dos códigos de erro da migration", () => {
  for (const [code, status] of [["42501", 403], ["P0002", 404], ["55000", 409], ["54000", 409], ["23514", 400]]) assert.throws(() => conferirErro({ code }), (e) => e.status === status);
});
teste("PDF, JPEG e PNG reais; falso, truncado, MIME e tamanho divergente", async () => {
  await validarArquivoFornecedor(stream("%PDF-1.7"), 8, "application/pdf", "application/pdf");
  const jpeg = Buffer.from([255, 216, 255, 1, 255, 217]);
  await validarArquivoFornecedor(stream(jpeg), jpeg.length, "image/jpeg", "image/jpeg");
  const png = Buffer.alloc(33); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.writeUInt32BE(13, 8); png.write("IHDR", 12);
  await validarArquivoFornecedor(stream(png), png.length, "image/png", "image/png");
  for (const [bytes, tamanho, mime, tipo] of [["<script>", 8, "application/pdf", "application/pdf"], ["%PDF-", 8, "application/pdf", "application/pdf"], ["%PDF-1.7", 7, "application/pdf", "application/pdf"], ["%PDF-1.7", 8, "application/pdf", "image/png"], [jpeg.subarray(0, 4), 4, "image/jpeg", "image/jpeg"], [png.subarray(0, 16), 16, "image/png", "image/png"]]) await assert.rejects(() => validarArquivoFornecedor(stream(bytes), tamanho, mime, tipo));
  const grande = Buffer.alloc(11 * 1024 * 1024); jpeg.copy(grande);
  await validarArquivoFornecedor(stream(grande), grande.length, "image/jpeg", "image/jpeg");
});
teste("seletor listar({}) intacto e todas as páginas", async () => {
  const linhas = Array.from({ length: 101 }, (_, n) => ({ id: id(n + 1), razao_social: `Razão ${n}`, nome_fantasia: n === 0 ? "Fantasia" : null, ativo: n % 2 === 0 }));
  sessao = banco((q) => { assert.equal(q.tabela, "fornecedores"); assert.equal(q.campos, "id,razao_social,nome_fantasia,ativo"); return { data: linhas.slice(q.inicio, q.fim + 1), error: null }; });
  const dados = await fornecedores.listar({});
  assert.equal(dados.registros.length, 101); assert.deepEqual(dados.registros[0], { id: id(1), nome: "Fantasia", ativo: true });
  assert.equal(cadastro.consultaSchema.parse({}).modo, "seletor");
  assert.equal(cadastro.consultaSchema.parse({ modo: "completo" }).modo, "completo");
});
teste("agrupamento por empreendimento usa ID, nome e desempate estável", () => {
  assert.deepEqual(agruparPorEmpreendimento([]), []);
  const itens = [{ id: id(9), empreendimentoId: id(2), empreendimentoNome: "Alfa" }, { id: id(8), empreendimentoId: id(1), empreendimentoNome: "Alfa" }, { id: id(7), empreendimentoId: id(2), empreendimentoNome: "Alfa" }];
  const grupos = agruparPorEmpreendimento(itens);
  assert.equal(grupos.length, 2); assert.equal(grupos[0].empreendimentoId, id(1)); assert.deepEqual(grupos[1].itens.map((i) => i.id), [id(9), id(7)]);
});
teste("DTOs de contratos e documentos sem path/URL; nomes por RPC", async () => {
  const linha = { id: id(1), fornecedorId: id(2), empreendimentoId: id(3), titulo: "Arquivo", tamanho: "8", criadoEm: "2026-10-30T00:00:00Z", storage_path: "segredo", signedUrl: "https://nao-expor.example", tipo: "nota_fiscal", status: "recusado", motivo: "Corrigir dados", revisadoEm: null };
  sessao = banco((q) => { assert.ok(!q.campos.includes("storage_path")); return { data: [linha], error: null }; }, (nome, args) => { assert.equal(nome, "nome_empreendimento"); assert.equal(args.p_empreendimento, id(3)); return { data: null, error: null }; });
  for (const dados of [await consultas.listarMeusContratos(), await consultas.listarMeusDocumentos()]) {
    const dto = dados.registros[0]; assert.equal(dto.storage_path, undefined); assert.equal(dto.signedUrl, undefined); assert.equal(dto.empreendimentoId, undefined); assert.equal(dto.empreendimentoNome, null); assert.ok(dto.downloadHref.startsWith("/api/portal/fornecedor-"));
  }
});
teste("financeiro lê todas as páginas, preserva bigint e condições de parcela", async () => {
  const itens = Array.from({ length: 101 }, (_, n) => ({ id: id(n + 100), fornecedorId: id(2), empreendimentoId: id(3), descricao: "Item", observacao: "Condição do item", valorContratadoCentavos: "9007199254740993", codigo: null, versao: null, assinadoEm: null, documentoId: null, atualizadoEm: "2026-11-01T12:00:00Z" }));
  const campos = { numero: null, nome: null, dataPagamento: null, gatilho: "data", eventoTipo: null, eventoProjetoId: null, eventoDescricao: null, diasApos: 0, eventoId: null, observacao: "Condição da parcela" };
  const parcelas = itens.map((i, n) => ({ ...campos, id: id(n + 300), itemId: i.id, vencimento: "2026-11-30", valorPrevistoCentavos: "9007199254740993", valorPagoCentavos: "1" }));
  const aguarda = { ...campos, id: id(900), itemId: itens[0].id, vencimento: null, gatilho: "evento", eventoTipo: "aprovacao", valorPrevistoCentavos: "500", valorPagoCentavos: "0" };
  parcelas.push(aguarda);
  const f = { id: id(2), razaoSocial: "Fornecedor", nomeFantasia: null, cnpj: null, contatoNome: null, telefone: null, email: null, observacao: null, ativo: true };
  sessao = banco((q) => { const linhas = q.tabela === "itens_financeiros" ? itens : q.tabela === "parcelas" ? parcelas : [f]; if (q.tabela !== "fornecedores") assert.ok(q.campos.includes("::text")); return { data: linhas.slice(q.inicio, q.fim + 1), error: null }; }, () => ({ data: "Empreendimento", error: null }));
  const dados = await consultas.obterFinanceiroFornecedor();
  assert.equal(dados.itens.length, 101); assert.equal(dados.resumo.contratadoCentavos, (BigInt("9007199254740993") * BigInt(101)).toString()); assert.equal(dados.resumo.pagoCentavos, "101"); assert.equal(dados.itens[100].parcelas[0].observacao, "Condição da parcela");
  assert.equal(dados.itens[0].parcelas.length, 2); assert.equal(dados.itens[0].parcelas[1].vencimento, null);
  assert.equal(dados.resumo.proximoPagamento.id, id(300)); assert.equal(dados.resumo.proximoPagamento.vencimento, "2026-11-30");
});
teste("financeiro: só parcela aguardando evento não gera próximo pagamento", async () => {
  const item = { id: id(100), fornecedorId: id(2), empreendimentoId: id(3), descricao: "Item", observacao: null, valorContratadoCentavos: "1000", codigo: null, versao: null, assinadoEm: null, documentoId: null, atualizadoEm: "2026-11-01T12:00:00Z" };
  const parcela = { id: id(300), itemId: item.id, numero: 1, nome: null, vencimento: null, valorPrevistoCentavos: "1000", valorPagoCentavos: "0", dataPagamento: null, gatilho: "evento", eventoTipo: "entrega", eventoProjetoId: null, eventoDescricao: null, diasApos: 30, eventoId: null, observacao: null };
  sessao = banco((q) => ({ data: (q.tabela === "itens_financeiros" ? [item] : q.tabela === "parcelas" ? [parcela] : []).slice(q.inicio, q.fim + 1), error: null }), () => ({ data: "Empreendimento", error: null }));
  const dados = await consultas.obterFinanceiroFornecedor();
  assert.equal(dados.itens[0].parcelas.length, 1); assert.equal(dados.resumo.proximoPagamento, null); assert.equal(dados.resumo.saldoCentavos, "1000");
});
teste("contas sempre usam papel fornecedor; corpo não decide o papel", async () => {
  const schema = carregar("src/app/api/(modules)/adm-interno/portal/fornecedor-contas/schema.ts");
  const service = carregar("src/app/api/(modules)/adm-interno/portal/fornecedor-contas/service.ts");
  const dados = schema.criarSchema.parse({ nome: "Fornecedor", identificador: "fornecedor", senha: "Temporaria123", papel: "admin" });
  assert.equal(dados.papel, undefined); await service.criar(dados, id(5));
  await service.atualizar(schema.atualizarSchema.parse({ id: id(1), nome: "Novo nome", telefone: null, ativo: true, papel: "admin" }), id(5));
  assert.ok(contasChamadas.every((c) => c[1] === "fornecedor"));
});

const chaveAnterior = process.env.SUPABASE_SECRET_KEY;
process.env.SUPABASE_SECRET_KEY = "chave-ficticia-exclusiva-do-teste-local-sem-rede";
function contexto(opcoes = {}) {
  const registros = new Map(); const removidos = []; const chamadas = []; let leituras = 0;
  const db = banco((q) => {
    chamadas.push(q);
    if (["fornecedores", "empreendimentos", "itens_financeiros"].includes(q.tabela)) return { data: opcoes.semPai ? null : { id: id(2) }, error: null };
    if (q.operacao === "insert") { registros.set(q.dados.id, q.dados); return { data: null, error: opcoes.erroInsert ?? null }; }
    return { data: registros.get(q.filtros.find(([k]) => k === "id")?.[1]) ?? null, error: null };
  }, (nome, args) => {
    chamadas.push({ rpc: nome, args });
    if (opcoes.erroRpc) return { data: null, error: opcoes.erroRpc };
    registros.set(args.p_id, { id: args.p_id, fornecedor_id: args.p_fornecedor, storage_path: args.p_path, mime: args.p_mime, tamanho: args.p_tamanho, enviado_por: id(1) });
    return { data: args.p_id, error: null };
  });
  const deps = { criarSessao: async () => db, novoId: () => id(4), relogio: { agora: () => Date.parse("2026-10-30T12:00:00Z") }, contratoExcluido: async () => Boolean(opcoes.excluido), armazenamento: {
    criarUrlAssinada: async () => ({ signedUrl: "https://storage.example/upload", token: "fake" }),
    abrirObjeto: async () => { leituras++; return opcoes.ausente ? null : { stream: stream(opcoes.bytes ?? "%PDF-1.7"), contentType: opcoes.mime ?? "application/pdf" }; },
    removerObjeto: async (path) => { removidos.push(path); },
  } };
  return { deps, registros, removidos, chamadas, leituras: () => leituras };
}
teste("comprovantes contrato × documento são recusados antes de tocar Storage", async () => {
  const c = contexto();
  const a = await upload.assinarContrato(entrada, id(1), c.deps);
  const b = await upload.assinarDocumento(entrada, id(1), c.deps);
  await assert.rejects(() => upload.confirmarEnvio(a.comprovante, id(1), "fornecedor_documento", c.deps), (e) => e.status === 400);
  await assert.rejects(() => upload.confirmarEnvio(b.comprovante, id(1), "fornecedor_contrato", c.deps), (e) => e.status === 400);
  assert.equal(c.leituras(), 0); assert.equal(c.removidos.length, 0);
});
teste("token adulterado, expirado e de outro usuário", async () => {
  const c = contexto(); const a = await upload.assinarDocumento(entrada, id(1), c.deps);
  await assert.rejects(() => upload.confirmarEnvio(a.comprovante + "x", id(1), "fornecedor_documento", c.deps));
  await assert.rejects(() => upload.confirmarEnvio(a.comprovante, id(9), "fornecedor_documento", c.deps));
  await assert.rejects(() => upload.confirmarEnvio(a.comprovante, id(1), "fornecedor_documento", { ...c.deps, relogio: { agora: () => c.deps.relogio.agora() + 31 * 60000 } }));
  assert.equal(c.leituras(), 0);
});
teste("documento usa RPC da sessão e retry não relê/apaga arquivo referenciado", async () => {
  const c = contexto(); const a = await upload.assinarDocumento(entrada, id(1), c.deps);
  const r = await upload.confirmarEnvio(a.comprovante, id(1), "fornecedor_documento", c.deps);
  assert.deepEqual(r, { id: id(4) });
  assert.deepEqual(await upload.confirmarEnvio(a.comprovante, id(1), "fornecedor_documento", c.deps), r);
  const rpc = c.chamadas.filter((c) => c.rpc); assert.equal(rpc.length, 1); assert.equal(rpc[0].rpc, "enviar_documento_fornecedor"); assert.equal(rpc[0].args.p_tipo, "nota_fiscal");
  assert.equal(c.leituras(), 1); assert.equal(c.removidos.length, 0);
});
teste("contrato confirmado usa insert da sessão; reenvio idempotente", async () => {
  const c = contexto(); const a = await upload.assinarContrato(entrada, id(1), c.deps);
  await upload.confirmarEnvio(a.comprovante, id(1), "fornecedor_contrato", c.deps);
  await upload.confirmarEnvio(a.comprovante, id(1), "fornecedor_contrato", c.deps);
  assert.equal(c.chamadas.filter((q) => q.operacao === "insert").length, 1); assert.equal(c.leituras(), 1);
});
teste("arquivo falso/MIME divergente é removido; ausente retorna 400", async () => {
  for (const opcoes of [{ bytes: "NOTPDF!!" }, { mime: "image/png" }, { bytes: "%PDF-" }]) {
    const c = contexto(opcoes); const a = await upload.assinarDocumento(entrada, id(1), c.deps);
    await assert.rejects(() => upload.confirmarEnvio(a.comprovante, id(1), "fornecedor_documento", c.deps), (e) => e.status === 400);
    assert.deepEqual(c.removidos, [a.path]); assert.equal(c.chamadas.filter((q) => q.rpc).length, 0);
  }
  const c = contexto({ ausente: true }); const a = await upload.assinarDocumento(entrada, id(1), c.deps);
  await assert.rejects(() => upload.confirmarEnvio(a.comprovante, id(1), "fornecedor_documento", c.deps), (e) => e.status === 400);
});
teste("erro transitório/limite preserva objeto; replay excluído é recusado", async () => {
  const c = contexto({ erroRpc: { code: "54000" } }); const a = await upload.assinarDocumento(entrada, id(1), c.deps);
  await assert.rejects(() => upload.confirmarEnvio(a.comprovante, id(1), "fornecedor_documento", c.deps), (e) => e.status === 409);
  assert.equal(c.removidos.length, 0);
  const d = contexto({ excluido: true }); const b = await upload.assinarContrato(entrada, id(1), d.deps);
  await assert.rejects(() => upload.confirmarEnvio(b.comprovante, id(1), "fornecedor_contrato", d.deps), (e) => e.status === 400);
  assert.deepEqual(d.removidos, [b.path]); assert.equal(d.leituras(), 0);
  const e = contexto({ erroRpc: { code: "23514" } }); const f = await upload.assinarDocumento(entrada, id(1), e.deps);
  await assert.rejects(() => upload.confirmarEnvio(f.comprovante, id(1), "fornecedor_documento", e.deps), (erro) => erro.status === 400);
  assert.deepEqual(e.removidos, [f.path]);
});
teste("pai revogado impede assinar; path nunca vem do nome do arquivo", async () => {
  const c = contexto({ semPai: true });
  await assert.rejects(() => upload.assinarDocumento(entrada, id(1), c.deps), (e) => e.status === 400);
  const d = contexto(); const a = await upload.assinarDocumento({ ...entrada, titulo: "../../nome" }, id(1), d.deps);
  assert.equal(a.path, `${id(2)}/documentos/${id(4)}.pdf`);
  assert.throws(() => assinarComprovante({ finalidade: "fornecedor_documento", bucket: "fornecedores", usuarioId: id(1), registroId: id(4), path: "../../arquivo.pdf", mime: "application/pdf", tamanho: 8, metadados: entrada }, d.deps.relogio));
});
teste("exclusão: Storage antes da linha, falha mantém linha, repetição segura", async () => {
  const { excluirArquivo } = carregar("src/lib/portal/fornecedor/exclusao.ts");
  const eventos = []; let existe = true;
  const db = banco((q) => { if (q.operacao === "delete") { eventos.push("linha"); existe = false; return { error: null }; } return { data: existe ? { id: id(4), fornecedor_id: id(2), storage_path: `${id(2)}/contratos/${id(4)}.pdf` } : null, error: null }; });
  const deps = { criarSessao: async () => db, armazenamento: { removerObjeto: async () => { eventos.push("objeto"); } } };
  await assert.rejects(() => excluirArquivo("fornecedor_contratos", id(4), { ...deps, armazenamento: { removerObjeto: async () => { throw new Error("transitório"); } } }));
  assert.equal(existe, true);
  await excluirArquivo("fornecedor_contratos", id(4), deps); await excluirArquivo("fornecedor_contratos", id(4), deps);
  assert.deepEqual(eventos, ["objeto", "linha"]);
});

try {
  for (const [nome, executar] of testes) { await executar(); console.log(`OK: ${nome}`); }
  console.log(`OK: ${testes.length} testes de fornecedor, sem chamadas ao Supabase.`);
} finally {
  if (chaveAnterior === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = chaveAnterior;
}
