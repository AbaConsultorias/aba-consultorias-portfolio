import { semAcentoEmMaiusculas } from "@/lib/conector/regras";
import { ROTULO_DO_GRUPO, type GrupoDeDocumento } from "@/lib/conector/sugestoes";
import type { ProjetoDaPasta, RegraDePasta, TipoDeRegraDePasta } from "@/lib/portal/pasta/tipos";

// rotulo só existe no grupo "arquivo" (nome do cartão em "Outros projetos"); "" é o campo ainda vazio.
export type Destino = { projetoId: string | null; categoriaId: string | null; grupo: GrupoDeDocumento | null; rotulo: string | null };

export const SEM_DESTINO: Destino = { projetoId: null, categoriaId: null, grupo: null, rotulo: null };

export const destinoDaRegra = (regra: RegraDePasta): Destino => ({ projetoId: regra.projetoId, categoriaId: regra.categoriaId, grupo: regra.grupo, rotulo: regra.rotulo });

export const destinoCompleto = (destino: Destino): boolean => {
  if (destino.projetoId !== null) return true;
  if (destino.grupo === "arquivo") return (destino.rotulo ?? "").trim() !== "";
  return destino.grupo !== null;
};

// O <select> do destino mistura projetos e grupos: "p:<id>" ou "g:<grupo>".
export function valorDoDestino(destino: Destino): string {
  if (destino.projetoId) return `p:${destino.projetoId}`;
  return destino.grupo ? `g:${destino.grupo}` : "";
}

// Trocar o destino para outro grupo ou projeto zera o rótulo; escolher "arquivo" de novo mantém o que já foi digitado.
export function destinoDoValor(valor: string, rotuloAtual: string | null = null): Destino {
  if (valor.startsWith("p:")) return { projetoId: valor.slice(2), categoriaId: null, grupo: null, rotulo: null };
  if (valor === "g:contratos") return { projetoId: null, categoriaId: null, grupo: "contratos", rotulo: null };
  if (valor === "g:orcamentos") return { projetoId: null, categoriaId: null, grupo: "orcamentos", rotulo: null };
  if (valor === "g:arquivo") return { projetoId: null, categoriaId: null, grupo: "arquivo", rotulo: rotuloAtual ?? "" };
  return SEM_DESTINO;
}

// Na regra de equipamentos o destino é só o projeto (o SIMO e o Laudo vão para as categorias SIMOS e Laudos dele).
// Em protocolos e devolutivas o destino é o projeto (categoria opcional), nunca o grupo.
export const ehTipoDeEtapa = (tipo: TipoDeRegraDePasta): boolean => tipo === "protocolos" || tipo === "devolutivas";

export function destinoCompletoDoTipo(destino: Destino, tipo: TipoDeRegraDePasta): boolean {
  if (tipo === "equipamentos") return destino.projetoId !== null && destino.categoriaId === null && destino.grupo === null;
  if (ehTipoDeEtapa(tipo)) return destino.projetoId !== null && destino.grupo === null;
  return destinoCompleto(destino);
}

// Mesmo critério do gatilho do banco: algum trecho do caminho com APROVAD (aprovado, aprovada, aprovados).
export const caminhoSugereAprovado = (caminho: string): boolean =>
  caminho.split("/").some((segmento) => semAcentoEmMaiusculas(segmento).includes("APROVAD"));

const CATEGORIA_DO_TIPO: Partial<Record<TipoDeRegraDePasta, string>> = { protocolos: "protocolos", devolutivas: "devolutivas da copasa" };

// Ao escolher o projeto de uma regra de protocolos/devolutivas, já aponta para a categoria de mesmo nome, se o projeto tiver.
export function comCategoriaSugerida(destino: Destino, tipo: TipoDeRegraDePasta, projetos: readonly ProjetoDaPasta[]): Destino {
  const nome = CATEGORIA_DO_TIPO[tipo];
  if (!nome || !destino.projetoId || destino.categoriaId) return destino;
  const projeto = projetos.find((candidato) => candidato.id === destino.projetoId);
  const categoria = projeto?.categorias.find((candidata) => candidata.nome.trim().toLowerCase() === nome);
  return categoria ? { ...destino, categoriaId: categoria.id } : destino;
}

// Versão curta de descreverDestino para o selo da linha da regra: "SAA › Projetos", "Contratos", "SIMOS e Laudos de SAA".
export function rotuloCurtoDoDestino(destino: Destino, projetos: readonly ProjetoDaPasta[], tipo: TipoDeRegraDePasta = "comum"): string {
  const projeto = projetos.find((candidato) => candidato.id === destino.projetoId);
  if (tipo === "equipamentos") return projeto ? `SIMOS e Laudos de ${projeto.nome}` : "Projeto não encontrado";
  if (destino.grupo === "arquivo") return `${ROTULO_DO_GRUPO.arquivo} › ${destino.rotulo ?? ""}`;
  if (destino.grupo) return ROTULO_DO_GRUPO[destino.grupo];
  if (!destino.projetoId) return "Sem destino";
  if (!projeto) return "Projeto não encontrado";
  const categoria = projeto.categorias.find((candidata) => candidata.id === destino.categoriaId);
  return categoria ? `${projeto.nome} › ${categoria.nome}` : projeto.nome;
}

export function descreverDestino(destino: Destino, projetos: readonly ProjetoDaPasta[], tipo: TipoDeRegraDePasta = "comum"): string {
  if (tipo === "equipamentos") {
    const projeto = projetos.find((candidato) => candidato.id === destino.projetoId);
    return projeto ? `SIMOS e Laudos de ${projeto.nome}` : "Projeto não encontrado";
  }
  if (destino.grupo === "arquivo") return `${ROTULO_DO_GRUPO.arquivo}: cartão “${destino.rotulo ?? ""}”`;
  if (destino.grupo) return `Grupo ${ROTULO_DO_GRUPO[destino.grupo]} do empreendimento`;
  if (!destino.projetoId) return "Sem destino";
  const projeto = projetos.find((candidato) => candidato.id === destino.projetoId);
  if (!projeto) return "Projeto não encontrado";
  const categoria = projeto.categorias.find((candidata) => candidata.id === destino.categoriaId);
  return categoria ? `Projeto ${projeto.nome} › ${categoria.nome}` : `Projeto ${projeto.nome}`;
}
