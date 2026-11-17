// Backup local do banco, dos arquivos dos buckets e dos PDFs do portal (R2).
// Roda todo dia às 20:00 (tarefa agendada "Backup ABA").
// Uso:
//   node --env-file=.env scripts/backup.mjs                  banco + arquivos + espelho do R2
//   node --env-file=.env scripts/backup.mjs --so-banco       só o banco
//   node --env-file=.env scripts/backup.mjs --so-arquivos    só os arquivos (e o espelho do R2)
//   node --env-file=.env scripts/backup.mjs --so-r2          só o espelho do R2
//   node --env-file=.env scripts/backup.mjs --sem-r2         tudo, menos o espelho do R2
// Cada execução cria BACKUP_DIR/AAAA-MM-DD_HHmm/ (padrão: ../backups-aba, fora do
// repositório) com banco.dump, arquivos/<bucket>/<caminho> e manifesto.json, e
// mantém só os 14 backups completos mais novos (parciais somem depois de 30 dias; o
// completo mais recente nunca é apagado). Termina com código diferente de 0 se algo falhar.
// O espelho do R2 fica em BACKUP_DIR/r2-espelho/<balde>/<chave>, fora dessa rotação: só
// cresce (objetos do R2 nunca mudam, então cada um é baixado uma vez) e nada é apagado nele.
// Precisa do cliente PostgreSQL 17 (pg_dump) no PATH. Passo a passo para restaurar:
// scripts/restaurar-backup.md. A string de conexão nunca é impressa e a senha vai
// para o pg_dump por PGPASSWORD, nunca na linha de comando.
import { createClient } from "@supabase/supabase-js";
import { AwsClient } from "aws4fetch";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { exit, argv } from "node:process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Dá para rodar sem --env-file (ex.: tarefa agendada): carrega o .env da raiz do projeto.
// Variáveis já definidas no ambiente têm prioridade.
const arquivoEnv = join(RAIZ, ".env");
if (typeof process.loadEnvFile === "function" && existsSync(arquivoEnv)) process.loadEnvFile(arquivoEnv);

const BUCKETS = ["site-publico", "documentos", "obras", "fornecedores"];
const ESQUEMAS = ["public", "auth", "storage"];
const MANTER = 14;
const DIAS_PARCIAIS = 30;
const PADRAO_PASTA = /^\d{4}-\d{2}-\d{2}_\d{4}$/;
const POR_PAGINA = 100;
const DOWNLOADS_EM_PARALELO = 4;
const TENTATIVAS = 3;
const PASTA_ESPELHO_R2 = "r2-espelho";
const TEMPO_LISTAGEM_R2_MS = 30_000;
const TEMPO_DOWNLOAD_R2_MS = 5 * 60_000;
const MAX_ERROS_NO_MANIFESTO = 20;
const CHAVE_R2_SEGURA = /^[A-Za-z0-9/_.-]+$/;

const opcoes = argv.slice(2);
const soBanco = opcoes.includes("--so-banco");
const soArquivos = opcoes.includes("--so-arquivos");
const soR2 = opcoes.includes("--so-r2");
const semR2 = opcoes.includes("--sem-r2");
const desconhecidas = opcoes.filter((a) => !["--so-banco", "--so-arquivos", "--so-r2", "--sem-r2"].includes(a));
if (desconhecidas.length > 0 || [soBanco, soArquivos, soR2].filter(Boolean).length > 1 || (soR2 && semR2)) {
  console.error("Uso: node --env-file=.env scripts/backup.mjs [--so-banco | --so-arquivos | --so-r2] [--sem-r2]");
  exit(1);
}
const fazerBanco = !soArquivos && !soR2;
const fazerArquivos = !soBanco && !soR2;
const fazerR2 = !soBanco && !semR2;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const dbUrl = process.env.SUPABASE_DB_URL;
if (fazerArquivos && (!url || !secretKey)) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SECRET_KEY no .env.");
  exit(1);
}
if (fazerBanco && !dbUrl) {
  console.error("Falta SUPABASE_DB_URL no .env (string de conexão do painel do Supabase).");
  exit(1);
}
if (fazerBanco && !/^postgres(ql)?:\/\//.test(dbUrl)) {
  console.error("SUPABASE_DB_URL não parece uma string de conexão (deve começar com postgresql://).");
  exit(1);
}

const backupDir = process.env.BACKUP_DIR?.trim();
const DESTINO_BASE = backupDir ? resolve(RAIZ, backupDir) : resolve(RAIZ, "..", "backups-aba");

// Backup dentro do repositório acabaria no git (o banco tem dados de clientes).
const dentroDaRaiz = relative(RAIZ, DESTINO_BASE);
if (dentroDaRaiz === "" || (dentroDaRaiz !== ".." && !dentroDaRaiz.startsWith(`..${sep}`) && !isAbsolute(dentroDaRaiz))) {
  console.error("BACKUP_DIR aponta para dentro da pasta do projeto. Use uma pasta fora do repositório.");
  exit(1);
}

// A senha sai da URL e vai por PGPASSWORD: na linha de comando ela apareceria na lista de processos.
function conexaoDoBanco() {
  const conexao = new URL(dbUrl);
  const senha = decodeURIComponent(conexao.password);
  conexao.password = "";
  return { urlSemSenha: conexao.toString(), senha };
}

// Remove da mensagem qualquer pedaço da string de conexão (e a senha, pura ou codificada).
function esconder(texto) {
  let limpo = String(texto);
  if (!dbUrl) return limpo;
  const segredos = [dbUrl];
  try {
    const { password } = new URL(dbUrl);
    if (password) segredos.push(password, decodeURIComponent(password));
  } catch {
    // URL inválida: o pg_dump vai reclamar; o texto inteiro já está na lista.
  }
  for (const segredo of segredos) {
    if (segredo) limpo = limpo.split(segredo).join("***");
  }
  return limpo;
}

function dois(n) {
  return String(n).padStart(2, "0");
}

function nomeDaPasta(data) {
  const dia = `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}`;
  return `${dia}_${dois(data.getHours())}${dois(data.getMinutes())}`;
}

function sha256DoArquivo(caminho) {
  return new Promise((resolver, rejeitar) => {
    const hash = createHash("sha256");
    createReadStream(caminho)
      .on("data", (pedaco) => hash.update(pedaco))
      .on("error", rejeitar)
      .on("end", () => resolver(hash.digest("hex")));
  });
}

// Roda um programa sem shell (argumentos em array) e devolve saída, erro e código.
function executar(programa, args, env = process.env) {
  return new Promise((resolver) => {
    let saida = "";
    let erro = "";
    const filho = spawn(programa, args, { stdio: ["ignore", "pipe", "pipe"], shell: false, env });
    filho.stdout.on("data", (d) => (saida += d));
    filho.stderr.on("data", (d) => (erro += d));
    filho.on("error", (e) => resolver({ codigo: null, saida, erro: String(e.message), ausente: e.code === "ENOENT" }));
    filho.on("close", (codigo) => resolver({ codigo, saida, erro, ausente: false }));
  });
}

async function conferirPgDump() {
  const instalar =
    "O pg_dump não foi encontrado. Instale o cliente do PostgreSQL 17 para Windows " +
    "(https://www.postgresql.org/download/windows/ — no instalador, marque só \"Command Line Tools\"), " +
    "adicione a pasta bin dele (ex.: C:\\Program Files\\PostgreSQL\\17\\bin) ao PATH e abra um terminal novo.";
  const { codigo, saida, ausente } = await executar("pg_dump", ["--version"]);
  if (ausente) throw new Error(instalar);
  if (codigo !== 0) throw new Error("Não consegui executar o pg_dump (--version falhou). " + instalar);
  const versao = /(\d+)(?:\.\d+)*/.exec(saida)?.[1];
  if (!versao || Number(versao) < 17) {
    throw new Error(`O pg_dump instalado é antigo (${saida.trim()}); o banco é PostgreSQL 17. Instale o cliente 17 ou mais novo.`);
  }
}

async function fazerDump(pasta) {
  await conferirPgDump();
  const arquivo = join(pasta, "banco.dump");
  let conexao;
  try {
    conexao = conexaoDoBanco();
  } catch {
    throw new Error("SUPABASE_DB_URL não é uma URL válida; confira a string de conexão no .env.");
  }
  const args = [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    ...ESQUEMAS.map((e) => `--schema=${e}`),
    `--file=${arquivo}`,
    `--dbname=${conexao.urlSemSenha}`,
  ];
  console.log(`Banco: gerando dump (${ESQUEMAS.join(", ")})...`);
  const env = conexao.senha ? { ...process.env, PGPASSWORD: conexao.senha } : process.env;
  const { codigo, erro } = await executar("pg_dump", args, env);
  if (codigo !== 0) {
    throw new Error(`pg_dump falhou (código ${codigo ?? "?"}): ${esconder(erro).trim().slice(0, 1500)}`);
  }
  const { size } = await stat(arquivo);
  if (size === 0) throw new Error("pg_dump terminou, mas o arquivo do banco ficou vazio.");
  const sha256 = await sha256DoArquivo(arquivo);
  console.log(`Banco: ${size} bytes.`);
  return { arquivo: "banco.dump", bytes: size, sha256 };
}

// list() não é recursivo e pagina: desce nas pastas (itens sem id) e percorre todas as páginas.
async function listarObjetos(storage, bucket) {
  const achados = [];
  const pendentes = [""];
  while (pendentes.length > 0) {
    const prefixo = pendentes.pop();
    for (let offset = 0; ; offset += POR_PAGINA) {
      const { data, error } = await storage.from(bucket).list(prefixo, {
        limit: POR_PAGINA,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`Falha ao listar o bucket ${bucket}: ${error.message}`);
      for (const item of data) {
        const caminho = prefixo ? `${prefixo}/${item.name}` : item.name;
        if (item.id === null) pendentes.push(caminho);
        // Marcador que o Supabase cria para manter pasta vazia; não é arquivo de ninguém.
        else if (item.name !== ".emptyFolderPlaceholder") {
          achados.push({ caminho, tipo: item.metadata?.mimetype ?? null, tamanho: item.metadata?.size ?? null });
        }
      }
      if (data.length < POR_PAGINA) break;
    }
  }
  return achados;
}

async function baixarComTentativas(storage, bucket, caminho) {
  let ultimoErro;
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    const { data, error } = await storage.from(bucket).download(caminho);
    if (!error) return Buffer.from(await data.arrayBuffer());
    ultimoErro = error;
    await new Promise((r) => setTimeout(r, 500 * tentativa));
  }
  throw new Error(`Falha ao baixar um arquivo do bucket ${bucket}: ${ultimoErro?.message ?? "erro desconhecido"}`);
}

async function baixarArquivos(pasta) {
  const supabase = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const base = join(pasta, "arquivos");
  const itens = [];
  const porBucket = {};
  let totalBytes = 0;

  for (const bucket of BUCKETS) {
    const objetos = await listarObjetos(supabase.storage, bucket);
    console.log(`Arquivos: ${bucket} — ${objetos.length} objeto(s).`);
    porBucket[bucket] = { quantidade: 0, bytes: 0 };

    let proximo = 0;
    async function trabalhar() {
      while (proximo < objetos.length) {
        const objeto = objetos[proximo++];
        const destino = resolve(base, bucket, ...objeto.caminho.split("/"));
        const dentro = relative(base, destino);
        if (dentro.startsWith("..") || isAbsolute(dentro)) {
          throw new Error(`Caminho inesperado no bucket ${bucket}; backup interrompido.`);
        }
        const conteudo = await baixarComTentativas(supabase.storage, bucket, objeto.caminho);
        if (objeto.tamanho !== null && conteudo.length !== objeto.tamanho) {
          throw new Error(`Tamanho diferente do esperado num arquivo do bucket ${bucket}; backup interrompido.`);
        }
        await mkdir(dirname(destino), { recursive: true });
        await writeFile(destino, conteudo);
        itens.push({
          bucket,
          caminho: objeto.caminho,
          tipo: objeto.tipo,
          bytes: conteudo.length,
          sha256: createHash("sha256").update(conteudo).digest("hex"),
        });
        porBucket[bucket].quantidade += 1;
        porBucket[bucket].bytes += conteudo.length;
        totalBytes += conteudo.length;
      }
    }
    await Promise.all(Array.from({ length: DOWNLOADS_EM_PARALELO }, trabalhar));
  }

  itens.sort((a, b) => (a.bucket + "/" + a.caminho).localeCompare(b.bucket + "/" + b.caminho));
  return { total: itens.length, bytes: totalBytes, buckets: porBucket, itens };
}

// Chave só de leitura (R2_BACKUP_*) tem prioridade; sem ela, as mesmas variáveis do site.
// Devolve { pulado, motivo } quando não há credencial e { erro } quando a configuração está torta.
function configuracaoDoR2() {
  const env = process.env;
  const backup = [env.R2_BACKUP_ACCOUNT_ID, env.R2_BACKUP_ACCESS_KEY_ID, env.R2_BACKUP_SECRET_ACCESS_KEY, env.R2_BACKUP_BUCKET].map((v) => v?.trim());
  const site = [env.R2_ACCOUNT_ID, env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY, env.R2_BUCKET_DOCUMENTOS].map((v) => v?.trim());
  let valores;
  if (backup.some(Boolean)) {
    if (!backup.every(Boolean)) return { erro: "Variáveis R2_BACKUP_* incompletas: defina as quatro (ACCOUNT_ID, ACCESS_KEY_ID, SECRET_ACCESS_KEY, BUCKET) ou nenhuma." };
    valores = backup;
  } else if (site.every(Boolean)) {
    valores = site;
  } else {
    return { pulado: true, motivo: "sem credenciais do R2 no .env (R2_BACKUP_* ou R2_*)" };
  }
  const [conta, chaveId, segredo, balde] = valores;
  if (
    !/^[0-9a-f]{32}$/.test(conta) ||
    !/^[\x21-\x7e]{8,256}$/.test(chaveId) ||
    !/^[\x21-\x7e]{8,256}$/.test(segredo) ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(balde)
  ) {
    return { erro: "Credenciais do R2 com formato inválido; confira as variáveis do R2 no .env." };
  }
  return {
    balde,
    base: `https://${conta}.r2.cloudflarestorage.com/${balde}`,
    cliente: new AwsClient({ accessKeyId: chaveId, secretAccessKey: segredo, service: "s3", region: "auto" }),
  };
}

function descreverFalha(erro) {
  if (erro?.name === "TimeoutError" || erro?.name === "AbortError") return "tempo esgotado";
  return String(erro?.message ?? erro).slice(0, 300);
}

function pausar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const ENTIDADES_XML = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function desescaparXml(texto) {
  return texto.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g, (_, decimal, hexa, nome) => {
    if (nome) return ENTIDADES_XML[nome];
    return String.fromCodePoint(Number.parseInt(decimal ?? hexa ?? "0", decimal ? 10 : 16));
  });
}

function campoXml(bloco, nome) {
  const achado = new RegExp(`<${nome}>([\\s\\S]*?)</${nome}>`).exec(bloco);
  return achado ? desescaparXml(achado[1]) : null;
}

async function pedirAoR2(r2, url, tempoMs) {
  const requisicao = await r2.cliente.sign(url, { method: "GET" });
  return fetch(requisicao, { redirect: "error", signal: AbortSignal.timeout(tempoMs) });
}

// ListObjectsV2 pagina de 1000 em 1000: segue o continuation-token até a lista acabar.
async function listarBaldeR2(r2) {
  const objetos = [];
  let token = null;
  do {
    const url = new URL(r2.base);
    url.searchParams.set("list-type", "2");
    if (token) url.searchParams.set("continuation-token", token);
    let xml = null;
    let ultimoErro;
    for (let tentativa = 1; tentativa <= TENTATIVAS && xml === null; tentativa++) {
      try {
        const resposta = await pedirAoR2(r2, url.toString(), TEMPO_LISTAGEM_R2_MS);
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
        xml = await resposta.text();
      } catch (erro) {
        ultimoErro = erro;
        await pausar(500 * tentativa);
      }
    }
    if (xml === null) throw new Error(`Falha ao listar o balde do R2: ${descreverFalha(ultimoErro)}`);
    for (const [, bloco] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const chave = campoXml(bloco, "Key");
      const tamanho = Number(campoXml(bloco, "Size") ?? Number.NaN);
      if (!chave || !Number.isSafeInteger(tamanho) || tamanho < 0) throw new Error("Listagem do R2 com item inválido; espelho interrompido.");
      objetos.push({ chave, tamanho });
    }
    const truncado = campoXml(xml, "IsTruncated") === "true";
    token = truncado ? campoXml(xml, "NextContinuationToken") : null;
    if (truncado && !token) throw new Error("Listagem do R2 truncada sem token de continuação; espelho interrompido.");
  } while (token);
  return objetos;
}

// Chave fora deste padrão nunca vira caminho no disco (path traversal, nomes que o Windows trata à parte).
function chaveR2Valida(chave) {
  return (
    chave.length <= 1024 &&
    CHAVE_R2_SEGURA.test(chave) &&
    !chave.includes("..") &&
    chave.split("/").every((parte) => parte !== "" && parte !== "." && !parte.endsWith("."))
  );
}

// Baixa para um temporário de nome aleatório numa pasta separada (fora da árvore do espelho, criado com "wx", para
// nunca coincidir com um objeto já espelhado) e só renomeia depois de conferir tamanho (e MD5, quando o ETag é MD5 simples).
async function baixarObjetoR2(r2, objeto, destino, pastaTemporaria) {
  const temporario = join(pastaTemporaria, `${randomUUID()}.baixando`);
  let ultimoErro;
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    try {
      const resposta = await pedirAoR2(r2, `${r2.base}/${objeto.chave}`, TEMPO_DOWNLOAD_R2_MS);
      if (!resposta.ok || !resposta.body) throw new Error(`HTTP ${resposta.status}`);
      const md5 = createHash("md5");
      let bytes = 0;
      await mkdir(dirname(destino), { recursive: true });
      await mkdir(pastaTemporaria, { recursive: true });
      await pipeline(
        Readable.fromWeb(resposta.body),
        async function* (fonte) {
          for await (const pedaco of fonte) {
            md5.update(pedaco);
            bytes += pedaco.length;
            yield pedaco;
          }
        },
        createWriteStream(temporario, { flags: "wx" }),
      );
      if (bytes !== objeto.tamanho) throw new Error("tamanho diferente do listado");
      const etag = (resposta.headers.get("etag") ?? "").replace(/"/g, "");
      if (/^[0-9a-f]{32}$/i.test(etag) && md5.digest("hex") !== etag.toLowerCase()) throw new Error("MD5 diferente do ETag");
      await rename(temporario, destino);
      return bytes;
    } catch (erro) {
      ultimoErro = erro;
      await rm(temporario, { force: true });
      await pausar(500 * tentativa);
    }
  }
  throw new Error(descreverFalha(ultimoErro));
}

async function tamanhoNoEspelho(caminho) {
  try {
    const info = await stat(caminho);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

async function chavesDoEspelho(raiz) {
  const chaves = [];
  const pendentes = [""];
  while (pendentes.length > 0) {
    const prefixo = pendentes.pop();
    let entradas;
    try {
      entradas = await readdir(join(raiz, prefixo), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entrada of entradas) {
      const caminho = prefixo ? `${prefixo}/${entrada.name}` : entrada.name;
      if (entrada.isDirectory()) pendentes.push(caminho);
      else chaves.push(caminho);
    }
  }
  return chaves;
}

// Nunca apaga nada do espelho. Erros por objeto não derrubam o resto: ficam no manifesto e no código de saída.
async function espelharR2(destinoBase) {
  const r2 = configuracaoDoR2();
  if (r2.pulado) {
    console.warn(`Aviso: espelho do R2 pulado — ${r2.motivo}.`);
    return { pulado: true, motivo: r2.motivo, erros: 0 };
  }
  if (r2.erro) return { pulado: true, motivo: r2.erro, erros: 1, erros_detalhe: [r2.erro] };

  const raiz = join(destinoBase, PASTA_ESPELHO_R2, r2.balde);
  const pastaTemporaria = join(destinoBase, `${PASTA_ESPELHO_R2}-temporario`);
  const resumo = {
    balde: r2.balde,
    objetos_no_balde: 0,
    bytes_no_balde: 0,
    ja_no_espelho: 0,
    novos_baixados: 0,
    bytes_baixados: 0,
    substituidos_por_tamanho_diferente: 0,
    no_espelho_e_nao_no_balde: 0,
    erros: 0,
    erros_detalhe: [],
  };
  function registrarErro(mensagem) {
    resumo.erros += 1;
    if (resumo.erros_detalhe.length < MAX_ERROS_NO_MANIFESTO) resumo.erros_detalhe.push(mensagem);
  }

  let objetos;
  try {
    objetos = await listarBaldeR2(r2);
  } catch (erro) {
    registrarErro(descreverFalha(erro));
    return resumo;
  }
  resumo.objetos_no_balde = objetos.length;
  console.log(`R2: ${r2.balde} — ${objetos.length} objeto(s) no balde.`);

  const naoBaixados = [];
  for (const objeto of objetos) {
    resumo.bytes_no_balde += objeto.tamanho;
    if (!chaveR2Valida(objeto.chave)) {
      registrarErro(`chave fora do padrão, pulada: ${JSON.stringify(objeto.chave.slice(0, 120))}`);
      continue;
    }
    const destino = resolve(raiz, ...objeto.chave.split("/"));
    const dentro = relative(raiz, destino);
    if (dentro === "" || dentro.startsWith("..") || isAbsolute(dentro)) {
      registrarErro(`chave fora do padrão, pulada: ${JSON.stringify(objeto.chave.slice(0, 120))}`);
      continue;
    }
    const existente = await tamanhoNoEspelho(destino);
    if (existente === objeto.tamanho) {
      resumo.ja_no_espelho += 1;
      continue;
    }
    if (existente !== null) resumo.substituidos_por_tamanho_diferente += 1;
    naoBaixados.push({ ...objeto, destino });
  }

  let proximo = 0;
  async function trabalhar() {
    while (proximo < naoBaixados.length) {
      const objeto = naoBaixados[proximo++];
      try {
        const bytes = await baixarObjetoR2(r2, objeto, objeto.destino, pastaTemporaria);
        resumo.novos_baixados += 1;
        resumo.bytes_baixados += bytes;
      } catch (erro) {
        registrarErro(`falha ao baixar ${JSON.stringify(objeto.chave.slice(0, 120))}: ${erro.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: DOWNLOADS_EM_PARALELO }, trabalhar));

  const noBalde = new Set(objetos.map((o) => o.chave));
  resumo.no_espelho_e_nao_no_balde = (await chavesDoEspelho(raiz)).filter((chave) => !noBalde.has(chave)).length;
  console.log(
    `R2: ${resumo.novos_baixados} novo(s) baixado(s) (${resumo.bytes_baixados} bytes), ${resumo.ja_no_espelho} já no espelho, ` +
      `${resumo.no_espelho_e_nao_no_balde} só no espelho, ${resumo.erros} erro(s).`,
  );
  return resumo;
}

async function lerManifesto(nome) {
  try {
    return JSON.parse(await readFile(join(DESTINO_BASE, nome, "manifesto.json"), "utf8"));
  } catch {
    return null;
  }
}

// Só mexe em subpastas com nome de backup e manifesto legível; qualquer outra coisa fica intacta.
// Só os completos entram na contagem dos 14 (assim o mais recente completo nunca sai); os
// parciais (só banco ou só arquivos) são apagados apenas depois de DIAS_PARCIAIS dias.
async function manterMaisNovos() {
  const entradas = await readdir(DESTINO_BASE, { withFileTypes: true });
  const completos = [];
  const parciais = [];
  for (const entrada of entradas) {
    // r2-espelho não casa com o padrão e fica fora da rotação; o teste explícito é só um cinto de segurança.
    if (!entrada.isDirectory() || entrada.name === PASTA_ESPELHO_R2 || !PADRAO_PASTA.test(entrada.name)) continue;
    const manifesto = await lerManifesto(entrada.name);
    if (!manifesto) continue;
    if (manifesto.escopo === "completo") completos.push(entrada.name);
    else parciais.push({ nome: entrada.name, criadoEm: Date.parse(manifesto.criado_em) });
  }

  completos.sort().reverse();
  const vencidos = completos.slice(MANTER);

  const limite = Date.now() - DIAS_PARCIAIS * 24 * 60 * 60 * 1000;
  for (const { nome, criadoEm } of parciais) {
    if (Number.isFinite(criadoEm) && criadoEm < limite) vencidos.push(nome);
  }

  for (const antigo of vencidos) {
    await rm(join(DESTINO_BASE, antigo), { recursive: true, force: true });
    console.log(`Backup antigo removido: ${antigo}`);
  }
}

async function main() {
  const agora = new Date();
  const nome = nomeDaPasta(agora);
  const pasta = join(DESTINO_BASE, nome);
  if (existsSync(pasta)) throw new Error(`Já existe um backup com o nome ${nome}. Espere um minuto e rode de novo.`);
  await mkdir(pasta, { recursive: true });

  let falhaNoR2 = false;
  try {
    const manifesto = {
      versao: 1,
      criado_em: agora.toISOString(),
      escopo: soR2 ? "so-r2" : fazerBanco && fazerArquivos ? "completo" : fazerBanco ? "so-banco" : "so-arquivos",
      banco: null,
      arquivos: null,
      r2: null,
    };
    if (fazerBanco) manifesto.banco = { ...(await fazerDump(pasta)), esquemas: ESQUEMAS };
    if (fazerArquivos) manifesto.arquivos = await baixarArquivos(pasta);
    if (fazerR2) {
      manifesto.r2 = await espelharR2(DESTINO_BASE);
      // Com --so-r2 uma etapa pulada não fez backup nenhum; nos outros casos o aviso basta.
      falhaNoR2 = manifesto.r2.erros > 0 || (soR2 && manifesto.r2.pulado === true);
    }
    // O manifesto é o último a ser gravado: pasta sem ele é backup incompleto.
    await writeFile(join(pasta, "manifesto.json"), JSON.stringify(manifesto, null, 2) + "\n");
  } catch (erro) {
    await rm(pasta, { recursive: true, force: true });
    throw erro;
  }

  await manterMaisNovos();
  if (falhaNoR2) {
    console.error(`Backup salvo em ${pasta.split(sep).join("/")}, mas o espelho do R2 teve problemas (veja "r2" no manifesto.json).`);
    process.exitCode = 1;
    return;
  }
  console.log(`Backup concluído em ${pasta.split(sep).join("/")}`);
}

main().catch((erro) => {
  console.error("Backup falhou:", esconder(erro?.message ?? erro));
  exit(1);
});
