import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import ts from "typescript";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const modulos = new Map();

const adminId = "11111111-1111-4111-8111-111111111111";
const empId = "33333333-3333-4333-8333-333333333333";
const empInativoId = "33333333-3333-4333-8333-444444444444";
const empSemRegraId = "33333333-3333-4333-8333-555555555555";
const empSemCodigoId = "33333333-3333-4333-8333-666666666666";
const projetoId = "44444444-4444-4444-8444-444444444444";
const categoriaId = "55555555-5555-4555-8555-555555555555";
const categoria2Id = "55555555-5555-4555-8555-666666666666";
const categoriaSimosId = "55555555-5555-4555-8555-777777777777";
const categoriaLaudosId = "55555555-5555-4555-8555-888888888888";
const regraEquipamentosId = "66666666-6666-4666-8666-000000000006";
const PREFIXO_EQUIPAMENTOS = "19 - SIMOS E LAUDOS";
const regraLanId = "66666666-6666-4666-8666-000000000001";
const regraAprovadoId = "66666666-6666-4666-8666-000000000002";
const regraContratoId = "66666666-6666-4666-8666-000000000003";
const regraInativaId = "66666666-6666-4666-8666-000000000004";
const regraInativoEmpId = "66666666-6666-4666-8666-000000000005";
const conectorId = "77777777-7777-4777-8777-777777777777";
const outroConectorId = "77777777-7777-4777-8777-888888888888";
const PREFIXO_LAN = "03 - PRODUTOS/LAN";
const PREFIXO_APROVADO = "03 - PRODUTOS/LAN/APROVADO NO INTERLIGA";
const PREFIXO_CONTRATO = "01 - FINANCEIRO/01 - PROPOSTA-CONTRATO";

let papel = "admin";
let estado;
let objetos;
let chamadasLimitar;
let bloquearRequisicoes = false;
const logs = [];
const invalidacoes = [];

const substitutos = {
  "server-only": {},
  "next/cache": { revalidatePath: (...args) => invalidacoes.push(args) },
  "react": { cache: (fn) => fn },
  "@/lib/auth/guard": {
    exigirPapelApi: async (papeis) => {
      const { ForbiddenError } = carregar("src/app/api/HttpErrors.ts");
      if (!papeis.includes(papel)) throw new ForbiddenError("Acesso negado.");
      return { user: { id: adminId }, perfil: { papel } };
    },
  },
  // A regra real decide; a conta interna tem todas as permissões concedíveis e o que é só do admin continua negado.
  "@/lib/auth/permissoes-servidor": {
    exigirRegraApi: async (regra) => {
      const { ForbiddenError } = carregar("src/app/api/HttpErrors.ts");
      const { regraPermite } = carregar("src/lib/auth/regras.ts");
      const { PERMISSOES } = carregar("src/lib/auth/permissoes.ts");
      const permissoes = new Set(PERMISSOES);
      if (!regraPermite(regra, papel, permissoes)) throw new ForbiddenError("Acesso negado.");
      return { user: { id: adminId }, perfil: { papel }, permissoes };
    },
  },
  "@/lib/supabase/server": { createClient: async () => criarBanco() },
  "@/lib/supabase/admin": { createAdminClient: () => criarBanco() },
  "@/lib/rate-limit": {
    limitar: async (chave, limite, janela) => {
      chamadasLimitar.push([chave, limite, janela]);
      return !(bloquearRequisicoes && chave.startsWith("conector-requisicoes:"));
    },
    chaveConta: (prefixo, identificador) => `${prefixo}:${identificador}`,
  },
  // R2 em memória: PUT simulado por colocarObjeto(); o resto é o mesmo código de produção (armazenamento.ts).
  "@/lib/r2/cliente": {
    presignPut: async (chave, objeto) => {
      estado.eventos.push(["presign", chave, objeto.tamanho]);
      return {
        url: `https://r2.invalid/${chave}?assinatura=simulada`,
        cabecalhos: { "content-type": "application/pdf", "x-amz-checksum-sha256": objeto.sha256Base64 },
      };
    },
    head: async (chave) => {
      if (estado.falhaR2) throw new Error("r2");
      const objeto = objetos.get(chave);
      if (!objeto) return null;
      return {
        tamanho: objeto.bytes.length,
        sha256Base64: objeto.sha256Base64 === undefined ? sha256Base64(objeto.bytes) : objeto.sha256Base64,
        contentType: objeto.contentType === undefined ? "application/pdf" : objeto.contentType,
      };
    },
    lerFaixa: async (chave) => {
      const objeto = objetos.get(chave);
      return objeto ? new Uint8Array(objeto.bytes.subarray(0, 5)) : null;
    },
    remover: async (chave) => {
      estado.eventos.push(["remover", chave]);
      objetos.delete(chave);
    },
  },
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

const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha256Base64 = (bytes) => createHash("sha256").update(bytes).digest("base64");
const pdf = (n) => Buffer.from(`%PDF-1.4\n% arquivo ${n}\n%%EOF\n`);

// ---------------------------------------------------------------------------------------------------------------
// Banco simulado em memória: só o necessário para as consultas do conector (sem RLS; a secret key também o ignora).
// ---------------------------------------------------------------------------------------------------------------

function criarEstado() {
  return {
    tabelas: {
      conectores: [],
      empreendimentos: [
        { id: empId, codigo_pasta: "250101", situacao: "ativo", liberacao_automatica: false },
        { id: empInativoId, codigo_pasta: "250102", situacao: "arquivado", liberacao_automatica: false },
        { id: empSemRegraId, codigo_pasta: "250103", situacao: "ativo", liberacao_automatica: false },
        { id: empSemCodigoId, codigo_pasta: null, situacao: "ativo", liberacao_automatica: false },
      ],
      pasta_regras: [
        { id: regraLanId, empreendimento_id: empId, caminho_prefixo: PREFIXO_LAN, projeto_id: projetoId, categoria_id: categoriaId, grupo: null, liberar_automatico: false, ativa: true },
        { id: regraAprovadoId, empreendimento_id: empId, caminho_prefixo: PREFIXO_APROVADO, projeto_id: projetoId, categoria_id: categoria2Id, grupo: null, liberar_automatico: true, ativa: true },
        { id: regraContratoId, empreendimento_id: empId, caminho_prefixo: "01 - FINANCEIRO\\01 - PROPOSTA-CONTRATO", projeto_id: null, categoria_id: null, grupo: "contratos", liberar_automatico: true, ativa: true },
        { id: regraInativaId, empreendimento_id: empId, caminho_prefixo: "99 - INATIVA", projeto_id: null, categoria_id: null, grupo: "orcamentos", liberar_automatico: false, ativa: false },
        { id: regraInativoEmpId, empreendimento_id: empInativoId, caminho_prefixo: "X", projeto_id: null, categoria_id: null, grupo: "orcamentos", liberar_automatico: false, ativa: true },
      ],
      configuracoes_conector: [{ id: randomUUID(), unica: true, liberacao_automatica_geral: true }],
      conector_envios: [],
      documentos: [],
      documento_origens: [],
    },
    falhas: [],
    gatilhos: [],
    eventos: [],
    falhaR2: false,
  };
}

function reiniciar({ regraAuto = true, empAuto = false, geral = true } = {}) {
  estado = criarEstado();
  objetos = new Map();
  chamadasLimitar = [];
  bloquearRequisicoes = false;
  estado.tabelas.pasta_regras.find((r) => r.id === regraAprovadoId).liberar_automatico = regraAuto;
  estado.tabelas.empreendimentos.find((e) => e.id === empId).liberacao_automatica = empAuto;
  estado.tabelas.configuracoes_conector[0].liberacao_automatica_geral = geral;
  estado.tabelas.conectores.push({
    id: conectorId, nome: "Servidor", token_hash: hashDaChave(CHAVE), criado_em: "2026-11-04T09:00:00.000Z", revogado_em: null,
    ultimo_contato_em: null, versao: null, ultimo_ciclo: null, arvore: null,
  });
}

function padraoLike(padrao) {
  const literal = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let re = "";
  for (let i = 0; i < padrao.length; i++) {
    const c = padrao[i];
    if (c === "\\") re += literal(padrao[++i] ?? "\\");
    else if (c === "%") re += ".*";
    else if (c === "_") re += ".";
    else re += literal(c);
  }
  return new RegExp(`^${re}$`, "is");
}

function violacao(codigo) {
  return Object.assign(new Error(codigo), { codigo });
}

function inserir(tabela, entrada) {
  const { tabelas } = estado;
  const agora = new Date().toISOString();
  if (tabela === "conector_envios") {
    const linha = {
      id: randomUUID(), estado: "autorizado", em: agora, documento_id: null, storage_path: null, documento_planejado_id: null,
      mtime: null, confirmado_em: null, regra_id: null, erro: null, ...entrada,
    };
    tabelas.conector_envios.push(linha);
    return linha;
  }
  if (tabela === "documentos") {
    if (tabelas.documentos.some((d) => d.id === entrada.id || d.storage_path === entrada.storage_path)) throw violacao("23505");
    let familiaId = entrada.id;
    if (entrada.substitui_id) {
      const anterior = tabelas.documentos.find((d) => d.id === entrada.substitui_id && d.empreendimento_id === entrada.empreendimento_id);
      if (!anterior) throw violacao("23514");
      familiaId = anterior.familia_id;
    }
    const linha = { grupo: null, substitui_id: null, liberado_por: null, liberado_em: null, criado_em: agora, ...entrada, familia_id: familiaId };
    tabelas.documentos.push(linha);
    return linha;
  }
  if (tabela === "documento_origens") {
    if (!tabelas.documentos.some((d) => d.id === entrada.documento_id)) throw violacao("23503");
    if (tabelas.documento_origens.some((o) => o.documento_id === entrada.documento_id)) throw violacao("23505");
    const linha = { id: randomUUID(), ...entrada };
    tabelas.documento_origens.push(linha);
    return linha;
  }
  if (tabela === "conectores") {
    if (tabelas.conectores.some((c) => c.revogado_em === null)) throw violacao("23505");
    const linha = {
      id: randomUUID(), criado_em: agora, revogado_em: null, ultimo_contato_em: null, versao: null, ultimo_ciclo: null, arvore: null,
      criado_por: adminId, ...entrada,
    };
    tabelas.conectores.push(linha);
    return linha;
  }
  throw new Error(`insert não simulado em ${tabela}`);
}

function atualizar(tabela, linha, campos) {
  const { tabelas } = estado;
  if (tabela === "conector_envios" && campos.estado === "confirmado" && linha.estado !== "confirmado") {
    if (tabelas.conector_envios.some((o) => o !== linha && o.estado === "confirmado" && o.empreendimento_id === linha.empreendimento_id && o.sha256 === linha.sha256)) {
      throw violacao("23505");
    }
  }
  if (tabela === "documentos" && campos.liberado_cliente !== undefined && campos.liberado_cliente !== linha.liberado_cliente) {
    if (campos.liberado_cliente) {
      // carimbar_liberacao_documento + ocultar_versoes_irmas_documento
      campos = { ...campos, liberado_em: new Date().toISOString(), liberado_por: null };
      for (const irma of tabelas.documentos) {
        if (irma !== linha && irma.familia_id === linha.familia_id) irma.liberado_cliente = false;
      }
    } else {
      campos = { ...campos, liberado_em: null, liberado_por: null };
    }
  }
  Object.assign(linha, campos);
}

function remover(tabela, linha) {
  const { tabelas } = estado;
  tabelas[tabela] = tabelas[tabela].filter((outra) => outra !== linha);
  if (tabela === "documentos") {
    tabelas.documento_origens = tabelas.documento_origens.filter((o) => o.documento_id !== linha.id);
    for (const envio of tabelas.conector_envios) if (envio.documento_id === linha.id) envio.documento_id = null;
    for (const doc of tabelas.documentos) if (doc.substitui_id === linha.id) doc.substitui_id = null;
  }
}

// reservar_envio_conector e confirmar_envio_conector (supabase/migrations/20261104110000_etapa7_conector_atomico.sql)
// reproduzidas aqui, cada chamada atômica; a lógica de verdade é testada em supabase/tests/etapa7_conector_atomico.sql.
function reservarEnvio(a) {
  const janelaMs = 24 * 3600_000;
  const agora = Date.parse(a.p_agora);
  const naJanela = estado.tabelas.conector_envios
    .filter((e) => e.conector_id === a.p_conector && ["autorizado", "confirmado"].includes(e.estado) && Date.parse(e.em) > agora - janelaMs)
    .sort((x, y) => Date.parse(x.em) - Date.parse(y.em));
  let quantidade = naJanela.length;
  let bytes = naJanela.reduce((total, e) => total + e.tamanho, 0);
  const cabe = () => quantidade + 1 <= a.p_limite_envios && bytes + a.p_tamanho <= a.p_limite_bytes;
  if (!cabe()) {
    let liberaEm = agora + janelaMs;
    for (const e of naJanela) {
      quantidade -= 1;
      bytes -= e.tamanho;
      liberaEm = Date.parse(e.em) + janelaMs;
      if (cabe()) break;
    }
    return { reservado: false, tentar_depois_s: Math.max(1, Math.ceil((liberaEm - agora) / 1000)) };
  }
  const linha = inserir("conector_envios", {
    conector_id: a.p_conector, empreendimento_id: a.p_empreendimento, regra_id: a.p_regra, caminho_relativo: a.p_caminho,
    tamanho: a.p_tamanho, sha256: a.p_sha256, mtime: a.p_mtime, estado: "autorizado", storage_path: a.p_storage_path,
    documento_planejado_id: a.p_documento, em: a.p_agora,
  });
  return { reservado: true, envio_id: linha.id };
}

function confirmarNoBanco(a) {
  const { tabelas } = estado;
  const envio = tabelas.conector_envios.find((e) => e.id === a.p_envio && e.conector_id === a.p_conector);
  if (!envio) return { data: { situacao: "nao_autorizado" }, error: null };
  if (envio.estado === "confirmado") return { data: { situacao: "confirmado", documento_id: envio.documento_id, novo: false }, error: null };
  if (envio.estado !== "autorizado" || !envio.storage_path || !envio.documento_planejado_id) return { data: { situacao: "nao_autorizado" }, error: null };
  const regra = tabelas.pasta_regras.find((r) => r.id === envio.regra_id && r.ativa);
  if (!regra) return { data: { situacao: "sem_regra" }, error: null };

  const eEquipamento = regra.tipo === "equipamentos";
  if (eEquipamento !== (a.p_papel !== null && a.p_papel !== undefined) || eEquipamento !== (a.p_equipamento !== null && a.p_equipamento !== undefined)) {
    throw new Error("confirmar_envio_conector: equipamento e papel só vão (juntos) para regra de equipamentos");
  }
  const anterior = a.p_substitui ? tabelas.documentos.find((d) => d.id === a.p_substitui && d.empreendimento_id === envio.empreendimento_id) : null;
  let substitui = anterior ? a.p_substitui : null;
  let equipamentoDoDocumento = a.p_equipamento ?? null;
  if (anterior?.equipamento_papel) {
    // Revisão de SIMO/Laudo herda o equipamento; papel diferente não é revisão.
    if (anterior.equipamento_papel === a.p_papel) equipamentoDoDocumento = anterior.equipamento;
    else substitui = null;
  } else if (anterior && eEquipamento) {
    substitui = null;
  }
  // A categoria vem do banco, pelo papel: o chamador não escolhe.
  const categoriaDoDocumento = eEquipamento ? (a.p_papel === "simo" ? categoriaSimosId : categoriaLaudosId) : regra.categoria_id;
  const antes = { documentos: [...tabelas.documentos], origens: [...tabelas.documento_origens], envio: { ...envio } };
  const desfazer = () => {
    tabelas.documentos = antes.documentos;
    tabelas.documento_origens = antes.origens;
    Object.assign(envio, antes.envio);
  };
  try {
    inserir("documentos", {
      id: envio.documento_planejado_id, empreendimento_id: envio.empreendimento_id, projeto_id: regra.projeto_id, categoria_id: categoriaDoDocumento,
      grupo: regra.grupo, titulo: a.p_titulo, storage_path: envio.storage_path, mime: "application/pdf", tamanho: envio.tamanho, sha256: envio.sha256,
      liberado_cliente: false, substitui_id: substitui,
      ...(eEquipamento ? { equipamento: equipamentoDoDocumento, equipamento_papel: a.p_papel } : {}),
    });
    const falhaOrigem = estado.falhas.find((f) => f.tabela === "documento_origens" && f.operacao === "insert" && f.vezes > 0);
    if (falhaOrigem) {
      falhaOrigem.vezes--;
      throw violacao(falhaOrigem.code);
    }
    inserir("documento_origens", {
      documento_id: envio.documento_planejado_id, conector_id: a.p_conector, regra_id: regra.id, caminho_relativo: envio.caminho_relativo,
      tamanho: envio.tamanho, sha256: envio.sha256, mtime: envio.mtime,
    });
    try {
      atualizar("conector_envios", envio, { estado: "confirmado", documento_id: envio.documento_planejado_id, confirmado_em: a.p_agora });
    } catch (erro) {
      if (erro.codigo !== "23505") throw erro;
      desfazer();
      return { data: { situacao: "duplicado" }, error: null };
    }
  } catch (erro) {
    desfazer();
    if (erro.codigo) return { data: null, error: { code: erro.codigo } };
    throw erro;
  }
  return { data: { situacao: "confirmado", documento_id: envio.documento_planejado_id, novo: true }, error: null };
}

async function chamarFuncao(nome, args) {
  estado.eventos.push(["rpc", nome]);
  const falha = estado.falhas.find((item) => item.tabela === nome && item.operacao === "rpc" && item.vezes > 0);
  if (falha) { falha.vezes--; return { data: null, error: { code: falha.code } }; }
  const indice = estado.gatilhos.findIndex((g) => g.tabela === nome && g.operacao === "rpc");
  if (indice >= 0) estado.gatilhos.splice(indice, 1)[0].fn();
  if (nome === "reservar_envio_conector") return { data: reservarEnvio(args), error: null };
  if (nome === "confirmar_envio_conector") return confirmarNoBanco(args);
  throw new Error(`função não simulada: ${nome}`);
}

function criarBanco() {
  class Consulta {
    constructor(tabela) {
      this.tabela = tabela;
      this.filtros = [];
      this.operacao = "select";
      this.retorna = false;
      this.ordens = [];
      this.faixa = null;
      this.max = null;
    }
    select() { if (this.operacao !== "select") this.retorna = true; return this; }
    eq(campo, valor) { this.filtros.push((l) => l[campo] === valor); return this; }
    is(campo, valor) { this.filtros.push((l) => (l[campo] ?? null) === valor); return this; }
    not(campo, _op, valor) { this.filtros.push((l) => (l[campo] ?? null) !== valor); return this; }
    in(campo, valores) { this.filtros.push((l) => valores.includes(l[campo])); return this; }
    gt(campo, valor) { this.filtros.push((l) => l[campo] > valor); return this; }
    ilike(campo, padrao) { const re = padraoLike(padrao); this.filtros.push((l) => typeof l[campo] === "string" && re.test(l[campo])); return this; }
    order(campo, { ascending = true } = {}) { this.ordens.push([campo, ascending]); return this; }
    limit(n) { this.max = n; return this; }
    range(de, ate) { this.faixa = [de, ate]; return this; }
    insert(linha) { this.operacao = "insert"; this.linha = linha; return this; }
    update(campos) { this.operacao = "update"; this.campos = campos; return this; }
    delete() { this.operacao = "delete"; return this; }
    maybeSingle() { return this.executar("maybe"); }
    single() { return this.executar("single"); }
    then(resolver, rejeitar) { return this.executar("lista").then(resolver, rejeitar); }
    async executar(modo) {
      estado.eventos.push([this.operacao, this.tabela]);
      const falha = estado.falhas.find((item) => item.tabela === this.tabela && item.operacao === this.operacao && item.vezes > 0);
      if (falha) { falha.vezes--; return { data: null, error: { code: falha.code } }; }
      const indice = estado.gatilhos.findIndex((g) => g.tabela === this.tabela && g.operacao === this.operacao);
      if (indice >= 0) estado.gatilhos.splice(indice, 1)[0].fn();

      const linhas = estado.tabelas[this.tabela];
      const casa = (linha) => this.filtros.every((filtro) => filtro(linha));
      let resultado;
      try {
        if (this.operacao === "insert") resultado = [inserir(this.tabela, this.linha)];
        else if (this.operacao === "update") {
          resultado = linhas.filter(casa);
          for (const linha of resultado) atualizar(this.tabela, linha, this.campos);
        } else if (this.operacao === "delete") {
          resultado = linhas.filter(casa);
          for (const linha of resultado) remover(this.tabela, linha);
        } else {
          resultado = linhas.filter(casa);
          resultado.sort((a, b) => {
            for (const [campo, asc] of this.ordens) {
              if (a[campo] === b[campo]) continue;
              return (a[campo] > b[campo] ? 1 : -1) * (asc ? 1 : -1);
            }
            // Empate (mesmo milissegundo): vale a ordem de inserção, na direção do último critério.
            return (linhas.indexOf(a) - linhas.indexOf(b)) * (this.ordens.at(-1)?.[1] === false ? -1 : 1);
          });
        }
      } catch (erro) {
        if (erro.codigo) return { data: null, error: { code: erro.codigo } };
        throw erro;
      }
      if (this.operacao !== "select" && !this.retorna) return { data: null, error: null };
      resultado = resultado.map((linha) => ({ ...linha }));
      if (this.faixa) resultado = resultado.slice(this.faixa[0], this.faixa[1] + 1);
      if (this.max !== null) resultado = resultado.slice(0, this.max);
      if (modo === "maybe") return { data: resultado[0] ?? null, error: null };
      if (modo === "single") return resultado[0] ? { data: resultado[0], error: null } : { data: null, error: { code: "PGRST116" } };
      return { data: resultado, error: null };
    }
  }
  return { from: (tabela) => new Consulta(tabela), rpc: (nome, args) => chamarFuncao(nome, args) };
}

// ---------------------------------------------------------------------------------------------------------------

const consoleAnterior = { error: console.error, warn: console.warn };
const envAnterior = process.env.SUPABASE_SECRET_KEY;
const fetchAnterior = globalThis.fetch;
process.env.SUPABASE_SECRET_KEY = "segredo-de-teste-que-nunca-vai-a-log";
globalThis.fetch = async () => { throw new Error("Rede proibida neste teste."); };
console.error = (...args) => logs.push(args);
console.warn = (...args) => logs.push(args);

const autenticacao = carregar("src/lib/conector/autenticacao.ts");
const { hashDaChave, gerarChave } = autenticacao;
const { chave: CHAVE } = gerarChave();

try {
  const regras = carregar("src/lib/conector/regras.ts");
  const rotaConfiguracao = carregar("src/app/api/(modules)/conector/v1/configuracao/route.ts");
  const rotaEnvios = carregar("src/app/api/(modules)/conector/v1/envios/route.ts");
  const rotaConfirmar = carregar("src/app/api/(modules)/conector/v1/envios/[id]/confirmar/route.ts");
  const rotaStatus = carregar("src/app/api/(modules)/conector/v1/status/route.ts");
  const rotaAdmin = carregar("src/app/api/(modules)/adm-interno/portal/conector/route.ts");
  const { pedirAutorizacao } = carregar("src/app/api/(modules)/conector/v1/envios/service.ts");
  const { confirmarEnvio } = carregar("src/app/api/(modules)/conector/v1/envios/[id]/confirmar/service.ts");
  const { dependenciasPadrao } = carregar("src/lib/conector/dependencias.ts");
  const { resumirCiclo } = carregar("src/app/api/(modules)/adm-interno/portal/conector/service.ts");

  async function chamar(rota, metodo, corpo, { chave = CHAVE, params, cabecalhos = {} } = {}) {
    const headers = { ...(chave === null ? {} : { authorization: `Bearer ${chave}` }), ...cabecalhos };
    let body;
    if (corpo !== undefined) {
      body = typeof corpo === "string" ? corpo : JSON.stringify(corpo);
      headers["content-type"] = "application/json";
    }
    const request = new Request("https://site.invalid/api/conector/v1/x", { method: metodo, headers, body });
    return rota[metodo](request, params ? { params: Promise.resolve(params) } : undefined);
  }
  const corpoDe = async (resposta) => resposta.json();

  const pedido = (caminho, bytes, extra = {}) => ({
    codigo_pasta: "250101", caminho_relativo: caminho, tamanho: bytes.length, sha256: sha256Hex(bytes), mtime: "2026-11-04T10:00:00.000Z", ...extra,
  });
  async function pedir(caminho, bytes, extra) {
    const resposta = await chamar(rotaEnvios, "POST", pedido(caminho, bytes, extra));
    assert.equal(resposta.headers.get("Cache-Control"), "no-store");
    assert.equal(resposta.status, 200);
    return corpoDe(resposta);
  }
  const chaveDoUrl = (url) => decodeURIComponent(new URL(url).pathname.slice(1));
  function subir(autorizado, bytes, extra = {}) {
    objetos.set(chaveDoUrl(autorizado.url), { bytes, ...extra });
  }
  async function confirmar(envioId, opcoes) {
    const resposta = await chamar(rotaConfirmar, "POST", {}, { params: { id: envioId }, ...opcoes });
    assert.equal(resposta.headers.get("Cache-Control"), "no-store");
    return { status: resposta.status, corpo: await corpoDe(resposta) };
  }
  async function fluxo(caminho, bytes, extra) {
    const autorizado = await pedir(caminho, bytes, extra);
    assert.equal(autorizado.estado, "autorizado", JSON.stringify(autorizado));
    subir(autorizado, bytes);
    return { autorizado, ...(await confirmar(autorizado.envio_id)) };
  }
  const envios = () => estado.tabelas.conector_envios;
  const documentos = () => estado.tabelas.documentos;

  // ---------------------------------------------------------------------------------------------------------
  // Funções puras: caminho, lista de bloqueio, regras, limites.
  // ---------------------------------------------------------------------------------------------------------

  assert.equal(regras.LIMITE_PDF_BYTES, 104857600);
  assert.deepEqual([...regras.BLOQUEIO], ["DADOS DO EMPREENDEDOR", "COMPROVANTE", "NOTAS FISCAIS", "PLANILHA"]);

  assert.equal(regras.normalizarCaminho("A\\B\\Cafe\u0301.pdf"), "A/B/Café.pdf", "barra invertida vira / e NFD vira NFC");
  assert.deepEqual(regras.validarCaminho("03 - PRODUTOS\\LAN\\PLANTA.PDF"), { valido: true, caminho: "03 - PRODUTOS/LAN/PLANTA.PDF" });
  assert.deepEqual(regras.validarCaminho("pasta/a\u0301gua.pdf"), { valido: true, caminho: "pasta/água.pdf" });
  for (const ruim of ["../x.pdf", "a/../x.pdf", "a/./x.pdf", "a\\..\\x.pdf", "/abs/x.pdf", "a//x.pdf", "a/x.pdf/", "C:/x.pdf", "a:b/x.pdf",
    "a/x\u0000.pdf", "a/x\n.pdf", "a/x.txt", "a/x.pdf.exe", "a/.pdf", "", `${"a".repeat(1000)}.pdf`, "\ud800/x.pdf"]) {
    assert.equal(regras.validarCaminho(ruim).valido, false, `caminho recusado: ${JSON.stringify(ruim)}`);
  }
  assert.equal(regras.validarCaminho(`${"a".repeat(996)}.pdf`).valido, true, "1000 caracteres é o limite");

  for (const bloqueado of ["Comprovantes", "NOTAS FISCAIS", "notas fiscais", "Notas Fiscais 2024", "Dados do Empreendedor", "PLANILHA", "planílha de custos",
    "COMPRÓVANTE", "Dados do Empreendedór", "Notas  Fiscais", "NOTAS-FISCAIS", "notas_fiscais", "DADOS DO  EMPREENDEDOR", "Ｃｏｍｐｒｏｖａｎｔｅ", "PLANI LHA"]) {
    assert.equal(regras.segmentoBloqueado(bloqueado), true, bloqueado);
  }
  for (const livre of ["PLANTA BAIXA", "APROVADO NO INTERLIGA", "NOTAS", "FISCAL", "Empreendedor"]) assert.equal(regras.segmentoBloqueado(livre), false, livre);
  assert.equal(regras.caminhoBloqueado("a/b/Comprovantes de renda/x.pdf"), true);
  assert.equal(regras.caminhoBloqueado("a\\NOTAS FISCAIS\\x.pdf"), true);
  assert.equal(regras.caminhoBloqueado("a/b/planilha-obra.pdf"), true, "o nome do arquivo também é segmento");

  const lista = [
    { id: "b", caminho_prefixo: PREFIXO_LAN },
    { id: "c", caminho_prefixo: PREFIXO_APROVADO },
    { id: "a", caminho_prefixo: "03 - produtos\\lan" },
  ];
  assert.equal(regras.casarRegra("03 - PRODUTOS/LAN/APROVADO NO INTERLIGA/x.pdf", lista).id, "c", "prefixo mais longo vence");
  assert.equal(regras.casarRegra("03 - PRODUTOS/LAN/OUTRA/x.pdf", lista).id, "a", "empate de tamanho: menor id, sem diferenciar caixa");
  assert.equal(regras.casarRegra("03 - produtos/lan/aprovado no interliga/x.pdf", lista).id, "c", "sem diferenciar caixa");
  assert.equal(regras.casarRegra("03 - PRODUTOS/LANX/x.pdf", lista), null, "fronteira de segmento");
  assert.equal(regras.casarRegra("03 - PRODUTOS/x.pdf", lista), null);
  assert.equal(regras.casarRegra("03 - PRODUTOS/LAN.pdf", lista), null, "arquivo com o nome do prefixo não é a pasta");
  assert.equal(regras.casarRegra("a.pdf", []), null);

  // SIMOS e Laudos por equipamento (src/lib/conector/equipamentos.ts).
  const equipamentos = carregar("src/lib/conector/equipamentos.ts");
  const PREFIXO_SL = "03 - PRODUTOS/19 - SIMOS E LAUDOS";
  const classificar = (caminho, prefixo = PREFIXO_SL) => equipamentos.classificarEquipamento(caminho, prefixo);
  assert.deepEqual(classificar(`${PREFIXO_SL}/01 - BOMBAS/SIMO - Bombas.pdf`), { papel: "simo", equipamento: "BOMBAS", pasta: "01 - BOMBAS" }, "SIMO solto");
  assert.equal(classificar(`${PREFIXO_SL}/01 - BOMBAS/simo bombas.pdf`)?.papel, "simo", "simo minúsculo");
  assert.equal(classificar(`${PREFIXO_SL}/01 - BOMBAS/Símo bombas.pdf`)?.papel, "simo", "acento não conta");
  assert.equal(classificar(`${PREFIXO_SL}/01 - BOMBAS/  SIMO bombas.pdf`), null, "o nome tem de começar por SIMO, sem espaços antes");
  assert.equal(classificar(`${PREFIXO_SL}/01 - BOMBAS/Ficha técnica.pdf`), null, "PDF solto sem SIMO");
  assert.equal(classificar(`${PREFIXO_SL}/01 - BOMBAS/Laudo SIMO.pdf`), null, "SIMO no meio do nome não vale");
  assert.deepEqual(classificar(`${PREFIXO_SL}/01 - BOMBAS/LAUDO/qualquer nome.pdf`), { papel: "laudo", equipamento: "BOMBAS", pasta: "01 - BOMBAS" });
  assert.equal(classificar(`${PREFIXO_SL}/02 - RESERVATÓRIO/LAUDOS/x.pdf`), null, "só a pasta LAUDO vale");
  assert.equal(classificar(`${PREFIXO_SL}/02 - RESERVATÓRIO/laudo/x.pdf`)?.papel, "laudo", "laudo em minúsculas");
  assert.equal(classificar(`${PREFIXO_SL}/02 - RESERVATÓRIO/laudo/x.pdf`)?.papel, "laudo", "laudo minúsculo");
  assert.equal(classificar(`${PREFIXO_SL}/02 - RESERVATÓRIO/Láudo/x.pdf`)?.papel, "laudo", "acento não conta");
  assert.equal(classificar(`${PREFIXO_SL}/01 - BOMBAS/LAUDO/SIMO x.pdf`)?.papel, "laudo", "dentro de LAUDO é laudo, mesmo com SIMO no nome");
  assert.equal(classificar(`${PREFIXO_SL}/01 - BOMBAS/LAUDO/sub/x.pdf`), null, "subpasta dentro de LAUDO");
  assert.equal(classificar(`${PREFIXO_SL}/01 - BOMBAS/apoio/x.pdf`), null, "pasta de apoio");
  assert.equal(classificar(`${PREFIXO_SL}/01 - BOMBAS/apoio/SIMO x.pdf`), null, "SIMO dentro de subpasta de apoio");
  assert.equal(classificar(`${PREFIXO_SL}/SIMO x.pdf`), null, "arquivo direto na pasta da regra");
  assert.equal(classificar(`${PREFIXO_SL}/LAUDO/x.pdf`), null, "LAUDO direto na pasta da regra não tem equipamento");
  assert.equal(classificar("03 - produtos\\19 - simos e laudos\\01 - BOMBAS\\SIMO x.pdf")?.equipamento, "BOMBAS", "prefixo com caixa e barra diferentes");
  assert.equal(classificar(`${PREFIXO_SL}X/01 - BOMBAS/SIMO x.pdf`), null, "fronteira de segmento do prefixo");
  assert.equal(classificar("03 - PRODUTOS/01 - BOMBAS/SIMO x.pdf"), null, "fora do prefixo");
  assert.equal(equipamentos.nomeDoEquipamento("01 - BOMBAS"), "BOMBAS");
  assert.equal(equipamentos.nomeDoEquipamento("03.PAINÉIS"), "PAINÉIS");
  assert.equal(equipamentos.nomeDoEquipamento("2 _ Cabos  de   aço"), "Cabos de aço");
  assert.equal(equipamentos.nomeDoEquipamento("3D SCAN"), "3D SCAN", "sem separador o número fica");
  assert.equal(equipamentos.nomeDoEquipamento("01 -"), "01 -", "só o número: usa a pasta inteira");
  assert.equal(equipamentos.nomeDoEquipamento("RESERVATÓRIO"), "RESERVATÓRIO");
  assert.equal(equipamentos.nomeDoEquipamento("01 - A\u0000B\tC"), "A B C", "caractere de controle vira espaço");
  assert.equal([...equipamentos.nomeDoEquipamento(`01 - ${"é".repeat(300)}`)].length, 160);
  assert.equal(equipamentos.MOTIVO_FORA_DO_PADRAO, "Fora do padrão de SIMOS e Laudos.");

  assert.equal(regras.tituloDoCaminho("a/b/PLANTA BAIXA.PDF"), "PLANTA BAIXA");
  assert.equal(regras.tituloDoCaminho(`x/${"é".repeat(300)}.pdf`), "é".repeat(160));
  assert.equal(regras.tituloDoCaminho("x/  .pdf"), "Documento");
  assert.equal(regras.limparMensagem("falha em C:\\Dados\\Cliente\\x.pdf e \\\\srv\\share\\y.pdf ok\n"), "falha em [caminho]", "unidade vale até o fim da mensagem");
  // Nome de pasta tem espaço: a limpeza não pode parar no primeiro (sobraria "CONSULTORIA\Clientes\x.pdf").
  for (const [entrada, esperado] of [
    ["Falha em C:\\ABA CONSULTORIA\\Clientes\\x.pdf", "Falha em [caminho]"],
    ["Falha em c:/ABA CONSULTORIA/Clientes/x.pdf por permissão", "Falha em [caminho]"],
    ["acesso a \\\\srv\\Pasta Cliente\\y.pdf negado", "acesso a [caminho]"],
    ["erro em //srv/Pasta Cliente/y.pdf", "erro em [caminho]"],
    ["falha em Clientes/Obra 1/planta baixa.pdf", "falha em [caminho]"],
    ["falha em Clientes\\Obra 1\\planta baixa.pdf", "falha em [caminho]"],
    ["Duas pastas começam com 250101 - ", "Duas pastas começam com 250101 -"],
    ["erro 404/500 na rede", "erro 404/500 na rede"],
    ["letra C: sem barra", "letra C: sem barra"],
  ]) assert.equal(regras.limparMensagem(entrada), esperado, entrada);

  for (const boa of ["03 - PRODUTOS", "03 - PRODUTOS/LAN", "a/b/c/d/e", "Pasta com espaço"]) assert.equal(regras.caminhoDePastaValido(boa, 5), true, boa);
  for (const ruim of ["03\\LAN", "\\\\srv\\share", "//srv/share", "/03", "C:\\x", "C:/x", "a/b:c", "a\\", "", "a//b", "a/../b", "a/b/c/d/e/f"]) {
    assert.equal(regras.caminhoDePastaValido(ruim, 5), false, `pasta recusada: ${JSON.stringify(ruim)}`);
  }

  assert.equal(autenticacao.extrairChave(`Bearer ${CHAVE}`), CHAVE);
  assert.equal(autenticacao.extrairChave(`bearer ${CHAVE}`), CHAVE);
  for (const ruim of [null, "", CHAVE, `Basic ${CHAVE}`, `Bearer ${CHAVE}x`, `Bearer ${CHAVE.slice(1)}`, `Bearer ${CHAVE.replace("abacon_", "abacom_")}`, `Bearer  ${CHAVE}`]) {
    assert.equal(autenticacao.extrairChave(ruim), null, String(ruim));
  }
  assert.match(CHAVE, /^abacon_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(gerarChave().chave, gerarChave().chave);

  // ---------------------------------------------------------------------------------------------------------
  // Autenticação: 404 vazio em todas as rotas.
  // ---------------------------------------------------------------------------------------------------------

  reiniciar();
  const outraChave = gerarChave().chave;
  const naoAutenticados = [
    ["ausente", null], ["errada", outraChave], ["malformada", "abacon_curta"],
  ];
  for (const [nome, chave] of naoAutenticados) {
    const tentativas = [
      await chamar(rotaConfiguracao, "GET", undefined, { chave }),
      await chamar(rotaEnvios, "POST", pedido("03 - PRODUTOS/LAN/x.pdf", pdf(1)), { chave }),
      await chamar(rotaConfirmar, "POST", {}, { chave, params: { id: randomUUID() } }),
      await chamar(rotaStatus, "POST", {}, { chave }),
    ];
    for (const resposta of tentativas) {
      assert.equal(resposta.status, 404, `chave ${nome}`);
      assert.equal(await resposta.text(), "", `chave ${nome}: corpo vazio`);
    }
  }
  estado.tabelas.conectores[0].revogado_em = "2026-11-04T09:30:00.000Z";
  for (const resposta of [
    await chamar(rotaConfiguracao, "GET"),
    await chamar(rotaEnvios, "POST", pedido("03 - PRODUTOS/LAN/x.pdf", pdf(1))),
    await chamar(rotaStatus, "POST", {}),
  ]) {
    assert.equal(resposta.status, 404, "chave revogada");
    assert.equal(await resposta.text(), "");
  }
  assert.equal(envios().length, 0, "nada é gravado sem chave válida");
  assert.equal(chamadasLimitar.length, 0, "sem chave válida nem o limite de requisições é consultado");

  reiniciar();
  estado.falhas.push({ tabela: "conectores", operacao: "select", code: "XX000", vezes: 1 });
  let resposta = await chamar(rotaConfiguracao, "GET");
  assert.equal(resposta.status, 500, "banco fora do ar não é 'chave errada'");
  assert.deepEqual(await corpoDe(resposta), { erro: "interno" });

  // Limite de requisições por hora.
  reiniciar();
  assert.equal((await chamar(rotaConfiguracao, "GET")).status, 200);
  assert.deepEqual(chamadasLimitar[0], [`conector-requisicoes:${conectorId}`, 600, 3600]);
  bloquearRequisicoes = true;
  resposta = await chamar(rotaConfiguracao, "GET");
  assert.equal(resposta.status, 429);
  assert.deepEqual(await corpoDe(resposta), { erro: "limite", tentar_depois_s: 3600 });
  assert.equal(resposta.headers.get("Cache-Control"), "no-store");
  bloquearRequisicoes = false;

  // ---------------------------------------------------------------------------------------------------------
  // GET /configuracao
  // ---------------------------------------------------------------------------------------------------------

  reiniciar();
  estado.tabelas.empreendimentos.push({ id: randomUUID(), codigo_pasta: "250104", situacao: "concluido", liberacao_automatica: true });
  resposta = await chamar(rotaConfiguracao, "GET");
  assert.equal(resposta.status, 200);
  assert.equal(resposta.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await corpoDe(resposta), {
    versao_api: 1,
    limite_bytes: 104857600,
    bloqueio: ["DADOS DO EMPREENDEDOR", "COMPROVANTE", "NOTAS FISCAIS", "PLANILHA"],
    empreendimentos: [{
      codigo_pasta: "250101",
      regras: [
        { id: regraContratoId, caminho_prefixo: "01 - FINANCEIRO/01 - PROPOSTA-CONTRATO" },
        { id: regraLanId, caminho_prefixo: PREFIXO_LAN },
        { id: regraAprovadoId, caminho_prefixo: PREFIXO_APROVADO },
      ],
    }, { codigo_pasta: "250103", regras: [] }],
  }, "só ativos e com código (sem regra vem vazio, para a árvore alimentar as sugestões); sem nome, destino nem interruptores; prefixo com /");
  assert.ok(estado.tabelas.conectores[0].ultimo_contato_em, "atualiza ultimo_contato_em");

  // ---------------------------------------------------------------------------------------------------------
  // POST /envios: recusas
  // ---------------------------------------------------------------------------------------------------------

  reiniciar();
  const bytes1 = pdf(1);
  for (const [caminho, trecho, extra] of [
    ["03 - PRODUTOS/LAN/../../x.pdf", "inválido", {}],
    ["03 - PRODUTOS/LAN//x.pdf", "inválido", {}],
    ["C:\\Servidor\\03 - PRODUTOS\\LAN\\x.pdf", "\":\"", {}],
    ["03 - PRODUTOS/LAN/Comprovantes/x.pdf", "bloqueado", {}],
    ["03 - PRODUTOS/LAN/NOTAS FISCAIS/x.pdf", "bloqueado", {}],
    ["03 - PRODUTOS/LAN/comprovántes/x.pdf", "bloqueado", {}],
    ["03 - PRODUTOS/LAN/DADOS DO EMPREENDEDOR/x.pdf", "bloqueado", {}],
    ["03 - PRODUTOS/LAN/Planilha geral.pdf", "bloqueado", {}],
    ["03 - PRODUTOS/LAN/x.docx", "PDF", {}],
    ["03 - PRODUTOS/LAN/x.pdf.exe", "PDF", {}],
    ["03 - PRODUTOS/OUTRA/x.pdf", "fora de qualquer regra", {}],
    ["03 - PRODUTOS/LANX/x.pdf", "fora de qualquer regra", {}],
    ["99 - INATIVA/x.pdf", "fora de qualquer regra", {}],
    ["03 - PRODUTOS/LAN/grande.pdf", "100 MB", { tamanho: 104857601 }],
    ["03 - PRODUTOS/LAN/vazio.pdf", "vazio", { tamanho: 0 }],
  ]) {
    const corpo = await pedir(caminho, bytes1, extra);
    assert.equal(corpo.estado, "recusado", caminho);
    assert.ok(corpo.motivo.includes(trecho), `${caminho}: ${corpo.motivo}`);
    assert.deepEqual(Object.keys(corpo).sort(), ["estado", "motivo"]);
  }
  assert.equal(envios().length, 15, "toda recusa de empreendimento conhecido fica registrada");
  assert.ok(envios().every((e) => e.estado === "recusado" && e.erro && e.storage_path === null && e.documento_planejado_id === null));
  assert.equal(estado.eventos.some(([tipo]) => tipo === "presign"), false, "recusado nunca gera URL de envio");
  assert.equal(envios().find((e) => e.caminho_relativo.includes("\u0000")), undefined);

  assert.deepEqual(await pedir("03 - PRODUTOS/LAN/x.pdf", bytes1, { codigo_pasta: "250102" }), { estado: "recusado", motivo: "Empreendimento inativo." });
  const antes = envios().length;
  assert.deepEqual(await pedir("03 - PRODUTOS/LAN/x.pdf", bytes1, { codigo_pasta: "999999" }), { estado: "recusado", motivo: "Empreendimento não encontrado." });
  assert.equal(envios().length, antes + 0, "empreendimento desconhecido não tem onde registrar");
  assert.equal((await pedir("03 - PRODUTOS/LAN/x.pdf", bytes1, { codigo_pasta: "250103" })).estado, "recusado", "sem regra ativa");

  // Corpo inválido: 400 { erro: "invalido", detalhe }.
  for (const corpo of [
    {}, { ...pedido("a.pdf", bytes1), extra: 1 }, pedido("a.pdf", bytes1, { sha256: sha256Hex(bytes1).toUpperCase() }), pedido("a.pdf", bytes1, { codigo_pasta: "12345" }),
    pedido("a.pdf", bytes1, { tamanho: -1 }), pedido("a.pdf", bytes1, { tamanho: 1.5 }), pedido("a.pdf", bytes1, { mtime: "ontem" }), "não é json", "[]",
  ]) {
    resposta = await chamar(rotaEnvios, "POST", corpo);
    assert.equal(resposta.status, 400, JSON.stringify(corpo));
    const erro = await corpoDe(resposta);
    assert.equal(erro.erro, "invalido");
    assert.equal(typeof erro.detalhe, "string");
    assert.ok(erro.detalhe.length > 0 && erro.detalhe.length <= 200);
  }
  resposta = await chamar(rotaEnvios, "POST", { ...pedido("a.pdf", bytes1), caminho_relativo: "x".repeat(20_000) });
  assert.equal(resposta.status, 400, "corpo grande demais");

  // ---------------------------------------------------------------------------------------------------------
  // POST /envios: autorizado, normalização, ja_enviado, duplicado, revisão
  // ---------------------------------------------------------------------------------------------------------

  reiniciar();
  const planta = pdf("planta");
  const autorizado = await pedir(`${PREFIXO_APROVADO}/PLANTA BAIXA.pdf`, planta);
  assert.deepEqual(Object.keys(autorizado).sort(), ["cabecalhos", "envio_id", "estado", "expira_em", "url"]);
  assert.equal(autorizado.estado, "autorizado");
  assert.deepEqual(autorizado.cabecalhos, { "content-type": "application/pdf", "x-amz-checksum-sha256": sha256Base64(planta) });
  assert.ok(Math.abs(Date.parse(autorizado.expira_em) - (Date.now() + 5 * 60_000)) < 5000, "expira em 5 minutos");
  const linha = envios()[0];
  assert.equal(linha.id, autorizado.envio_id);
  assert.equal(linha.estado, "autorizado");
  assert.equal(linha.conector_id, conectorId);
  assert.equal(linha.empreendimento_id, empId);
  assert.equal(linha.regra_id, regraAprovadoId, "prefixo mais longo vence");
  assert.equal(linha.sha256, sha256Hex(planta));
  assert.equal(linha.tamanho, planta.length);
  assert.equal(linha.mtime, "2026-11-04T10:00:00.000Z");
  assert.match(linha.documento_planejado_id, /^[0-9a-f-]{36}$/);
  assert.equal(linha.storage_path, `${empId}/${linha.documento_planejado_id}.pdf`);
  assert.equal(chaveDoUrl(autorizado.url), linha.storage_path);
  assert.equal(documentos().length, 0, "autorizar não cria documento");

  // Normalização: barra invertida, maiúsculas e NFD autorizam e gravam o caminho em NFC com "/".
  const outra = pdf("outra");
  const normalizado = await pedir("03 - PRODUTOS\\LAN\\PROJETO A\u0301GUA.PDF", outra);
  assert.equal(normalizado.estado, "autorizado");
  assert.equal(envios().at(-1).caminho_relativo, "03 - PRODUTOS/LAN/PROJETO ÁGUA.PDF");
  assert.equal(envios().at(-1).regra_id, regraLanId);
  assert.equal((await pedir("03 - produtos/lan/outro.pdf", pdf("caixa"))).estado, "autorizado", "regra sem diferenciar caixa");

  // Confirmar o primeiro: destino da regra, título, origem.
  subir(autorizado, planta);
  let confirmado = await confirmar(autorizado.envio_id);
  assert.equal(confirmado.status, 200);
  assert.deepEqual(Object.keys(confirmado.corpo).sort(), ["documento_id", "estado", "liberado"]);
  assert.equal(confirmado.corpo.estado, "confirmado");
  assert.equal(confirmado.corpo.documento_id, linha.documento_planejado_id, "o documento nasce com o id planejado");
  const doc1 = documentos().find((d) => d.id === confirmado.corpo.documento_id);
  assert.equal(doc1.titulo, "PLANTA BAIXA");
  assert.equal(doc1.projeto_id, projetoId);
  assert.equal(doc1.categoria_id, categoria2Id);
  assert.equal(doc1.grupo, null);
  assert.equal(doc1.storage_path, linha.storage_path);
  assert.equal(doc1.mime, "application/pdf");
  assert.equal(doc1.tamanho, planta.length);
  assert.equal(doc1.sha256, sha256Hex(planta));
  assert.equal(doc1.substitui_id, null);
  assert.equal(doc1.empreendimento_id, empId);
  assert.equal(doc1.liberado_cliente, false, "empreendimento com a liberação automática desligada");
  assert.equal(confirmado.corpo.liberado, false);
  assert.equal(doc1.liberado_em, null);
  const origem = estado.tabelas.documento_origens[0];
  assert.deepEqual({ ...origem, id: undefined }, {
    id: undefined, documento_id: doc1.id, conector_id: conectorId, regra_id: regraAprovadoId,
    caminho_relativo: `${PREFIXO_APROVADO}/PLANTA BAIXA.pdf`, tamanho: planta.length, sha256: sha256Hex(planta), mtime: "2026-11-04T10:00:00.000Z",
  });
  assert.equal(envios()[0].estado, "confirmado");
  assert.equal(envios()[0].documento_id, doc1.id);
  assert.ok(envios()[0].confirmado_em);

  // Confirmar é idempotente: mesmo resultado, sem segundo documento nem segunda origem.
  const eventosAntes = estado.eventos.length;
  const repetido = await confirmar(autorizado.envio_id);
  assert.deepEqual(repetido, confirmado);
  assert.equal(documentos().length, 1);
  assert.equal(estado.tabelas.documento_origens.length, 1);
  assert.equal(estado.eventos.slice(eventosAntes).some(([tipo]) => tipo === "insert" || tipo === "remover"), false);

  // ja_enviado: mesmo caminho (sem diferenciar caixa/barra) e mesmo sha256 do último confirmado.
  const totalAntes = envios().length;
  assert.deepEqual(await pedir(`${PREFIXO_APROVADO}/PLANTA BAIXA.pdf`, planta), { estado: "ja_enviado" });
  assert.deepEqual(await pedir(`${PREFIXO_APROVADO.toLowerCase().replaceAll("/", "\\")}\\planta baixa.PDF`, planta), { estado: "ja_enviado" });
  assert.equal(envios().length, totalAntes, "ja_enviado não grava linha");

  // duplicado: mesmo conteúdo por outro caminho.
  assert.deepEqual(await pedir(`${PREFIXO_LAN}/COPIA DA PLANTA.pdf`, planta), { estado: "duplicado" });
  const linhaDuplicada = envios().at(-1);
  assert.equal(linhaDuplicada.estado, "duplicado");
  assert.equal(linhaDuplicada.regra_id, regraLanId);
  assert.equal(linhaDuplicada.storage_path, null);

  // Revisão: mesmo caminho, conteúdo novo -> autorizado; confirmar gera substitui_id.
  const planta2 = pdf("planta v2");
  const revisao = await fluxo(`${PREFIXO_APROVADO}/planta baixa.pdf`, planta2);
  assert.equal(revisao.corpo.estado, "confirmado");
  const doc2 = documentos().find((d) => d.id === revisao.corpo.documento_id);
  assert.equal(doc2.substitui_id, doc1.id, "revisão aponta o documento do último envio confirmado do caminho");
  assert.equal(doc2.familia_id, doc1.familia_id);
  assert.equal(doc2.liberado_cliente, false);
  assert.equal(estado.tabelas.documento_origens.length, 2);
  assert.deepEqual(await pedir(`${PREFIXO_APROVADO}/PLANTA BAIXA.pdf`, planta), { estado: "duplicado" }, "voltar ao conteúdo antigo é cópia de algo já enviado");

  // Documento anterior apagado no site: a revisão seguinte não aponta para ele.
  documentos().splice(documentos().findIndex((d) => d.id === doc2.id), 1);
  estado.tabelas.documento_origens.splice(1, 1);
  envios().find((e) => e.documento_id === doc2.id).documento_id = null;
  const revisao3 = await fluxo(`${PREFIXO_APROVADO}/planta baixa.pdf`, pdf("planta v3"));
  assert.equal(documentos().find((d) => d.id === revisao3.corpo.documento_id).substitui_id, null);

  // Destino por grupo (contratos), título longo e prefixo cadastrado com "\".
  const contrato = await fluxo(`${PREFIXO_CONTRATO}/${"c".repeat(300)}.pdf`, pdf("contrato"));
  const docContrato = documentos().find((d) => d.id === contrato.corpo.documento_id);
  assert.equal(docContrato.grupo, "contratos");
  assert.equal(docContrato.projeto_id, null);
  assert.equal(docContrato.categoria_id, null);
  assert.equal(docContrato.titulo.length, 160);
  const naRegraLan = await fluxo(`${PREFIXO_LAN}/Sem categoria nova.pdf`, pdf("lan"));
  const docLan = documentos().find((d) => d.id === naRegraLan.corpo.documento_id);
  assert.equal(docLan.categoria_id, categoriaId);
  assert.equal(docLan.liberado_cliente, false, "regra sem liberação automática");

  // ---------------------------------------------------------------------------------------------------------
  // Liberação automática: só com regra E empreendimento E interruptor geral.
  // ---------------------------------------------------------------------------------------------------------

  for (const regraAuto of [false, true]) {
    for (const empAuto of [false, true]) {
      for (const geral of [false, true]) {
        reiniciar({ regraAuto, empAuto, geral });
        const esperado = regraAuto && empAuto && geral;
        const r = await fluxo(`${PREFIXO_APROVADO}/auto.pdf`, pdf("auto"));
        const nome = `regra=${regraAuto} empreendimento=${empAuto} geral=${geral}`;
        assert.equal(r.corpo.liberado, esperado, nome);
        const doc = documentos().find((d) => d.id === r.corpo.documento_id);
        assert.equal(doc.liberado_cliente, esperado, nome);
        assert.equal(doc.liberado_em !== null, esperado, `${nome}: liberado_em`);
        assert.equal(doc.liberado_por, null, `${nome}: liberado_por (sem usuário na secret key)`);
      }
    }
  }

  // Revisão com liberação automática: a nova substitui a anterior na hora; sem ela, a anterior continua visível.
  reiniciar({ regraAuto: true, empAuto: true, geral: true });
  const v1 = await fluxo(`${PREFIXO_APROVADO}/rev.pdf`, pdf("rev 1"));
  const v2 = await fluxo(`${PREFIXO_APROVADO}/rev.pdf`, pdf("rev 2"));
  assert.equal(v2.corpo.liberado, true);
  assert.equal(documentos().find((d) => d.id === v1.corpo.documento_id).liberado_cliente, false, "anterior sai do ar");
  assert.equal(documentos().find((d) => d.id === v2.corpo.documento_id).liberado_cliente, true);

  reiniciar({ regraAuto: true, empAuto: true, geral: true });
  const w1 = await fluxo(`${PREFIXO_APROVADO}/rev.pdf`, pdf("rev 1"));
  estado.tabelas.configuracoes_conector[0].liberacao_automatica_geral = false;
  const w2 = await fluxo(`${PREFIXO_APROVADO}/rev.pdf`, pdf("rev 2"));
  assert.equal(w2.corpo.liberado, false);
  assert.equal(documentos().find((d) => d.id === w1.corpo.documento_id).liberado_cliente, true, "o cliente continua vendo a anterior");
  assert.equal(documentos().find((d) => d.id === w2.corpo.documento_id).liberado_cliente, false);

  // Falha ao liberar: o documento fica oculto (falha segura) e o envio continua confirmado.
  reiniciar({ regraAuto: true, empAuto: true, geral: true });
  estado.falhas.push({ tabela: "documentos", operacao: "update", code: "XX000", vezes: 1 });
  const semLiberar = await fluxo(`${PREFIXO_APROVADO}/falha.pdf`, pdf("falha"));
  assert.equal(semLiberar.corpo.estado, "confirmado");
  assert.equal(semLiberar.corpo.liberado, false);
  assert.equal(documentos()[0].liberado_cliente, false);

  // ---------------------------------------------------------------------------------------------------------
  // Confirmar: recusas
  // ---------------------------------------------------------------------------------------------------------

  const casosDeDivergencia = [
    ["sha256 diferente", (b) => ({ bytes: b, sha256Base64: sha256Base64(pdf("outro")) })],
    ["tamanho diferente", (b) => ({ bytes: Buffer.concat([b, Buffer.from("x")]) })],
    ["objeto truncado", (b) => ({ bytes: b.subarray(0, b.length - 2), sha256Base64: sha256Base64(b) })],
    ["tipo diferente", (b) => ({ bytes: b, contentType: "application/zip" })],
    ["não começa com %PDF-", (b) => {
      const falso = Buffer.from(b);
      falso.write("PK\u0003\u0004", 0);
      return { bytes: falso, sha256Base64: sha256Base64(b) };
    }],
  ];
  for (const [nome, objeto] of casosDeDivergencia) {
    reiniciar();
    const bytes = pdf(`divergente ${nome}`);
    const a = await pedir(`${PREFIXO_LAN}/d.pdf`, bytes);
    const chave = chaveDoUrl(a.url);
    objetos.set(chave, objeto(bytes));
    const r = await confirmar(a.envio_id);
    assert.equal(r.status, 200, nome);
    assert.equal(r.corpo.estado, "recusado", nome);
    assert.equal(typeof r.corpo.motivo, "string");
    assert.equal(objetos.has(chave), false, `${nome}: objeto apagado do R2`);
    assert.equal(documentos().length, 0, `${nome}: sem documento`);
    assert.equal(estado.tabelas.documento_origens.length, 0);
    assert.equal(envios()[0].estado, "recusado", `${nome}: envio marcado`);
    assert.ok(envios()[0].erro);
    const de_novo = await confirmar(a.envio_id);
    assert.equal(de_novo.corpo.estado, "recusado", "confirmar um envio recusado continua recusado");
  }
  // Os mesmos bytes, mas objeto ausente.
  reiniciar();
  const ausente = await pedir(`${PREFIXO_LAN}/ausente.pdf`, pdf("ausente"));
  const rAusente = await confirmar(ausente.envio_id);
  assert.equal(rAusente.corpo.estado, "recusado");
  assert.equal(documentos().length, 0);

  // Dono, existência e estado do envio.
  reiniciar();
  const dono = await pedir(`${PREFIXO_LAN}/dono.pdf`, pdf("dono"));
  subir(dono, pdf("dono"));
  estado.tabelas.conectores.push({ id: outroConectorId, nome: "Outro", token_hash: hashDaChave(outraChave), revogado_em: null });
  const deOutro = await confirmar(dono.envio_id, { chave: outraChave });
  assert.equal(deOutro.corpo.estado, "recusado", "envio de outra chave");
  assert.equal(documentos().length, 0);
  assert.equal(envios()[0].estado, "autorizado", "não mexe no envio alheio");
  assert.equal((await confirmar(randomUUID())).corpo.estado, "recusado");
  resposta = await chamar(rotaConfirmar, "POST", {}, { params: { id: "../../x" } });
  assert.equal(resposta.status, 400);
  assert.equal((await corpoDe(resposta)).erro, "invalido");
  resposta = await chamar(rotaConfirmar, "POST", { extra: 1 }, { params: { id: dono.envio_id } });
  assert.equal(resposta.status, 400, "corpo desconhecido");
  const semCorpo = await chamar(rotaConfirmar, "POST", undefined, { params: { id: dono.envio_id } });
  assert.equal((await corpoDe(semCorpo)).estado, "confirmado", "sem corpo vale como {}");

  const recusadoAntes = await pedir(`${PREFIXO_LAN}/Comprovantes/y.pdf`, pdf("y"));
  assert.equal(recusadoAntes.estado, "recusado");
  const idRecusado = envios().find((e) => e.estado === "recusado").id;
  assert.equal((await confirmar(idRecusado)).corpo.estado, "recusado", "só se confirma o que foi autorizado");

  // Validade: confirmar até 1 h depois da autorização.
  reiniciar();
  const relogio = { agora: Date.parse("2026-11-04T12:00:00.000Z") };
  const dep = { ...dependenciasPadrao, agora: () => relogio.agora };
  const conector = { id: conectorId, nome: "Servidor" };
  const bytesTempo = pdf("tempo");
  const tempo = await pedirAutorizacao(pedido(`${PREFIXO_LAN}/t.pdf`, bytesTempo), conector, dep);
  assert.equal(tempo.expira_em, "2026-11-04T12:05:00.000Z");
  subir(tempo, bytesTempo);
  relogio.agora += 59 * 60_000;
  const noPrazo = await confirmarEnvio(tempo.envio_id, conector, dep);
  assert.equal(noPrazo.estado, "confirmado", "59 min depois ainda vale (a URL expirou, mas o objeto já está no R2)");

  const bytesTarde = pdf("tarde");
  const tarde = await pedirAutorizacao(pedido(`${PREFIXO_LAN}/tarde.pdf`, bytesTarde), conector, dep);
  subir(tarde, bytesTarde);
  relogio.agora += 61 * 60_000;
  const expirado = await confirmarEnvio(tarde.envio_id, conector, dep);
  assert.equal(expirado.estado, "recusado");
  assert.equal(objetos.has(chaveDoUrl(tarde.url)), false, "autorização vencida apaga o objeto");
  assert.equal(envios().find((e) => e.id === tarde.envio_id).estado, "recusado");

  // R2 fora do ar: 500, o envio continua autorizado e o objeto fica.
  reiniciar();
  const bytesR2 = pdf("r2 fora");
  const r2 = await pedir(`${PREFIXO_LAN}/r2.pdf`, bytesR2);
  subir(r2, bytesR2);
  estado.falhaR2 = true;
  resposta = await chamar(rotaConfirmar, "POST", {}, { params: { id: r2.envio_id } });
  assert.equal(resposta.status, 500);
  assert.deepEqual(await corpoDe(resposta), { erro: "interno" });
  assert.equal(envios()[0].estado, "autorizado");
  assert.equal(objetos.has(chaveDoUrl(r2.url)), true);
  estado.falhaR2 = false;
  assert.equal((await confirmar(r2.envio_id)).corpo.estado, "confirmado", "repetir depois funciona");

  // Confirmação que falha no meio (a origem não grava depois de o documento entrar) não deixa nada: o documento,
  // a origem e o envio confirmado são uma transação só. O envio segue autorizado e repetir funciona.
  reiniciar();
  const bytesParcial = pdf("parcial");
  const parcial = await pedir(`${PREFIXO_LAN}/parcial.pdf`, bytesParcial);
  subir(parcial, bytesParcial);
  estado.falhas.push({ tabela: "documento_origens", operacao: "insert", code: "XX000", vezes: 1 });
  resposta = await chamar(rotaConfirmar, "POST", {}, { params: { id: parcial.envio_id } });
  assert.equal(resposta.status, 500);
  assert.equal(documentos().length, 0, "sem documento sem origem");
  assert.equal(estado.tabelas.documento_origens.length, 0);
  assert.equal(envios()[0].estado, "autorizado", "o envio não vence preso com documento sem origem");
  assert.equal(envios()[0].documento_id, null);
  assert.equal(objetos.has(chaveDoUrl(parcial.url)), true, "falha do banco não apaga o objeto");
  const retomado = await confirmar(parcial.envio_id);
  assert.equal(retomado.corpo.estado, "confirmado");
  assert.equal(documentos().length, 1);
  assert.equal(estado.tabelas.documento_origens.length, 1);

  // Mesma coisa quando a própria função de confirmação falha.
  reiniciar();
  const bytesFuncao = pdf("função fora");
  const fora = await pedir(`${PREFIXO_LAN}/funcao.pdf`, bytesFuncao);
  subir(fora, bytesFuncao);
  estado.falhas.push({ tabela: "confirmar_envio_conector", operacao: "rpc", code: "XX000", vezes: 1 });
  resposta = await chamar(rotaConfirmar, "POST", {}, { params: { id: fora.envio_id } });
  assert.equal(resposta.status, 500);
  assert.deepEqual(await corpoDe(resposta), { erro: "interno" });
  assert.equal(documentos().length, 0);
  assert.equal(envios()[0].estado, "autorizado");
  assert.equal(objetos.has(chaveDoUrl(fora.url)), true);
  assert.equal((await confirmar(fora.envio_id)).corpo.estado, "confirmado");

  // Corrida no índice único (empreendimento_id, sha256): outro envio confirma o mesmo conteúdo no meio.
  reiniciar();
  const bytesCorrida = pdf("corrida");
  const c1 = await pedir(`${PREFIXO_LAN}/corrida-1.pdf`, bytesCorrida);
  const c2 = await pedir(`${PREFIXO_LAN}/corrida-2.pdf`, bytesCorrida);
  subir(c1, bytesCorrida);
  subir(c2, bytesCorrida);
  assert.equal((await confirmar(c1.envio_id)).corpo.estado, "confirmado");
  const chaveC1 = chaveDoUrl(c1.url);
  // c2 passa na checagem prévia (o c1 ainda não estava confirmado) e perde a corrida dentro da função de confirmação.
  envios().find((e) => e.id === c1.envio_id).estado = "autorizado";
  estado.gatilhos.push({ tabela: "confirmar_envio_conector", operacao: "rpc", fn: () => { envios().find((e) => e.id === c1.envio_id).estado = "confirmado"; } });
  const perdeu = await confirmar(c2.envio_id);
  assert.equal(perdeu.corpo.estado, "recusado");
  assert.match(perdeu.corpo.motivo, /outro caminho/);
  assert.equal(documentos().some((d) => d.id === envios().find((e) => e.id === c2.envio_id).documento_planejado_id), false, "sem documento órfão");
  assert.equal(documentos().length, 1);
  assert.equal(estado.tabelas.documento_origens.length, 1);
  assert.equal(objetos.has(chaveDoUrl(c2.url)), false, "objeto sem documento é apagado");
  assert.equal(objetos.has(chaveC1), true, "o objeto do documento que ficou não é tocado");
  assert.equal(envios().find((e) => e.id === c2.envio_id).estado, "duplicado");

  // Duplicado detectado antes de criar qualquer coisa.
  reiniciar();
  const d1 = await pedir(`${PREFIXO_LAN}/dup-1.pdf`, bytesCorrida);
  const d2 = await pedir(`${PREFIXO_LAN}/dup-2.pdf`, bytesCorrida);
  subir(d1, bytesCorrida);
  subir(d2, bytesCorrida);
  await confirmar(d1.envio_id);
  const d2r = await confirmar(d2.envio_id);
  assert.equal(d2r.corpo.estado, "recusado");
  assert.equal(documentos().length, 1);
  assert.equal(objetos.has(chaveDoUrl(d2.url)), false);

  // Regra desativada / empreendimento inativo entre autorizar e confirmar.
  reiniciar();
  const bytesRegra = pdf("regra");
  const rg = await pedir(`${PREFIXO_LAN}/rg.pdf`, bytesRegra);
  subir(rg, bytesRegra);
  estado.tabelas.pasta_regras.find((r) => r.id === regraLanId).ativa = false;
  assert.equal((await confirmar(rg.envio_id)).corpo.estado, "recusado");
  assert.equal(documentos().length, 0);
  assert.equal(objetos.has(chaveDoUrl(rg.url)), false);

  // O objeto só é apagado por quem recusou o envio. Esta chamada acha o objeto "ausente", mas outra termina a
  // confirmação (sobe o objeto, cria o documento) antes de a recusa ser gravada: o envio já não é "autorizado".
  reiniciar();
  const bytesDisputa = pdf("disputa");
  const disputa = await pedir(`${PREFIXO_LAN}/disputa.pdf`, bytesDisputa);
  const chaveDisputa = chaveDoUrl(disputa.url);
  estado.gatilhos.push({
    tabela: "conector_envios",
    operacao: "update",
    fn: () => {
      const linhaDisputa = envios().find((e) => e.id === disputa.envio_id);
      objetos.set(chaveDisputa, { bytes: bytesDisputa });
      documentos().push({ id: linhaDisputa.documento_planejado_id, empreendimento_id: empId, storage_path: linhaDisputa.storage_path, liberado_cliente: false, familia_id: linhaDisputa.documento_planejado_id });
      Object.assign(linhaDisputa, { estado: "confirmado", documento_id: linhaDisputa.documento_planejado_id, confirmado_em: new Date().toISOString() });
    },
  });
  const disputado = await confirmar(disputa.envio_id);
  assert.equal(disputado.corpo.estado, "confirmado", "quem perdeu a corrida devolve o resultado de quem concluiu");
  assert.equal(disputado.corpo.documento_id, envios()[0].documento_planejado_id);
  assert.equal(objetos.has(chaveDisputa), true, "o objeto do documento confirmado não é apagado");
  assert.equal(estado.eventos.some(([tipo]) => tipo === "remover"), false);
  assert.equal(documentos().length, 1);

  // Mesma regra quando a função de confirmação diz que o envio já não está autorizado (outra chamada o recusou).
  reiniciar();
  const bytesOutra = pdf("outra recusa");
  const outraRecusa = await pedir(`${PREFIXO_LAN}/outra-recusa.pdf`, bytesOutra);
  subir(outraRecusa, bytesOutra);
  estado.gatilhos.push({ tabela: "confirmar_envio_conector", operacao: "rpc", fn: () => { envios()[0].estado = "recusado"; } });
  const recusadaPorOutra = await confirmar(outraRecusa.envio_id);
  assert.equal(recusadaPorOutra.corpo.estado, "recusado");
  assert.equal(documentos().length, 0);
  assert.equal(estado.eventos.some(([tipo]) => tipo === "remover"), false, "quem não recusou não apaga o objeto");
  assert.equal(objetos.has(chaveDoUrl(outraRecusa.url)), true);

  // Regras que mudam entre autorizar e confirmar: o destino só vale se o caminho do envio ainda casar, pelas regras
  // ativas de agora, com a mesma regra que o autorizou. Senão: recusado, sem documento, objeto apagado.
  const regraNovaId = "66666666-6666-4666-8666-000000000009";
  for (const [nome, mudar, motivo] of [
    ["prefixo restringido", () => { estado.tabelas.pasta_regras.find((r) => r.id === regraLanId).caminho_prefixo = `${PREFIXO_LAN}/OUTRA`; }, /regra/],
    ["prefixo trocado por outro", () => { estado.tabelas.pasta_regras.find((r) => r.id === regraLanId).caminho_prefixo = "05 - OUTRO"; }, /regra/],
    ["regra desativada", () => { estado.tabelas.pasta_regras.find((r) => r.id === regraLanId).ativa = false; }, /regra/],
    ["regra apagada", (envio) => {
      estado.tabelas.pasta_regras = estado.tabelas.pasta_regras.filter((r) => r.id !== regraLanId);
      envio.regra_id = null;
    }, /regra/],
    ["regra mais longa passa a casar", () => {
      estado.tabelas.pasta_regras.push({ id: regraNovaId, empreendimento_id: empId, caminho_prefixo: `${PREFIXO_LAN}/pasta`, projeto_id: null, categoria_id: null, grupo: "orcamentos", liberar_automatico: true, ativa: true });
    }, /regra/],
    ["caminho bloqueado", (envio) => { envio.caminho_relativo = `${PREFIXO_LAN}/PASTA/Comprovantes/a.pdf`; }, /bloqueado/],
  ]) {
    reiniciar();
    const bytesMuda = pdf(`regra muda ${nome}`);
    const muda = await pedir(`${PREFIXO_LAN}/PASTA/a.pdf`, bytesMuda);
    assert.equal(muda.estado, "autorizado", nome);
    assert.equal(envios()[0].regra_id, regraLanId, nome);
    subir(muda, bytesMuda);
    mudar(envios()[0]);
    const r = await confirmar(muda.envio_id);
    assert.equal(r.status, 200, nome);
    assert.equal(r.corpo.estado, "recusado", nome);
    assert.match(r.corpo.motivo, motivo, nome);
    assert.equal(documentos().length, 0, `${nome}: sem documento`);
    assert.equal(estado.tabelas.documento_origens.length, 0, `${nome}: sem origem`);
    assert.equal(objetos.has(chaveDoUrl(muda.url)), false, `${nome}: objeto apagado`);
    assert.equal(envios()[0].estado, "recusado", nome);
    assert.ok(envios()[0].erro, nome);
    assert.equal((await confirmar(muda.envio_id)).corpo.estado, "recusado", `${nome}: continua recusado`);
  }

  // A mesma regra, editada, continua valendo; o destino é o da regra de agora.
  reiniciar();
  const bytesAjuste = pdf("regra ajustada");
  const ajuste = await pedir(`${PREFIXO_LAN}/PASTA/b.pdf`, bytesAjuste);
  subir(ajuste, bytesAjuste);
  const regraEditada = estado.tabelas.pasta_regras.find((r) => r.id === regraLanId);
  regraEditada.caminho_prefixo = "03 - produtos\\lan\\pasta";
  regraEditada.categoria_id = categoria2Id;
  const ajustado = await confirmar(ajuste.envio_id);
  assert.equal(ajustado.corpo.estado, "confirmado");
  assert.equal(documentos()[0].categoria_id, categoria2Id);
  assert.equal(estado.tabelas.documento_origens[0].regra_id, regraLanId);

  // ---------------------------------------------------------------------------------------------------------
  // Regra de SIMOS e Laudos por equipamento (tipo "equipamentos"): só dois formatos de caminho sobem.
  // ---------------------------------------------------------------------------------------------------------

  const MOTIVO_PADRAO = "Fora do padrão de SIMOS e Laudos.";
  const novaRegraEquipamentos = (extra = {}) => ({
    id: regraEquipamentosId, empreendimento_id: empId, tipo: "equipamentos", caminho_prefixo: PREFIXO_EQUIPAMENTOS, projeto_id: projetoId,
    categoria_id: null, grupo: null, liberar_automatico: false, ativa: true, ...extra,
  });
  reiniciar();
  estado.tabelas.pasta_regras.push(novaRegraEquipamentos());

  // O programa recebe só id e prefixo da regra: o tipo não vai para ele.
  const configuracaoComEquipamentos = await corpoDe(await chamar(rotaConfiguracao, "GET"));
  const regrasDoEmpreendimento = configuracaoComEquipamentos.empreendimentos.find((e) => e.codigo_pasta === "250101").regras;
  assert.deepEqual(regrasDoEmpreendimento.find((r) => r.id === regraEquipamentosId), { id: regraEquipamentosId, caminho_prefixo: PREFIXO_EQUIPAMENTOS });

  const bytesSimo = pdf("simo bombas");
  const caminhoSimo = `${PREFIXO_EQUIPAMENTOS}/01 - BOMBAS/SIMO - Bombas.pdf`;
  const simo = await fluxo(caminhoSimo, bytesSimo);
  assert.equal(simo.corpo.estado, "confirmado");
  assert.equal(simo.corpo.liberado, false, "chega oculto");
  const documentoSimo = documentos().find((d) => d.id === simo.corpo.documento_id);
  assert.equal(documentoSimo.equipamento, "BOMBAS");
  assert.equal(documentoSimo.equipamento_papel, "simo");
  assert.equal(documentoSimo.categoria_id, categoriaSimosId, "SIMO vai para a categoria SIMOS do projeto da regra");
  assert.equal(documentoSimo.projeto_id, projetoId);
  assert.equal(documentoSimo.liberado_cliente, false);

  const bytesLaudo = pdf("laudo bombas");
  const laudo = await fluxo(`${PREFIXO_EQUIPAMENTOS}/01 - BOMBAS/LAUDO/qualquer nome.pdf`, bytesLaudo);
  assert.equal(laudo.corpo.estado, "confirmado");
  const documentoLaudo = documentos().find((d) => d.id === laudo.corpo.documento_id);
  assert.equal(documentoLaudo.equipamento, "BOMBAS");
  assert.equal(documentoLaudo.equipamento_papel, "laudo");
  assert.equal(documentoLaudo.categoria_id, categoriaLaudosId, "Laudo vai para a categoria Laudos");
  assert.equal(estado.tabelas.documento_origens.find((o) => o.documento_id === documentoLaudo.id).regra_id, regraEquipamentosId);

  // Revisão (mesmo caminho, conteúdo novo) herda o equipamento e o papel e entra como revisão do SIMO anterior.
  const revisaoSimo = await fluxo(caminhoSimo, pdf("simo bombas revisado"));
  assert.equal(revisaoSimo.corpo.estado, "confirmado");
  const documentoRevisao = documentos().find((d) => d.id === revisaoSimo.corpo.documento_id);
  assert.equal(documentoRevisao.substitui_id, documentoSimo.id);
  assert.equal(documentoRevisao.equipamento, "BOMBAS");
  assert.equal(documentoRevisao.equipamento_papel, "simo");
  assert.equal(documentoRevisao.categoria_id, categoriaSimosId);
  assert.equal(documentoRevisao.familia_id, documentoSimo.familia_id);

  // Qualquer outro caminho sob a regra é recusado com o motivo exato, já na autorização, e o programa não sobe nada.
  const envioAntes = envios().length;
  for (const fora of [
    `${PREFIXO_EQUIPAMENTOS}/01 - BOMBAS/Ficha técnica.pdf`,
    `${PREFIXO_EQUIPAMENTOS}/01 - BOMBAS/apoio/SIMO x.pdf`,
    `${PREFIXO_EQUIPAMENTOS}/01 - BOMBAS/LAUDO/sub/x.pdf`,
    `${PREFIXO_EQUIPAMENTOS}/SIMO solto na pasta da regra.pdf`,
  ]) {
    const recusa = await pedir(fora, pdf(`fora ${fora}`));
    assert.deepEqual(recusa, { estado: "recusado", motivo: MOTIVO_PADRAO }, fora);
  }
  const recusados = envios().slice(envioAntes);
  assert.equal(recusados.length, 4);
  for (const linha of recusados) {
    assert.equal(linha.estado, "recusado");
    assert.equal(linha.erro, MOTIVO_PADRAO);
    assert.equal(linha.regra_id, regraEquipamentosId, "a recusa guarda a regra");
  }

  // O caminho é classificado de novo na confirmação: se o envio autorizado já não for SIMO nem Laudo, nada é criado.
  const bytesTroca = pdf("troca de caminho");
  const troca = await pedir(`${PREFIXO_EQUIPAMENTOS}/02 - RESERVATÓRIO/SIMO reservatório.pdf`, bytesTroca);
  assert.equal(troca.estado, "autorizado");
  subir(troca, bytesTroca);
  envios().find((e) => e.id === troca.envio_id).caminho_relativo = `${PREFIXO_EQUIPAMENTOS}/02 - RESERVATÓRIO/apoio/x.pdf`;
  const documentosAntes = documentos().length;
  const trocado = await confirmar(troca.envio_id);
  assert.equal(trocado.corpo.estado, "recusado");
  assert.equal(trocado.corpo.motivo, MOTIVO_PADRAO);
  assert.equal(documentos().length, documentosAntes);
  assert.equal(objetos.has(chaveDoUrl(troca.url)), false, "objeto apagado");

  // A liberação automática segue as regras de hoje: regra, empreendimento e interruptor geral ligados.
  reiniciar({ empAuto: true });
  estado.tabelas.pasta_regras.push(novaRegraEquipamentos({ liberar_automatico: true }));
  const automatico = await fluxo(`${PREFIXO_EQUIPAMENTOS}/03.PAINÉIS/LAUDO/laudo painéis.pdf`, pdf("laudo painéis"));
  assert.equal(automatico.corpo.liberado, true);
  assert.equal(documentos().find((d) => d.id === automatico.corpo.documento_id).equipamento, "PAINÉIS");

  // Regra comum não leva equipamento nem papel (a função do banco recusa a mistura).
  reiniciar();
  const comum = await fluxo(`${PREFIXO_LAN}/PASTA/comum.pdf`, pdf("comum"));
  assert.equal(comum.corpo.estado, "confirmado");
  assert.equal(documentos()[0].equipamento ?? null, null);
  assert.equal(documentos()[0].equipamento_papel ?? null, null);

  // ---------------------------------------------------------------------------------------------------------
  // Limites diários
  // ---------------------------------------------------------------------------------------------------------

  reiniciar();
  const agoraReal = Date.now();
  const preencher = (quantidade, tamanho, idadeMaximaH) => {
    for (let i = 0; i < quantidade; i++) {
      envios().push({
        id: randomUUID(), conector_id: conectorId, empreendimento_id: empId, regra_id: regraLanId, caminho_relativo: `antigo/${i}.pdf`, tamanho,
        sha256: sha256Hex(`antigo ${i}`), estado: i % 2 ? "confirmado" : "autorizado", em: new Date(agoraReal - (idadeMaximaH - i * 0.001) * 3600_000).toISOString(),
        documento_id: null, storage_path: null, documento_planejado_id: null, mtime: null, confirmado_em: null, erro: null,
      });
    }
  };
  preencher(199, 1000, 23);
  assert.equal((await pedir(`${PREFIXO_LAN}/ultimo.pdf`, pdf("ultimo"))).estado, "autorizado", "o 200º envio ainda passa");
  resposta = await chamar(rotaEnvios, "POST", pedido(`${PREFIXO_LAN}/excesso.pdf`, pdf("excesso")));
  assert.equal(resposta.status, 429, "o 201º não");
  const limite = await corpoDe(resposta);
  assert.equal(limite.erro, "limite");
  assert.ok(limite.tentar_depois_s >= 3590 && limite.tentar_depois_s <= 3601, `espera ${limite.tentar_depois_s}s até o mais antigo sair da janela`);
  assert.deepEqual(Object.keys(limite).sort(), ["erro", "tentar_depois_s"]);
  assert.equal(envios().filter((e) => e.caminho_relativo.endsWith("excesso.pdf")).length, 0, "nada é gravado acima do limite");
  // Recusas, ja_enviado e duplicado não consomem nem esbarram no limite.
  assert.equal((await pedir(`${PREFIXO_LAN}/Comprovantes/z.pdf`, pdf("z"))).estado, "recusado");

  reiniciar();
  preencher(21, 100 * 1024 * 1024, 5);
  resposta = await chamar(rotaEnvios, "POST", pedido(`${PREFIXO_LAN}/bytes.pdf`, pdf("bytes")));
  assert.equal(resposta.status, 429, "2100 MB autorizados no dia passam de 2 GB");
  assert.equal((await corpoDe(resposta)).erro, "limite");
  reiniciar();
  preencher(150, 1000, 30);
  assert.equal((await pedir(`${PREFIXO_LAN}/janela.pdf`, pdf("janela"))).estado, "autorizado", "envios com mais de 24 h não contam");
  reiniciar();
  preencher(250, 1000, 30);
  for (const e of envios()) e.estado = "recusado";
  assert.equal((await pedir(`${PREFIXO_LAN}/recusados.pdf`, pdf("recusados"))).estado, "autorizado", "recusados não contam");

  // Concorrência: outro pedido da mesma chave grava um envio entre o nosso "ainda cabe" e a nossa gravação. A
  // contagem e a gravação são uma operação só no banco (função reservar_envio_conector, com lock por conector), então
  // o nosso pedido enxerga o outro; antes passavam 201 envios e mais de 2 GB.
  const concorrente = (tamanho) => () => preencher(1, tamanho, 1);
  reiniciar();
  preencher(199, 1000, 23);
  estado.gatilhos.push(
    { tabela: "reservar_envio_conector", operacao: "rpc", fn: concorrente(1000) },
    { tabela: "conector_envios", operacao: "insert", fn: concorrente(1000) },
  );
  resposta = await chamar(rotaEnvios, "POST", pedido(`${PREFIXO_LAN}/corrida-limite.pdf`, pdf("corrida limite")));
  assert.equal(resposta.status, 429, "o 201º simultâneo não passa");
  assert.equal((await corpoDe(resposta)).erro, "limite");
  assert.equal(envios().length, 200, "nada é gravado acima de 200");

  const cemMb = 100 * 1024 * 1024;
  reiniciar();
  preencher(19, cemMb, 5);
  assert.equal((await pedir(`${PREFIXO_LAN}/cabe.pdf`, pdf("cabe"), { tamanho: cemMb })).estado, "autorizado", "1900 MB + 100 MB cabem em 2 GB");
  reiniciar();
  preencher(19, cemMb, 5);
  estado.gatilhos.push(
    { tabela: "reservar_envio_conector", operacao: "rpc", fn: concorrente(cemMb) },
    { tabela: "conector_envios", operacao: "insert", fn: concorrente(cemMb) },
  );
  resposta = await chamar(rotaEnvios, "POST", pedido(`${PREFIXO_LAN}/corrida-bytes.pdf`, pdf("corrida bytes"), { tamanho: cemMb }));
  assert.equal(resposta.status, 429, "mais de 2 GB simultâneos não passam");
  assert.equal(envios().length, 20, "nada é gravado acima de 2 GB");

  // Falha da função de reserva: 500, nenhuma autorização registrada.
  reiniciar();
  estado.falhas.push({ tabela: "reservar_envio_conector", operacao: "rpc", code: "XX000", vezes: 1 });
  resposta = await chamar(rotaEnvios, "POST", pedido(`${PREFIXO_LAN}/falha-reserva.pdf`, pdf("falha reserva")));
  assert.equal(resposta.status, 500);
  assert.deepEqual(await corpoDe(resposta), { erro: "interno" });
  assert.equal(envios().length, 0);

  // ---------------------------------------------------------------------------------------------------------
  // POST /status
  // ---------------------------------------------------------------------------------------------------------

  reiniciar();
  const status = {
    versao: "2.0.0",
    inicio: "2026-11-04T10:00:00.000Z",
    fim: "2026-11-04T10:02:10.000Z",
    contagens: { examinados: 120, enviados: 3, ja_enviados: 110, duplicados: 2, recusados: 1, erros: 0, aguardando_estabilidade: 4 },
    erros: [{ codigo_pasta: "250101", mensagem: "Duas pastas começam com 250101 - " }],
    arvore: { 250101: ["03 - PRODUTOS", "03 - PRODUTOS/LAN", "03 - PRODUTOS/LAN/APROVADO NO INTERLIGA"] },
  };
  resposta = await chamar(rotaStatus, "POST", status);
  assert.equal(resposta.status, 204);
  assert.equal(await resposta.text(), "");
  assert.equal(resposta.headers.get("Cache-Control"), "no-store");
  const gravado = estado.tabelas.conectores[0];
  assert.equal(gravado.versao, "2.0.0");
  assert.deepEqual(gravado.arvore, status.arvore);
  // A mensagem chega aparada (o schema faz trim).
  const errosAparados = status.erros.map((erro) => ({ ...erro, mensagem: erro.mensagem.trim() }));
  assert.deepEqual(gravado.ultimo_ciclo, { inicio: status.inicio, fim: status.fim, contagens: status.contagens, erros: errosAparados });
  assert.ok(Date.now() - Date.parse(gravado.ultimo_contato_em) < 5000);

  // Mensagem sem caminho do servidor e contagens ausentes valem zero.
  resposta = await chamar(rotaStatus, "POST", {
    ...status, contagens: { examinados: 5 },
    erros: [{ codigo_pasta: null, mensagem: "Não leu C:\\ABA-SERVIDOR\\Clientes\\x.pdf nem \\\\ABA-SERVIDOR\\share\\y.pdf" }],
  });
  assert.equal(resposta.status, 204);
  assert.equal(estado.tabelas.conectores[0].ultimo_ciclo.erros[0].mensagem, "Não leu [caminho]", "o caminho vai até o fim da mensagem");
  assert.deepEqual(estado.tabelas.conectores[0].ultimo_ciclo.contagens, { examinados: 5, enviados: 0, ja_enviados: 0, duplicados: 0, recusados: 0, erros: 0, aguardando_estabilidade: 0 });

  // Pasta com espaço no nome: nenhum pedaço do caminho do servidor sobra (unidade, UNC, // e relativo).
  resposta = await chamar(rotaStatus, "POST", {
    ...status,
    erros: [
      { codigo_pasta: "250101", mensagem: "Falha em C:\\ABA CONSULTORIA\\Clientes\\x.pdf" },
      { codigo_pasta: "250101", mensagem: "Falha em D:/ABA CONSULTORIA/Clientes/x.pdf: acesso negado" },
      { codigo_pasta: "250101", mensagem: "Falha em \\\\SERVIDOR\\ABA CONSULTORIA\\Clientes\\x.pdf" },
      { codigo_pasta: "250101", mensagem: "Falha em //SERVIDOR/ABA CONSULTORIA/Clientes/x.pdf" },
      { codigo_pasta: "250101", mensagem: "Falha em Clientes/Obra Nova/planta baixa.pdf" },
    ],
  });
  assert.equal(resposta.status, 204);
  assert.deepEqual(estado.tabelas.conectores[0].ultimo_ciclo.erros.map((erro) => erro.mensagem), Array(5).fill("Falha em [caminho]"));
  assert.equal(JSON.stringify(estado.tabelas.conectores[0].ultimo_ciclo).includes("CONSULTORIA"), false);

  // O contato é registrado em toda requisição autenticada; o resto da linha só muda com um status válido.
  const semContato = () => JSON.stringify({ ...estado.tabelas.conectores[0], ultimo_contato_em: null });
  const antesDoStatus = semContato();
  for (const [nome, corpo] of [
    ["campo extra", { ...status, extra: 1 }],
    ["sem versão", { ...status, versao: undefined }],
    ["data ruim", { ...status, inicio: "ontem" }],
    ["contagem negativa", { ...status, contagens: { ...status.contagens, enviados: -1 } }],
    ["101 erros", { ...status, erros: Array.from({ length: 101 }, () => ({ codigo_pasta: "250101", mensagem: "x" })) }],
    ["mensagem de 501", { ...status, erros: [{ codigo_pasta: "250101", mensagem: "x".repeat(501) }] }],
    ["árvore com ..", { ...status, arvore: { 250101: ["03/../x"] } }],
    ["árvore com pasta vazia", { ...status, arvore: { 250101: ["03//x"] } }],
    ["árvore com 6 níveis", { ...status, arvore: { 250101: ["a/b/c/d/e/f"] } }],
    ["árvore com unidade", { ...status, arvore: { 250101: ["C:/x"] } }],
    ["árvore com unidade e barra invertida", { ...status, arvore: { 250101: ["C:\\x"] } }],
    ["árvore com barra invertida", { ...status, arvore: { 250101: ["03 - PRODUTOS\\LAN"] } }],
    ["árvore com UNC", { ...status, arvore: { 250101: ["\\\\servidor\\share"] } }],
    ["árvore com // inicial", { ...status, arvore: { 250101: ["//servidor/share"] } }],
    ["árvore absoluta", { ...status, arvore: { 250101: ["/03 - PRODUTOS"] } }],
    ["árvore com : no meio", { ...status, arvore: { 250101: ["03 - PRODUTOS/a:b"] } }],
    ["árvore com controle", { ...status, arvore: { 250101: ["a\u0000b"] } }],
    ["código de pasta ruim", { ...status, arvore: { abc: ["a"] } }],
    ["5001 pastas", { ...status, arvore: { 250101: Array.from({ length: 5001 }, (_, i) => `p${i}`) } }],
    ["5001 pastas em dois códigos", { ...status, arvore: { 250101: Array.from({ length: 2501 }, (_, i) => `p${i}`), 250102: Array.from({ length: 2500 }, (_, i) => `q${i}`) } }],
  ]) {
    resposta = await chamar(rotaStatus, "POST", corpo);
    assert.equal(resposta.status, 400, nome);
    assert.equal((await corpoDe(resposta)).erro, "invalido", nome);
  }
  assert.equal(semContato(), antesDoStatus, "status inválido não grava nada");
  const arvoreGrande = { 250101: Array.from({ length: 5000 }, (_, i) => `pasta-${i}`) };
  assert.equal((await chamar(rotaStatus, "POST", { ...status, arvore: arvoreGrande })).status, 204, "5000 pastas é o limite");

  // ---------------------------------------------------------------------------------------------------------
  // Rotas do admin: emitir, consultar e revogar a chave de servidor
  // ---------------------------------------------------------------------------------------------------------

  reiniciar();
  estado.tabelas.conectores[0].ultimo_ciclo = {
    inicio: status.inicio, fim: status.fim, contagens: { ...status.contagens, lixo: "x" },
    erros: [{ codigo_pasta: "250101", mensagem: "m" }, { mensagem: 5 }, "texto", ...Array.from({ length: 30 }, (_, i) => ({ codigo_pasta: null, mensagem: `e${i}` }))],
  };
  estado.tabelas.conectores[0].arvore = { 250101: ["pasta"] };
  const jsonAdmin = (r) => r.json();
  const requisicaoAdmin = (metodo, corpo) => new Request("https://site.invalid/api/adm-interno/portal/conector", {
    method: metodo, headers: corpo === undefined ? {} : { "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });

  papel = "equipe";
  assert.equal((await rotaAdmin.GET()).status, 403, "equipe não vê o conector");
  assert.equal((await rotaAdmin.POST(requisicaoAdmin("POST", {}))).status, 403, "equipe não emite");
  assert.equal((await rotaAdmin.DELETE()).status, 403, "equipe não revoga");
  assert.equal(estado.tabelas.conectores.length, 1);

  papel = "admin";
  resposta = await rotaAdmin.GET();
  assert.equal(resposta.status, 200);
  assert.equal(resposta.headers.get("Cache-Control"), "no-store");
  const atual = (await jsonAdmin(resposta)).details;
  assert.equal(atual.ativo, true);
  assert.equal(atual.nome, "Servidor");
  assert.equal(JSON.stringify(atual).includes("token_hash"), false);
  assert.equal(JSON.stringify(atual).includes(hashDaChave(CHAVE)), false);
  assert.equal("arvore" in atual, false, "a árvore não vai no estado");
  assert.deepEqual(atual.ultimoCiclo.contagens, status.contagens, "só contagens numéricas");
  assert.equal(atual.ultimoCiclo.totalErros, 31);
  assert.equal(atual.ultimoCiclo.erros.length, 20);
  assert.deepEqual(resumirCiclo("lixo"), null);

  resposta = await rotaAdmin.POST(requisicaoAdmin("POST", { nome: "Servidor ABA" }));
  assert.equal(resposta.status, 201);
  assert.equal(resposta.headers.get("Cache-Control"), "no-store");
  const emitido = (await jsonAdmin(resposta)).details;
  assert.match(emitido.chave, /^abacon_[A-Za-z0-9_-]{43}$/);
  assert.equal(emitido.nome, "Servidor ABA");
  assert.equal(estado.tabelas.conectores.length, 2);
  assert.ok(estado.tabelas.conectores[0].revogado_em, "a anterior foi revogada");
  const nova = estado.tabelas.conectores[1];
  assert.equal(nova.revogado_em, null);
  assert.equal(nova.token_hash, hashDaChave(emitido.chave), "só o sha256 é gravado");
  assert.equal(JSON.stringify(estado.tabelas).includes(emitido.chave), false, "a chave não aparece em nenhuma tabela");
  assert.equal((await chamar(rotaConfiguracao, "GET", undefined, { chave: CHAVE })).status, 404, "a chave antiga deixou de valer");
  assert.equal((await chamar(rotaConfiguracao, "GET", undefined, { chave: emitido.chave })).status, 200, "a nova vale");
  const estadoNovo = (await jsonAdmin(await rotaAdmin.GET())).details;
  assert.equal(estadoNovo.id, nova.id);
  assert.equal(estadoNovo.ultimoCiclo, null);
  assert.equal(JSON.stringify(estadoNovo).includes(emitido.chave), false, "a chave só aparece na emissão");

  assert.equal((await rotaAdmin.POST(requisicaoAdmin("POST", { nome: "" }))).status, 400);
  assert.equal((await rotaAdmin.POST(requisicaoAdmin("POST", { nome: "x", extra: 1 }))).status, 400);
  assert.equal((await rotaAdmin.POST(requisicaoAdmin("POST"))).status, 201, "sem corpo usa o nome padrão");
  assert.equal(estado.tabelas.conectores.filter((c) => c.revogado_em === null).length, 1, "nunca duas ativas");

  assert.equal((await rotaAdmin.DELETE()).status, 200);
  assert.equal(estado.tabelas.conectores.filter((c) => c.revogado_em === null).length, 0);
  assert.equal((await jsonAdmin(await rotaAdmin.GET())).details.ativo, false);
  assert.equal((await rotaAdmin.DELETE()).status, 404, "sem chave ativa");
  assert.equal(invalidacoes.length > 0, true);

  // ---------------------------------------------------------------------------------------------------------
  // Logs: nunca chave, URL assinada, nem caminho completo.
  // ---------------------------------------------------------------------------------------------------------

  const textoDosLogs = JSON.stringify(logs);
  for (const proibido of [CHAVE, outraChave, "r2.invalid", "assinatura=", "x-amz", "03 - PRODUTOS", "PLANTA", "segredo-de-teste"]) {
    assert.equal(textoDosLogs.includes(proibido), false, `log contém ${proibido}`);
  }
  assert.ok(logs.length > 0, "os cenários de falha deixaram logs (só com o código do erro)");

  console.log("testar-conector-api: OK");
} finally {
  globalThis.fetch = fetchAnterior;
  console.error = consoleAnterior.error;
  console.warn = consoleAnterior.warn;
  if (envAnterior === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = envAnterior;
}
