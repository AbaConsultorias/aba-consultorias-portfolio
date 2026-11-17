import { caminhoBloqueado, caminhoDePastaValido, chaveDoCaminho, semAcentoEmMaiusculas } from "./regras";
import { pastaIgnorada } from "./sinais";
import { validarPrefixoDeRegra, type GrupoDeDocumento } from "./sugestoes";

// Montagem de projetos e regras a partir das pastas do servidor (docs/MODELO-PASTAS-CONTRATO.md). Sem I/O: recebe a
// árvore do conector, o catálogo, os projetos e as regras do empreendimento e devolve a pré-visualização. Quem grava é a
// função do banco montar_empreendimento_de_pastas, que confere tudo de novo.

export const SISTEMAS = ["SAA", "SES"] as const;
export type Sistema = (typeof SISTEMAS)[number];
const CHAVE_DO_SISTEMA: Record<Sistema, string> = { SAA: "saa", SES: "ses" };

export type FaseDoCatalogo = "base" | "complementar";
// "arquivo": pasta que não vira projeto; os PDFs ficam guardados (ocultos) no bloco "Outros projetos" do cliente.
export type TipoDoCatalogo = "projeto" | "grupo" | "equipamentos" | "arquivo";
// subpastas: lista de caminhos-padrão; caminho = lista de níveis; nível = lista de termos. Lista vazia = a própria pasta.
export type SubpastasDoCatalogo = readonly (readonly (readonly string[])[])[];

export type ItemDoCatalogo = {
  chave: string;
  rotulo: string;
  raiz: string;
  termos: readonly string[];
  termosExcluir: readonly string[];
  fase: FaseDoCatalogo;
  tipo: TipoDoCatalogo;
  modeloId: string | null;
  nomeProjeto: string | null;
  categoria: string | null;
  grupo: GrupoDeDocumento | null;
  subpastas: SubpastasDoCatalogo;
  dependeDe: string | null;
  destinoEquipamentos: string | null;
  // false só em item de projeto: o projeto nasce sem regra (os arquivos da pasta vão para outro projeto).
  criaRegras: boolean;
  ordem: number;
  ativo: boolean;
};
export type ProjetoParaMontagem = { id: string; nome: string; modeloId: string | null; etapaAtualNome?: string | null };
export type RegraParaMontagem = { id: string; caminhoPrefixo: string; ativa: boolean };
export type EntradaDaMontagem = {
  pastas: readonly string[];
  catalogo: readonly ItemDoCatalogo[];
  projetos: readonly ProjetoParaMontagem[];
  regras: readonly RegraParaMontagem[];
  lerComplementares: boolean;
};

// Regras que marcam etapa, derivadas da pasta LAN por onde passa o caminho do APROVADO: "devolutivas" na própria LAN e
// "protocolos" na pasta PROJETO(S) irmã dela. Só entram as que existem na árvore.
export type TipoDeRegraDerivada = "protocolos" | "devolutivas";
export type RegraDerivada = { tipo: TipoDeRegraDerivada; caminho: string; rotulo: string; jaCriada: boolean };
export const ROTULO_DA_REGRA_DERIVADA: Record<TipoDeRegraDerivada, string> = { protocolos: "Protocolos", devolutivas: "Devolutivas da Copasa" };

export type SlotDaMontagem = {
  estado: "encontrada" | "ambigua" | "ausente";
  candidatas: string[];
  escolhida: string | null;
  jaCriada: boolean;
  // Por candidata, porque a pessoa pode trocar a escolhida numa subpasta ambígua. Só itens de projeto têm entradas.
  derivadas: Record<string, RegraDerivada[]>;
};
export type EstadoDoItem = "encontrado" | "parcial" | "ambiguo" | "ausente" | "ja_criado" | "indisponivel";
export type ItemDaMontagem = {
  id: string;
  chave: string;
  rotulo: string;
  fase: FaseDoCatalogo;
  tipo: TipoDoCatalogo;
  criaRegras: boolean;
  sistema: Sistema | null;
  paiChave: string | null;
  precisaDe: { chave: string; rotulo: string; existe: boolean } | null;
  nomeProjeto: string | null;
  pasta: string | null;
  estado: EstadoDoItem;
  slots: SlotDaMontagem[];
  projetoJaExiste: boolean;
  pendente: boolean;
  marcado: boolean;
  avisos: string[];
};
export type RegraOrfa = { regraId: string; caminhoAtual: string; sugestao: string | null; rotulo: string | null };
export type Montagem = {
  itens: ItemDaMontagem[];
  pastasDesconhecidas: string[];
  orfas: RegraOrfa[];
  lerComplementares: boolean;
};

const MAXIMO_DE_PASTAS = 5000;
const MAXIMO_DE_CANDIDATAS = 20;
const MAXIMO_DE_AVISOS = 50;
const MAXIMO_DE_ITENS_NA_SELECAO = 50;

// Pastas de 03 - PRODUTOS que o contrato deixa de fora: nunca viram projeto e não geram aviso de "desconhecida".
// Cada linha é uma lista de termos que precisam aparecer juntos no nome normalizado.
const IGNORADAS: readonly (readonly string[])[] = [
  ["URBANISTICO"], ["DTB"], ["EXECUTIVO*"], ["CONSULTORIA"], ["ORCAMENTO*", "MATERIAIS"], ["DECLARACAO", "CUSTO"],
  ["REDE", "AEREA"], ["TELEMETRIA"], ["RADIO"], ["MOTOBOMBA"], ["DRENAGEM"], ["TERRAPLANAGEM"], ["VRP"],
];

// ---------------------------------------------------------------------------------------------------------------------
// Normalização e comparação por palavras
// ---------------------------------------------------------------------------------------------------------------------

// Nome de pasta comparável: sem o número da frente, sem o que está entre parênteses, sem " OK" no fim, sem acento nem
// pontuação, em maiúsculas e com espaços simples. "02 - P. - SAA (PROJETISTA A)" e "02 - P.SAA ()" viram "P SAA".
export function normalizarNome(nome: string): string {
  const semParenteses = nome.normalize("NFC").replace(/\([^)]*(?:\)|$)/g, " ");
  const semNumero = semParenteses.replace(/^\s*\d+\s*[-–—._)]*\s*/, "");
  const palavras = semAcentoEmMaiusculas(semNumero).replace(/[^A-Z0-9]+/g, " ").trim().split(" ").filter((palavra) => palavra !== "");
  if (palavras.length > 1 && palavras[palavras.length - 1] === "OK") palavras.pop();
  return palavras.join(" ");
}

// Termo do catálogo: palavra em maiúsculas sem acento; "!" na frente exclui; "*" no fim vale como prefixo;
// "|" separa alternativas ("RESERVATORIO|REL" casa com qualquer uma).
export function normalizarTermo(termo: string): string {
  return semAcentoEmMaiusculas(termo).replace(/[^A-Z0-9*!|]/g, "");
}

const palavrasDe = (nome: string): string[] => normalizarNome(nome).split(" ").filter((palavra) => palavra !== "");

function termoCasa(termo: string, palavras: readonly string[]): boolean {
  if (termo.includes("|")) return termo.split("|").some((alternativa) => termoCasa(alternativa, palavras));
  const prefixo = termo.endsWith("*");
  const base = prefixo ? termo.slice(0, -1) : termo;
  if (base === "") return false;
  return palavras.some((palavra) => (prefixo ? palavra.startsWith(base) : palavra === base));
}

function casaTermos(termos: readonly string[], palavras: readonly string[]): boolean {
  return termos.every((termo) => (termo.startsWith("!") ? !termoCasa(termo.slice(1), palavras) : termoCasa(termo, palavras)));
}

const ehIgnorada = (palavras: readonly string[]): boolean => IGNORADAS.some((termos) => casaTermos(termos, palavras));

function casaItem(item: ItemDoCatalogo, palavras: readonly string[]): boolean {
  if (!casaTermos(item.termos.map(normalizarTermo), palavras)) return false;
  if (item.termosExcluir.some((termo) => termoCasa(normalizarTermo(termo).replace(/^!/, ""), palavras))) return false;
  return item.tipo !== "projeto" || !ehIgnorada(palavras);
}

const chaveDeNome = (nome: string): string => semAcentoEmMaiusculas(nome.normalize("NFC")).replace(/\s+/g, " ").trim();
const cortar = (texto: string, maximo = 200): string => ([...texto].length > maximo ? `${[...texto].slice(0, maximo).join("")}…` : texto);
const comparar = (a: string, b: string): number => (chaveDoCaminho(a) < chaveDoCaminho(b) ? -1 : chaveDoCaminho(a) > chaveDoCaminho(b) ? 1 : 0);

// ---------------------------------------------------------------------------------------------------------------------
// Árvore
// ---------------------------------------------------------------------------------------------------------------------

type No = { nome: string; caminho: string; filhos: Map<string, No> };
type Arvore = { raiz: No; chaves: Set<string> };
const cacheDePalavras = new WeakMap<No, string[]>();
const palavrasDoNo = (no: No): string[] => {
  let palavras = cacheDePalavras.get(no);
  if (!palavras) {
    palavras = palavrasDe(no.nome);
    cacheDePalavras.set(no, palavras);
  }
  return palavras;
};

// A árvore vem do programa do servidor, que o site não controla: só entram pastas válidas e não bloqueadas, e as
// pastas acima de cada uma entram mesmo que a lista não as cite.
function construirArvore(pastas: readonly string[]): Arvore {
  const raiz: No = { nome: "", caminho: "", filhos: new Map() };
  const chaves = new Set<string>();
  let total = 0;
  for (const bruta of pastas) {
    const pasta = bruta.normalize("NFC");
    if (!caminhoDePastaValido(pasta) || caminhoBloqueado(pasta)) continue;
    let no = raiz;
    for (const segmento of pasta.split("/")) {
      const chave = segmento.toLowerCase();
      let filho = no.filhos.get(chave);
      if (!filho) {
        if (total >= MAXIMO_DE_PASTAS) break;
        filho = { nome: segmento, caminho: no.caminho === "" ? segmento : `${no.caminho}/${segmento}`, filhos: new Map() };
        no.filhos.set(chave, filho);
        chaves.add(chaveDoCaminho(filho.caminho));
        total += 1;
      }
      no = filho;
    }
  }
  return { raiz, chaves };
}

// Regra ativa cuja pasta sumiu da árvore (renomeada ou apagada): não casa mais com nenhum arquivo.
const ehOrfa = (regra: RegraParaMontagem, chaves: ReadonlySet<string>): boolean => regra.ativa && !chaves.has(chaveDoCaminho(regra.caminhoPrefixo));

// Mesmo critério da aba de montagem, sem catálogo nem projetos: serve ao aviso do painel.
export function regrasOrfasDaArvore<T extends RegraParaMontagem>(pastas: readonly string[], regras: readonly T[]): T[] {
  const { chaves } = construirArvore(pastas);
  return regras.filter((regra) => ehOrfa(regra, chaves));
}

// Descendentes que casam com o nível, o mais raso de cada ramo: não desce dentro de uma pasta que já casou.
function descendentesQueCasam(base: No, termos: readonly string[]): { no: No; distancia: number }[] {
  const achados: { no: No; distancia: number }[] = [];
  let fronteira = [...base.filhos.values()];
  for (let distancia = 1; fronteira.length > 0; distancia += 1) {
    const proxima: No[] = [];
    for (const no of fronteira) {
      if (casaTermos(termos, palavrasDoNo(no))) achados.push({ no, distancia });
      else proxima.push(...no.filhos.values());
    }
    fronteira = proxima;
  }
  return achados;
}

type Candidata = { no: No; custo: number };

// Procura em profundidade: cada nível do caminho-padrão casa com um descendente (qualquer profundidade) do anterior.
// O custo é a soma das distâncias; a candidata de menor custo é a preferida.
function candidatasDoCaminho(pasta: No, niveis: readonly (readonly string[])[]): Candidata[] {
  let atuais: Candidata[] = [{ no: pasta, custo: 0 }];
  for (const nivel of niveis) {
    const termos = nivel.map(normalizarTermo);
    const proximos = new Map<No, number>();
    for (const atual of atuais) {
      for (const { no, distancia } of descendentesQueCasam(atual.no, termos)) {
        const custo = atual.custo + distancia;
        const anterior = proximos.get(no);
        if (anterior === undefined || custo < anterior) proximos.set(no, custo);
      }
    }
    atuais = [...proximos].map(([no, custo]) => ({ no, custo }));
    if (atuais.length === 0) return [];
  }
  return atuais.filter(({ no }) => {
    const validado = validarPrefixoDeRegra(no.caminho);
    return validado.valido && validado.caminho === no.caminho;
  });
}

function juntarSlot(porPasta: readonly (readonly Candidata[])[], regras: ReadonlySet<string>): SlotDaMontagem {
  const preferidas: string[] = [];
  const outras: string[] = [];
  for (const lista of porPasta) {
    if (lista.length === 0) continue;
    const minimo = Math.min(...lista.map(({ custo }) => custo));
    for (const { no, custo } of lista) (custo === minimo ? preferidas : outras).push(no.caminho);
  }
  const candidatas = [...new Set([...preferidas.sort(comparar), ...outras.sort(comparar)])].slice(0, MAXIMO_DE_CANDIDATAS);
  // Regra numa subpasta da candidata (ex.: PEC com "pj automação" e "pj construtivo") também conta: a pasta já foi
  // configurada à mão e uma regra no nível de cima puxaria arquivos que a equipe deixou de fora.
  const existente = candidatas.find((caminho) => {
    const chave = chaveDoCaminho(caminho);
    if (regras.has(chave)) return true;
    for (const regra of regras) if (regra.startsWith(`${chave}/`)) return true;
    return false;
  });
  if (existente) return { estado: "encontrada", candidatas, escolhida: existente, jaCriada: true, derivadas: {} };
  if (candidatas.length === 0) return { estado: "ausente", candidatas, escolhida: null, jaCriada: false, derivadas: {} };
  const unicas = new Set(preferidas);
  if (unicas.size === 1) return { estado: "encontrada", candidatas, escolhida: [...unicas][0], jaCriada: false, derivadas: {} };
  return { estado: "ambigua", candidatas, escolhida: null, jaCriada: false, derivadas: {} };
}

// Dado o caminho do APROVADO (ex.: …/02 - LAN/01 - APROVADO NO INTERLIGA), devolve a regra de devolutivas na LAN e a de
// protocolos na pasta PROJETO(S) irmã, quando existem na árvore e podem ter regra. A LAN precisa estar acima do caminho
// (se o caminho fosse a própria LAN, as duas regras cairiam na mesma pasta). Duas pastas PROJETO(S) = ambíguo, nenhuma.
function derivarRegrasDeSinal(caminho: string, raiz: No, regras: ReadonlySet<string>): RegraDerivada[] {
  const segmentos = caminho.split("/");
  const nos: No[] = [];
  let no = raiz;
  for (const segmento of segmentos) {
    const filho = no.filhos.get(segmento.toLowerCase());
    if (!filho) return [];
    nos.push(filho);
    no = filho;
  }
  let indiceDaLan = -1;
  for (let i = segmentos.length - 2; i >= 1; i -= 1) {
    if (normalizarNome(segmentos[i]) === "LAN") {
      indiceDaLan = i;
      break;
    }
  }
  if (indiceDaLan < 0) return [];

  const permitida = (pasta: string): boolean => regraNovaPermitida(pasta) && !pastaIgnorada(`${pasta}/x.pdf`);
  const derivadas: RegraDerivada[] = [];
  const lan = nos[indiceDaLan].caminho;
  if (permitida(lan)) derivadas.push({ tipo: "devolutivas", caminho: lan, rotulo: ROTULO_DA_REGRA_DERIVADA.devolutivas, jaCriada: regras.has(chaveDoCaminho(lan)) });

  const irmas = [...nos[indiceDaLan - 1].filhos.values()].filter((irma) => ["PROJETO", "PROJETOS"].includes(normalizarNome(irma.nome)));
  if (irmas.length === 1 && permitida(irmas[0].caminho)) {
    const projetos = irmas[0].caminho;
    derivadas.push({ tipo: "protocolos", caminho: projetos, rotulo: ROTULO_DA_REGRA_DERIVADA.protocolos, jaCriada: regras.has(chaveDoCaminho(projetos)) });
  }
  return derivadas;
}

// ---------------------------------------------------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------------------------------------------------

type Grupo = { item: ItemDoCatalogo; sistema: Sistema | null; nos: No[] };

function sistemaDoNome(palavras: readonly string[]): Sistema | null {
  const ses = palavras.indexOf("SES");
  const saa = palavras.indexOf("SAA");
  if (ses < 0 && saa < 0) return null;
  if (ses < 0) return "SAA";
  if (saa < 0) return "SES";
  return saa < ses ? "SAA" : "SES";
}

const idDaInstancia = (item: ItemDoCatalogo, sistema: Sistema | null): string => (item.dependeDe === "sistema" ? `${item.chave}:${sistema ?? "sem"}` : item.chave);

export function montarPrevia(entrada: EntradaDaMontagem): Montagem {
  const { raiz, chaves } = construirArvore(entrada.pastas);
  const regras = new Set(entrada.regras.map((regra) => chaveDoCaminho(regra.caminhoPrefixo)));
  const catalogo = [...entrada.catalogo].sort((a, b) => a.ordem - b.ordem || (a.chave < b.chave ? -1 : 1));
  const porChave = new Map(catalogo.map((item) => [item.chave, item]));

  // Pastas de primeiro nível que casam com a raiz de cada item, e as pastas filhas que casam com o item.
  const nosPorItem = new Map<string, No[]>();
  const classificadas = new Set<No>();
  for (const item of catalogo) {
    const nomeDaRaiz = normalizarNome(item.raiz);
    const nos: No[] = [];
    for (const primeiro of raiz.filhos.values()) {
      if (normalizarNome(primeiro.nome) !== nomeDaRaiz) continue;
      for (const filho of primeiro.filhos.values()) {
        if (!casaItem(item, palavrasDoNo(filho))) continue;
        nos.push(filho);
        classificadas.add(filho);
      }
    }
    nosPorItem.set(item.chave, nos);
  }

  const raizesDeProjeto = new Set(catalogo.filter((item) => item.tipo === "projeto").map((item) => normalizarNome(item.raiz)));
  const pastasDesconhecidas: string[] = [];
  for (const primeiro of raiz.filhos.values()) {
    if (!raizesDeProjeto.has(normalizarNome(primeiro.nome))) continue;
    for (const filho of primeiro.filhos.values()) {
      if (classificadas.has(filho) || ehIgnorada(palavrasDoNo(filho))) continue;
      if (pastasDesconhecidas.length < MAXIMO_DE_AVISOS) pastasDesconhecidas.push(filho.caminho);
    }
  }

  const projetoDoModelo = (modeloId: string | null): ProjetoParaMontagem | undefined =>
    modeloId === null ? undefined : entrada.projetos.find((projeto) => projeto.modeloId === modeloId);
  const disponivel = (sistema: Sistema): boolean => {
    const item = porChave.get(CHAVE_DO_SISTEMA[sistema]);
    return item !== undefined && (projetoDoModelo(item.modeloId) !== undefined || (nosPorItem.get(item.chave) ?? []).length > 0);
  };

  // Grupos por item e sistema. Os complementares seguem o sistema do nome da pasta ("SAA" ou "SES"); sem nenhum dos
  // dois, vão para o SAA se houver projeto SAA.
  const grupos = new Map<string, Grupo>();
  const avisosDoGrupo = new Map<string, string[]>();
  for (const item of catalogo) {
    if (!item.ativo) continue;
    const nos = nosPorItem.get(item.chave) ?? [];
    if (item.dependeDe !== "sistema" || nos.length === 0) {
      grupos.set(idDaInstancia(item, null), { item, sistema: null, nos });
      continue;
    }
    for (const no of nos) {
      const marcado = sistemaDoNome(palavrasDoNo(no));
      const sistema = marcado ?? (disponivel("SAA") ? "SAA" : null);
      const id = idDaInstancia(item, sistema);
      const grupo = grupos.get(id) ?? { item, sistema, nos: [] };
      grupo.nos.push(no);
      grupos.set(id, grupo);
      if (sistema !== null && !disponivel(sistema)) {
        avisosDoGrupo.set(id, [`Não há projeto ${sistema} neste empreendimento: este projeto entra sem “depende de”.`]);
      }
    }
  }

  const vezesPorModelo = new Map<string, number>();
  for (const { item, nos } of grupos.values()) {
    if (item.tipo === "projeto" && item.modeloId && nos.length > 0) vezesPorModelo.set(item.modeloId, (vezesPorModelo.get(item.modeloId) ?? 0) + 1);
  }

  const itens: ItemDaMontagem[] = [];
  for (const [id, { item, sistema, nos }] of grupos) {
    const avisos = [...(avisosDoGrupo.get(id) ?? [])];
    const pasta = nos.length > 0 ? nos[0].caminho : null;
    if (nos.length > 1 && item.tipo === "projeto") avisos.push(`Há ${nos.length} pastas que combinam com este projeto.`);
    const semRegras = item.tipo === "projeto" && item.criaRegras === false;
    const definicao: SubpastasDoCatalogo = semRegras ? [] : item.subpastas.length > 0 ? item.subpastas : [[]];
    const slots = nos.length === 0
      ? definicao.map((): SlotDaMontagem => ({ estado: "ausente", candidatas: [], escolhida: null, jaCriada: false, derivadas: {} }))
      : definicao.map((niveis) => juntarSlot(nos.map((no) => candidatasDoCaminho(no, niveis)), regras));
    if (item.tipo === "projeto") {
      for (const slot of slots) {
        // Pasta que a equipe já configurou à mão, só pelas subpastas (PEC): não se sugere nada em volta dela.
        if (slot.jaCriada && slot.escolhida !== null && !regras.has(chaveDoCaminho(slot.escolhida))) continue;
        for (const candidata of slot.candidatas) {
          const derivadas = derivarRegrasDeSinal(candidata, raiz, regras);
          if (derivadas.length > 0) slot.derivadas[candidata] = derivadas;
        }
      }
    }

    // Projeto: nome, existente e dependência.
    let nomeProjeto: string | null = null;
    let projetoJaExiste = false;
    let indisponivel = false;
    if (item.tipo === "projeto") {
      const base = item.nomeProjeto ?? item.rotulo;
      nomeProjeto = item.dependeDe === "sistema" && sistema === "SES" ? `${base} (SES)` : base;
      if (nos.length > 0 && item.modeloId === null) {
        indisponivel = true;
        avisos.push("O catálogo ainda não aponta o modelo deste projeto.");
      } else if (nos.length > 0 && item.modeloId !== null) {
        const mesmoNome = entrada.projetos.find((projeto) => chaveDeNome(projeto.nome) === chaveDeNome(nomeProjeto ?? ""));
        const doModelo = entrada.projetos.filter((projeto) => projeto.modeloId === item.modeloId);
        if (mesmoNome && mesmoNome.modeloId !== item.modeloId) {
          indisponivel = true;
          avisos.push(`Já existe um projeto chamado “${cortar(mesmoNome.nome)}” de outro modelo.`);
        } else if (mesmoNome) {
          nomeProjeto = mesmoNome.nome;
          projetoJaExiste = true;
        } else if (doModelo.length === 1 && vezesPorModelo.get(item.modeloId) === 1) {
          nomeProjeto = doModelo[0].nome;
          projetoJaExiste = true;
          avisos.push(`Usa o projeto que já existe: “${cortar(doModelo[0].nome)}”.`);
        }
      }
    }

    let paiChave: string | null = null;
    let precisaDe: ItemDaMontagem["precisaDe"] = null;
    const donoDoPai = item.dependeDe === "sistema" ? (sistema !== null && disponivel(sistema) ? CHAVE_DO_SISTEMA[sistema] : null) : item.dependeDe;
    const dependencia = item.tipo === "equipamentos" ? item.destinoEquipamentos : donoDoPai;
    const referencia = dependencia ? porChave.get(dependencia) : undefined;
    if (dependencia && referencia) {
      precisaDe = { chave: referencia.chave, rotulo: referencia.rotulo, existe: projetoDoModelo(referencia.modeloId) !== undefined };
      if (item.tipo === "projeto") paiChave = referencia.chave;
    } else if (dependencia) {
      indisponivel = true;
      avisos.push("O catálogo aponta para um item que não existe.");
    }

    itens.push({
      id, chave: item.chave, rotulo: item.rotulo, fase: item.fase, tipo: item.tipo, criaRegras: !semRegras, sistema, paiChave, precisaDe, nomeProjeto,
      pasta, estado: "ausente", slots, projetoJaExiste, pendente: false, marcado: false, avisos,
    });
    if (indisponivel) itens[itens.length - 1].estado = "indisponivel";
  }

  // Estado final de cada item (precisa de todos os itens para saber se o projeto de que depende vai existir).
  const temInstancia = (chave: string): boolean => itens.some((outro) => outro.chave === chave && outro.pasta !== null && outro.estado !== "indisponivel");
  for (const item of itens) {
    const achou = item.slots.some((slot) => slot.estado !== "ausente");
    const pastaAchada = item.pasta !== null;
    const defineProjeto = item.tipo === "projeto";
    if (item.estado === "indisponivel") continue;
    if (!pastaAchada || (!defineProjeto && !achou)) {
      item.estado = "ausente";
      continue;
    }
    if (item.precisaDe && !item.precisaDe.existe && !temInstancia(item.precisaDe.chave) && item.tipo === "equipamentos") {
      item.estado = "indisponivel";
      item.avisos.push(`Precisa do projeto “${item.precisaDe.rotulo}”, que ainda não existe neste empreendimento.`);
      continue;
    }
    // O APROVADO pode já ter regra e faltar a de devolutivas ou a de protocolos: isso também é trabalho pendente.
    const faltaRegraDeSinal = item.slots.some((slot) => slot.jaCriada && slot.escolhida !== null && (slot.derivadas[slot.escolhida] ?? []).some((regra) => !regra.jaCriada));
    item.pendente = (defineProjeto && !item.projetoJaExiste) || item.slots.some((slot) => slot.estado !== "ausente" && !slot.jaCriada) || faltaRegraDeSinal;
    if (!item.pendente) item.estado = "ja_criado";
    else if (item.slots.some((slot) => slot.estado === "ambigua")) item.estado = "ambiguo";
    else if (item.slots.every((slot) => slot.estado !== "ausente")) item.estado = "encontrado";
    else item.estado = "parcial";
    item.marcado = item.estado === "encontrado" || item.estado === "parcial";
  }

  // Regras ativas cuja pasta sumiu da árvore (renomeada): sugere o caminho novo pelo mesmo item do catálogo.
  const orfas: RegraOrfa[] = [];
  const caminhosComRegra = new Set(entrada.regras.filter((regra) => regra.ativa).map((regra) => chaveDoCaminho(regra.caminhoPrefixo)));
  for (const regra of entrada.regras) {
    if (!ehOrfa(regra, chaves)) continue;
    const segmentos = regra.caminhoPrefixo.normalize("NFC").split("/");
    const palavrasDaPasta = segmentos.length > 1 ? palavrasDe(segmentos[1]) : [];
    const dono = segmentos.length > 1
      ? catalogo.find((item) => normalizarNome(item.raiz) === normalizarNome(segmentos[0]) && casaItem(item, palavrasDaPasta))
      : undefined;
    let sugestao: string | null = null;
    if (dono) {
      const candidatas = [...new Set(itens.filter((item) => item.chave === dono.chave).flatMap((item) => item.slots.flatMap((slot) => slot.candidatas)))];
      const chave = segmentos.map(normalizarNome).join("/");
      const iguais = candidatas.filter((candidata) => candidata.split("/").map(normalizarNome).join("/") === chave);
      if (iguais.length === 1) sugestao = iguais[0];
      else if (iguais.length === 0 && dono.subpastas.length <= 1 && candidatas.length === 1) sugestao = candidatas[0];
    }
    // Se o caminho novo já tem regra ativa, trocar criaria duas regras na mesma pasta; aí a pessoa só apaga a órfã.
    if (sugestao && caminhosComRegra.has(chaveDoCaminho(sugestao))) sugestao = null;
    if (orfas.length < MAXIMO_DE_AVISOS) orfas.push({ regraId: regra.id, caminhoAtual: regra.caminhoPrefixo, sugestao, rotulo: dono?.rotulo ?? null });
  }

  const visiveis = entrada.lerComplementares ? itens : itens.filter((item) => item.fase !== "complementar");
  return { itens: visiveis, pastasDesconhecidas, orfas, lerComplementares: entrada.lerComplementares };
}

// ---------------------------------------------------------------------------------------------------------------------
// Seleção: o cliente só escolhe entre as candidatas que a pré-visualização recalculada no servidor mostra.
// ---------------------------------------------------------------------------------------------------------------------

export type PedidoDeItem = { chave: string; sistema: Sistema | null; caminhos: readonly string[] };
export type ItemParaOBanco = { chave: string; caminhos: string[]; projeto_pai_chave: string | null; nome_projeto: string | null };
// As regras de protocolos e de devolutivas não passam pela função do banco (ela só cria comum e equipamentos): o site as
// cria logo depois, no projeto do item (achado pelo nome que a função usou).
export type RegraDerivadaSelecionada = { nomeProjeto: string; tipo: TipoDeRegraDerivada; caminho: string };
export type ResultadoDaSelecao = { ok: true; itens: ItemParaOBanco[]; derivadas: RegraDerivadaSelecionada[] } | { ok: false; erro: string };

export function resolverSelecao(montagem: Montagem, pedidos: readonly PedidoDeItem[]): ResultadoDaSelecao {
  if (pedidos.length === 0 || pedidos.length > MAXIMO_DE_ITENS_NA_SELECAO) return { ok: false, erro: "Escolha de 1 a 50 itens." };
  const vistos = new Set<string>();
  const selecionados: { item: ItemDaMontagem; caminhos: string[]; derivadas: RegraDerivadaSelecionada[] }[] = [];

  for (const pedido of pedidos) {
    const item = montagem.itens.find((candidato) => candidato.chave === pedido.chave && candidato.sistema === pedido.sistema);
    if (!item) return { ok: false, erro: "Um dos itens não está mais disponível. Atualize a lista e tente de novo." };
    if (vistos.has(item.id)) return { ok: false, erro: "Item repetido na seleção." };
    vistos.add(item.id);
    if (!item.pendente || (item.estado !== "encontrado" && item.estado !== "parcial" && item.estado !== "ambiguo")) {
      return { ok: false, erro: `Nada a criar em “${item.rotulo}”.` };
    }

    const escolhas: (string | undefined)[] = item.slots.map(() => undefined);
    for (const bruto of pedido.caminhos) {
      const caminho = bruto.normalize("NFC");
      const indice = item.slots.findIndex((slot, posicao) => escolhas[posicao] === undefined && slot.candidatas.includes(caminho));
      if (indice < 0) return { ok: false, erro: `A pasta escolhida para “${item.rotulo}” não está entre as encontradas no servidor.` };
      escolhas[indice] = caminho;
    }

    const caminhos: string[] = [];
    const derivadas: RegraDerivadaSelecionada[] = [];
    for (const [indice, slot] of item.slots.entries()) {
      if (slot.estado === "ausente") continue;
      const caminho = slot.jaCriada ? slot.escolhida : escolhas[indice] ?? slot.escolhida;
      if (!slot.jaCriada) {
        if (caminho === null || caminho === undefined) return { ok: false, erro: `Escolha a pasta de “${item.rotulo}” ou deixe o item de fora.` };
        if (!regraNovaPermitida(caminho)) return { ok: false, erro: `A pasta de “${item.rotulo}” não pode ter regra.` };
        caminhos.push(caminho);
      }
      if (item.tipo !== "projeto" || item.nomeProjeto === null || caminho === null || caminho === undefined) continue;
      for (const regra of slot.derivadas[caminho] ?? []) {
        if (!regra.jaCriada) derivadas.push({ nomeProjeto: item.nomeProjeto, tipo: regra.tipo, caminho: regra.caminho });
      }
    }
    selecionados.push({ item, caminhos, derivadas });
  }

  for (const { item } of selecionados) {
    if (item.precisaDe && !item.precisaDe.existe && !selecionados.some((outro) => outro.item.chave === item.precisaDe?.chave)) {
      return { ok: false, erro: `“${item.rotulo}” precisa do projeto “${item.precisaDe.rotulo}”: marque-o também.` };
    }
  }

  const vistas = new Set<string>();
  return {
    ok: true,
    itens: selecionados.map(({ item, caminhos }) => ({
      chave: item.chave,
      caminhos,
      projeto_pai_chave: item.tipo === "projeto" ? item.paiChave : null,
      nome_projeto: item.tipo === "projeto" ? item.nomeProjeto : null,
    })),
    derivadas: selecionados.flatMap(({ derivadas }) => derivadas).filter((regra) => {
      const chave = chaveDoCaminho(regra.caminho);
      if (vistas.has(chave)) return false;
      vistas.add(chave);
      return true;
    }),
  };
}

function regraNovaPermitida(caminho: string): boolean {
  const validado = validarPrefixoDeRegra(caminho);
  return validado.valido && validado.caminho === caminho && !caminhoBloqueado(caminho);
}

// Aviso "pronto para ler os complementares": o SAA ou o SES do empreendimento está numa etapa cujo nome tem "APROVAD".
export function prontoParaComplementares(projetos: readonly ProjetoParaMontagem[], catalogo: readonly ItemDoCatalogo[]): boolean {
  const modelos = new Set(
    SISTEMAS.map((sistema) => catalogo.find((item) => item.chave === CHAVE_DO_SISTEMA[sistema])?.modeloId).filter((id): id is string => Boolean(id)),
  );
  return projetos.some((projeto) => projeto.modeloId !== null && modelos.has(projeto.modeloId) && normalizarNome(projeto.etapaAtualNome ?? "").includes("APROVAD"));
}
