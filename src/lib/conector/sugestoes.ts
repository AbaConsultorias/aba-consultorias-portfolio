import { caminhoBloqueado, caminhoDePastaValido, casarRegra, chaveDoCaminho, contemCaractereInvalido, semAcentoEmMaiusculas } from "./regras";

// "arquivo": pasta de um projeto que não existe no site (Urbanístico, Drenagem...); a regra tem rótulo e os PDFs aparecem
// no bloco "Outros projetos" do cliente.
export const GRUPOS_DE_DOCUMENTO = ["contratos", "orcamentos", "arquivo"] as const;
export type GrupoDeDocumento = (typeof GRUPOS_DE_DOCUMENTO)[number];
export const ROTULO_DO_GRUPO: Record<GrupoDeDocumento, string> = { contratos: "Contratos", orcamentos: "Orçamentos", arquivo: "Outros projetos (arquivo)" };
// Mesmo limite do CHECK de pasta_regras.rotulo e de documentos.pasta_rotulo.
export const TAMANHO_MAXIMO_DO_ROTULO = 120;
// Mesmo limite do CHECK de pasta_regras.caminho_prefixo (a coluna é mais curta que o caminho de origem do arquivo).
export const TAMANHO_MAXIMO_PREFIXO = 500;
const MAXIMO_PASTAS_DA_ARVORE = 5000;

export type ProjetoParaSugestao = { id: string; nome: string; modeloNome?: string | null };
export type SugestaoDeRegra = {
  caminhoPrefixo: string;
  rotulo: string;
  projetoId: string | null;
  grupo: GrupoDeDocumento | null;
  motivo: string;
  pastaFinal: boolean;
};
export type EntradaDeSugestoes = {
  pastas: readonly string[];
  projetos: readonly ProjetoParaSugestao[];
  regrasExistentes: readonly string[];
};
export type PrefixoValidado = { valido: true; caminho: string } | { valido: false; motivo: string };
export type RotuloValidado = { valido: true; rotulo: string } | { valido: false; motivo: string };

// Rótulo do grupo "arquivo": mesmo critério dos CHECKs de pasta_regras.rotulo e documentos.pasta_rotulo (1 a 120
// caracteres depois do trim, sem caractere de controle).
export function validarRotulo(bruto: string): RotuloValidado {
  const rotulo = bruto.trim().normalize("NFC");
  if (rotulo === "") return { valido: false, motivo: "Informe o rótulo do cartão." };
  if ([...rotulo].length > TAMANHO_MAXIMO_DO_ROTULO) return { valido: false, motivo: `O rótulo passa de ${TAMANHO_MAXIMO_DO_ROTULO} caracteres.` };
  if (contemCaractereInvalido(rotulo)) return { valido: false, motivo: "O rótulo tem caractere inválido." };
  return { valido: true, rotulo };
}

const ehObjeto = (valor: unknown): valor is Record<string, unknown> => typeof valor === "object" && valor !== null && !Array.isArray(valor);
const palavra = (termo: string): RegExp => new RegExp(`(?<![A-Z0-9])(?:${termo})(?![A-Z0-9])`);

type Alvo = { rotulo: string; pasta: RegExp; projeto?: RegExp; grupo?: GrupoDeDocumento };

// Comparados com o nome já sem acento e em maiúsculas. A ordem decide quando um mesmo nome casa com mais de um alvo.
const ALVOS: readonly Alvo[] = [
  { rotulo: "PROPOSTA-CONTRATO", pasta: /PROPOSTA.*CONTRATO/, grupo: "contratos" },
  { rotulo: "ORÇAMENTOS DE 3", pasta: /ORCAMENTOS?\s*DE\s*3(?![0-9])/, grupo: "orcamentos" },
  { rotulo: "SAA", pasta: palavra("SAA"), projeto: palavra("SAA|SISTEMA\\s+DE\\s+ABASTECIMENTO") },
  { rotulo: "SES", pasta: palavra("SES"), projeto: palavra("SES|SISTEMA\\s+DE\\s+ESGOTAMENTO") },
  { rotulo: "PER", pasta: palavra("PER") },
  { rotulo: "PEC", pasta: palavra("PEC") },
  { rotulo: "TERMO DE ACORDO", pasta: palavra("TERMO\\s+DE\\s+ACORDO") },
  { rotulo: "ORDEM DE SERVIÇO", pasta: palavra("ORDEM\\s+DE\\s+SERVICO") },
  { rotulo: "DOAÇÃO", pasta: palavra("DOACAO|DOACOES") },
  { rotulo: "ESTRUTURAL", pasta: palavra("ESTRUTURAL") },
];

// D2: dentro da pasta casada, a versão final (aprovada, assinada ou em PDF) é a que vale para o cliente.
const PASTA_FINAL = palavra("APROVAD[OA]S?|FINAL|FINAIS|ASSINAD[OA]S?|PDF");

export function validarPrefixoDeRegra(bruto: string): PrefixoValidado {
  const caminho = bruto.trim().normalize("NFC");
  if (caminho === "") return { valido: false, motivo: "Informe o caminho da pasta." };
  if ([...caminho].length > TAMANHO_MAXIMO_PREFIXO) return { valido: false, motivo: `O caminho passa de ${TAMANHO_MAXIMO_PREFIXO} caracteres.` };
  if (!caminhoDePastaValido(caminho)) {
    return { valido: false, motivo: "Use nomes de pasta separados por \"/\", sem \"\\\", \":\", \".\", \"..\" nem \"/\" no começo ou no fim." };
  }
  if (caminhoBloqueado(caminho)) return { valido: false, motivo: "Esta pasta tem documentos pessoais ou financeiros e nunca pode ter regra." };
  return { valido: true, caminho };
}

// A árvore vem do programa do servidor, que o site não controla: só entram pastas válidas e não bloqueadas.
export function pastasDaArvore(arvore: unknown, codigoPasta: string): string[] {
  if (!ehObjeto(arvore) || !Object.hasOwn(arvore, codigoPasta)) return [];
  const lista = arvore[codigoPasta];
  if (!Array.isArray(lista)) return [];
  const vistas = new Set<string>();
  const pastas: string[] = [];
  for (const item of lista as unknown[]) {
    if (typeof item !== "string") continue;
    const caminho = item.normalize("NFC");
    if (!caminhoDePastaValido(caminho) || caminhoBloqueado(caminho)) continue;
    const chave = chaveDoCaminho(caminho);
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    pastas.push(caminho);
    if (pastas.length >= MAXIMO_PASTAS_DA_ARVORE) break;
  }
  return pastas;
}

type Grupo = { base: string; alvo: Alvo; descendentes: string[][] };

function primeiroAlvo(segmentos: readonly string[]): { alvo: Alvo; indice: number } | null {
  for (let indice = 0; indice < segmentos.length; indice += 1) {
    const nome = semAcentoEmMaiusculas(segmentos[indice]);
    const alvo = ALVOS.find((candidato) => candidato.pasta.test(nome));
    if (alvo) return { alvo, indice };
  }
  return null;
}

function projetosCandidatos(alvo: Alvo, projetos: readonly ProjetoParaSugestao[]): ProjetoParaSugestao[] {
  const regex = alvo.projeto ?? alvo.pasta;
  return projetos.filter((projeto) => regex.test(semAcentoEmMaiusculas(projeto.nome)) || regex.test(semAcentoEmMaiusculas(projeto.modeloNome ?? "")));
}

function destinoDoAlvo(alvo: Alvo, projetos: readonly ProjetoParaSugestao[]): Pick<SugestaoDeRegra, "projetoId" | "grupo" | "motivo"> {
  if (alvo.grupo) return { projetoId: null, grupo: alvo.grupo, motivo: `Pasta "${alvo.rotulo}": vai para ${ROTULO_DO_GRUPO[alvo.grupo].toLowerCase()} do empreendimento.` };
  const candidatos = projetosCandidatos(alvo, projetos);
  if (candidatos.length === 1) return { projetoId: candidatos[0].id, grupo: null, motivo: `Pasta "${alvo.rotulo}": combina com o projeto "${candidatos[0].nome}".` };
  const quando = candidatos.length === 0 ? "Nenhum projeto tem esse nome" : "Mais de um projeto tem esse nome";
  return { projetoId: null, grupo: null, motivo: `Pasta "${alvo.rotulo}": ${quando}. Escolha o destino.` };
}

// Prefixos das pastas finais (a primeira pasta aprovada/assinada/PDF de cada ramo) abaixo da pasta casada.
function pastasFinais(grupo: Grupo): string[] {
  const finais = new Map<string, string>();
  for (const relativo of grupo.descendentes) {
    const indice = relativo.findIndex((segmento) => PASTA_FINAL.test(semAcentoEmMaiusculas(segmento)));
    if (indice < 0) continue;
    const caminho = [grupo.base, ...relativo.slice(0, indice + 1)].join("/");
    finais.set(chaveDoCaminho(caminho), caminho);
  }
  return [...finais.values()];
}

export function sugerirRegras({ pastas, projetos, regrasExistentes }: EntradaDeSugestoes): SugestaoDeRegra[] {
  const existentes = regrasExistentes.map((caminhoPrefixo, indice) => ({ id: String(indice), caminho_prefixo: caminhoPrefixo }));
  const grupos = new Map<string, Grupo>();

  for (const bruta of pastas) {
    const pasta = bruta.normalize("NFC");
    if (!caminhoDePastaValido(pasta) || caminhoBloqueado(pasta)) continue;
    const segmentos = pasta.split("/");
    const achado = primeiroAlvo(segmentos);
    if (!achado) continue;
    const base = segmentos.slice(0, achado.indice + 1).join("/");
    const chave = chaveDoCaminho(base);
    const grupo = grupos.get(chave) ?? { base, alvo: achado.alvo, descendentes: [] };
    if (segmentos.length > achado.indice + 1) grupo.descendentes.push(segmentos.slice(achado.indice + 1));
    grupos.set(chave, grupo);
  }

  const sugestoes: SugestaoDeRegra[] = [];
  for (const grupo of grupos.values()) {
    const finais = pastasFinais(grupo);
    const alvos = finais.length > 0 ? finais : [grupo.base];
    const destino = destinoDoAlvo(grupo.alvo, projetos);
    for (const caminhoPrefixo of alvos) {
      if ([...caminhoPrefixo].length > TAMANHO_MAXIMO_PREFIXO || casarRegra(caminhoPrefixo, existentes)) continue;
      sugestoes.push({ caminhoPrefixo, rotulo: grupo.alvo.rotulo, ...destino, pastaFinal: finais.length > 0 });
    }
  }
  return sugestoes.sort((a, b) => {
    const [x, y] = [chaveDoCaminho(a.caminhoPrefixo), chaveDoCaminho(b.caminhoPrefixo)];
    return x < y ? -1 : x > y ? 1 : 0;
  });
}
