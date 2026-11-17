import type { Centavos } from "../comum/tipos";
import type { ItemFinanceiroPortal, ParcelaComVencimento, ParcelaPortal, ResumoFinanceiro, TipoEvento } from "./tipos";

export const DIAS_VENCE_EM_BREVE = 15;

export const semAcento = (texto: string): string => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function parcelaQuitada(parcela: ParcelaPortal): boolean {
  return parcela.dataPagamento !== null
    || BigInt(parcela.valorPagoCentavos) >= BigInt(parcela.valorPrevistoCentavos);
}

function comVencimento(parcela: ParcelaPortal): parcela is ParcelaComVencimento {
  return parcela.vencimento !== null;
}

export function somarPagamentos(parcelas: readonly ParcelaPortal[]): Centavos {
  let total = BigInt(0);
  for (const parcela of parcelas) total += BigInt(parcela.valorPagoCentavos);
  return total.toString();
}

export function calcularSaldo(contratado: Centavos, parcelas: readonly ParcelaPortal[]): Centavos {
  return (BigInt(contratado) - BigInt(somarPagamentos(parcelas))).toString();
}

const nuloPorUltimo = <T extends number | string>(a: T | null, b: T | null): number => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
};

export function compararParcelas(a: ParcelaPortal, b: ParcelaPortal): number {
  return nuloPorUltimo(a.numero, b.numero) || nuloPorUltimo(a.vencimento, b.vencimento) || nuloPorUltimo(a.id, b.id);
}

export function proximoPagamento(parcelas: readonly ParcelaPortal[]): ParcelaComVencimento | null {
  let proxima: ParcelaComVencimento | null = null;
  for (const parcela of parcelas) {
    if (!comVencimento(parcela) || parcelaQuitada(parcela)) continue;
    if (proxima === null
      || parcela.vencimento < proxima.vencimento
      || (parcela.vencimento === proxima.vencimento && parcela.id < proxima.id)) proxima = parcela;
  }
  return proxima;
}

export function saldoDaParcela(parcela: ParcelaPortal): Centavos {
  const diferenca = BigInt(parcela.valorPrevistoCentavos) - BigInt(parcela.valorPagoCentavos);
  return (diferenca > BigInt(0) ? diferenca : BigInt(0)).toString();
}

export function diferencaPrevisto(contratado: Centavos, parcelas: readonly ParcelaPortal[]): Centavos {
  return (BigInt(contratado) - BigInt(somarCentavos(parcelas.map((parcela) => parcela.valorPrevistoCentavos)))).toString();
}

export function parcelaEmAtraso(parcela: ParcelaPortal, hoje: string): boolean {
  return !parcelaQuitada(parcela) && parcela.vencimento !== null && parcela.vencimento < hoje;
}

export function parcelaAguardaEvento(parcela: ParcelaPortal): boolean {
  return !parcelaQuitada(parcela) && parcela.vencimento === null;
}

export type SituacaoVisualParcela = "quitada" | "vencida" | "parcial" | "vence-em-breve" | "aberta" | "aguarda-evento";
export type SituacaoItem = "atraso" | "quitado" | "em-dia" | "vence-em-breve" | "parcial";

function diasAte(vencimento: string, hoje: string): number {
  return (Date.parse(`${vencimento}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / 86400000;
}

export function parcelaVenceEmBreve(parcela: ParcelaPortal, hoje: string): boolean {
  if (parcelaQuitada(parcela) || parcela.vencimento === null || parcela.vencimento < hoje) return false;
  return diasAte(parcela.vencimento, hoje) <= DIAS_VENCE_EM_BREVE;
}

export function situacaoVisualParcela(parcela: ParcelaPortal, hoje: string): SituacaoVisualParcela {
  if (parcelaQuitada(parcela)) return "quitada";
  if (parcelaAguardaEvento(parcela)) return "aguarda-evento";
  if (parcelaEmAtraso(parcela, hoje)) return "vencida";
  if (parcelaVenceEmBreve(parcela, hoje)) return "vence-em-breve";
  if (BigInt(parcela.valorPagoCentavos) > BigInt(0)) return "parcial";
  return "aberta";
}

export function situacaoDoItem(item: Pick<ItemFinanceiroPortal, "parcelas" | "valorContratadoCentavos">, hoje: string): SituacaoItem {
  if (item.parcelas.some((parcela) => parcelaEmAtraso(parcela, hoje))) return "atraso";
  if (item.parcelas.some((parcela) => parcelaVenceEmBreve(parcela, hoje))) return "vence-em-breve";
  if (item.parcelas.some((parcela) => situacaoVisualParcela(parcela, hoje) === "parcial")) return "parcial";
  if (item.parcelas.length > 0 && item.parcelas.every(parcelaQuitada) && BigInt(calcularSaldo(item.valorContratadoCentavos, item.parcelas)) <= BigInt(0)) return "quitado";
  return "em-dia";
}

// Não pagas que vencem de hoje até hoje + dias (as vencidas ficam no aviso de atraso).
export function parcelasAVencer(parcelas: readonly ParcelaPortal[], hoje: string, dias: number = DIAS_VENCE_EM_BREVE): ParcelaComVencimento[] {
  return parcelas
    .filter(comVencimento)
    .filter((parcela) => !parcelaQuitada(parcela) && parcela.vencimento >= hoje && diasAte(parcela.vencimento, hoje) <= dias)
    .sort((a, b) => nuloPorUltimo(a.vencimento, b.vencimento) || nuloPorUltimo(a.id, b.id));
}

export function somarCentavos(valores: readonly Centavos[]): Centavos {
  let total = BigInt(0);
  for (const valor of valores) total += BigInt(valor);
  return total.toString();
}

export function formatarBRL(centavos: Centavos): string {
  const valor = BigInt(centavos);
  const negativo = valor < BigInt(0);
  const digitos = (negativo ? -valor : valor).toString().padStart(3, "0");
  const reais = digitos.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}R$ ${reais},${digitos.slice(-2)}`;
}

export function formatarDataCivil(data: string): string {
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}

export function dataCivilDeHoje(agora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(agora);
  return partes;
}

export function converterReaisParaCentavos(texto: string): Centavos | null {
  const limpo = texto.trim().replace(/^R\$\s*/, "").replace(/\s/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$|^\d+\.\d{1,2}$/.test(limpo)) return null;
  const normalizado = /^\d+\.\d{1,2}$/.test(limpo) ? limpo : limpo.replace(/\./g, "").replace(",", ".");
  const [inteiro, fracao = ""] = normalizado.split(".");
  const centavos = BigInt(inteiro + fracao.padEnd(2, "0"));
  return centavos > BigInt("9223372036854775807") ? null : centavos.toString();
}

export function resumir(itens: readonly Pick<ItemFinanceiroPortal, "valorContratadoCentavos" | "parcelas">[]): ResumoFinanceiro {
  const todasAsParcelas = itens.flatMap((item) => item.parcelas);
  const contratadoCentavos = somarCentavos(itens.map((item) => item.valorContratadoCentavos));
  return {
    contratadoCentavos,
    pagoCentavos: somarCentavos(todasAsParcelas.map((parcela) => parcela.valorPagoCentavos)),
    saldoCentavos: somarCentavos(itens.map((item) => calcularSaldo(item.valorContratadoCentavos, item.parcelas))),
    proximoPagamento: proximoPagamento(todasAsParcelas),
  };
}

export function centavosParaCampo(centavos: Centavos): string {
  const digitos = BigInt(centavos).toString().padStart(3, "0");
  return `${digitos.slice(0, -2)},${digitos.slice(-2)}`;
}

// Sem nome próprio, a parcela é chamada pela posição no item (lista já ordenada por número, vencimento e id).
export function nomeParcela(parcela: ParcelaPortal, posicao: number): string {
  return parcela.nome ?? `${posicao}ª parcela`;
}

export function numeroDaParcela(parcela: ParcelaPortal, posicao: number, total: number): string {
  return `${parcela.numero ?? posicao}/${total}`;
}

// Percentual do contratado em centésimos de ponto (2550 = 25,50%), arredondado ao mais próximo.
export function percentualDoContratado(valor: Centavos, contratado: Centavos): string | null {
  const total = BigInt(contratado);
  if (total <= BigInt(0)) return null;
  const centesimos = (BigInt(valor) * BigInt(20000) + total) / (total * BigInt(2));
  const texto = `${centesimos / BigInt(100)},${(centesimos % BigInt(100)).toString().padStart(2, "0")}`;
  return texto.replace(/,00$/, "").replace(/(,\d)0$/, "$1");
}

export function valorDoPercentual(percentual: string, contratado: Centavos): Centavos | null {
  const limpo = percentual.trim().replace(/%$/, "").trim();
  if (!/^\d{1,3}([,.]\d{1,2})?$/.test(limpo)) return null;
  const [inteiro, fracao = ""] = limpo.replace(".", ",").split(",");
  const centesimos = BigInt(inteiro + fracao.padEnd(2, "0"));
  if (centesimos > BigInt(10000)) return null;
  return ((BigInt(contratado) * centesimos + BigInt(5000)) / BigInt(10000)).toString();
}

// "da OS", "do SAA": o gênero do nome do projeto não é conhecido, então só os nomes femininos conhecidos levam "da".
const NOMES_FEMININOS = new Set(["os", "outorga", "drenagem", "licenca", "obra", "rede", "doacao", "terraplenagem", "pavimentacao"]);

function deProjeto(nome: string | null): string {
  if (!nome) return "do serviço";
  const primeira = semAcento(nome).split(/\s+/)[0] ?? "";
  return `${NOMES_FEMININOS.has(primeira) ? "da" : "do"} ${nome}`;
}

type FraseEvento = { artigo: "a" | "o" | ""; substantivo: string };

function fraseDoEvento(tipo: TipoEvento, descricao: string | null, nomeDoProjeto: string | null): FraseEvento {
  switch (tipo) {
    case "assinatura": return { artigo: "a", substantivo: "assinatura do contrato" };
    case "protocolo": return { artigo: "o", substantivo: `protocolo ${deProjeto(nomeDoProjeto ?? "projeto")}` };
    case "aprovacao": return { artigo: "a", substantivo: `aprovação ${deProjeto(nomeDoProjeto ?? "projeto")}` };
    case "entrega": return { artigo: "a", substantivo: `entrega ${deProjeto(nomeDoProjeto)}` };
    case "doacoes_protocolo": return { artigo: "o", substantivo: "protocolo das doações" };
    case "doacoes_liberacao": return { artigo: "a", substantivo: "liberação das doações" };
    case "tro_pedido": return { artigo: "o", substantivo: "pedido do TRO" };
    case "tro_liberacao": return { artigo: "a", substantivo: "liberação do TRO" };
    case "urbanistico_aprovacao": return { artigo: "a", substantivo: "aprovação do urbanístico" };
    case "outro": return { artigo: "", substantivo: descricao ?? "evento" };
  }
}

// "30 dias após a aprovação do SAA"; sem dias, "no dia da aprovação do SAA".
export function rotuloRegra(parcela: ParcelaPortal, nomeDoProjeto: string | null): string | null {
  if (parcela.gatilho !== "evento" || parcela.eventoTipo === null) return null;
  const { artigo, substantivo } = fraseDoEvento(parcela.eventoTipo, parcela.eventoDescricao, nomeDoProjeto);
  const comArtigo = artigo ? `${artigo} ${substantivo}` : substantivo;
  if (parcela.diasApos > 0) return `${parcela.diasApos} ${parcela.diasApos === 1 ? "dia" : "dias"} após ${comArtigo}`;
  return `no dia ${artigo === "a" ? "da" : artigo === "o" ? "do" : "de"} ${substantivo}`;
}

// O que a parcela aguarda: "Aguarda aprovação do SAA" ou, com dias, "30 dias após a aprovação do SAA".
export function rotuloGatilho(parcela: ParcelaPortal, nomeDoProjeto: string | null): string {
  if (parcela.eventoTipo === null) return "Aguarda evento";
  if (parcela.diasApos > 0) return rotuloRegra(parcela, nomeDoProjeto) ?? "Aguarda evento";
  return `Aguarda ${fraseDoEvento(parcela.eventoTipo, parcela.eventoDescricao, nomeDoProjeto).substantivo}`;
}

// A sigla do código (260703PDT → PDT) diz que projetos o contrato costuma cobrir; a pessoa sempre ajusta.
// C (consultoria) não pré-marca nada.
const TERMOS_POR_SIGLA: Record<string, readonly string[]> = {
  P: ["saa", "dt"], PDT: ["saa", "dt"], PER: ["per"], PEC: ["pec"], DT: ["dt"], E: ["equipamento"],
  SPT: ["spt"], MO: ["mo"], ETR: ["etr"],
};

export function projetosSugeridos(codigo: string, projetos: readonly { id: string; nome: string }[]): string[] {
  const termos = TERMOS_POR_SIGLA[codigo.trim().toUpperCase().slice(6)] ?? [];
  if (termos.length === 0) return [];
  return projetos
    .filter((projeto) => {
      const palavras = semAcento(projeto.nome).split(/[^a-z0-9]+/);
      return termos.some((termo) => palavras.some((palavra) => (termo === "equipamento" ? palavra.startsWith(termo) : palavra === termo)));
    })
    .map((projeto) => projeto.id);
}

// "260703C.1" (código e versão) do contrato da ABA; sem código, o item de fornecedor não tem identificador.
export function codigoDoContrato(item: Pick<ItemFinanceiroPortal, "codigo" | "versao">): string | null {
  if (item.codigo === null) return null;
  return item.versao === null ? item.codigo : `${item.codigo}.${item.versao}`;
}

export function rotuloDoContrato(item: Pick<ItemFinanceiroPortal, "codigo" | "versao" | "descricao">): string {
  const codigo = codigoDoContrato(item);
  return codigo ? `${codigo} · ${item.descricao}` : item.descricao;
}

export function nomeDoProjetoDaParcela(item: Pick<ItemFinanceiroPortal, "projetos">, parcela: ParcelaPortal): string | null {
  if (parcela.eventoProjetoId === null) return null;
  return item.projetos.find((projeto) => projeto.id === parcela.eventoProjetoId)?.nome ?? null;
}
