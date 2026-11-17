// Formato do conteúdo público já pronto para as telas: camelCase e URLs resolvidas.

export type Configuracoes = {
  whatsapp: string | null;
  email: string | null;
  telefone: string | null;
  endereco: string | null;
  mapaUrl: string | null;
  instagramUrl: string | null;
  instagramUsuario: string | null;
  facebookUrl: string | null;
  linkedinUrl: string | null;
  sobreTitulo: string | null;
  sobreTexto: string | null;
  googleAvaliacoesUrl: string | null;
  googleAvaliarUrl: string | null;
  googleNota: number | null;
  googleTotal: number | null;
};

export type BannerHero = {
  id: string;
  sobrancelha: string;
  titulo: string;
  tituloDestaque: string | null;
  texto: string;
  mensagemWhatsApp: string | null;
  botaoRotulo: string | null;
  botaoHref: string | null;
  imagemUrl: string;
  imagemPosicao: string;
  legenda: string | null;
};

export type FrenteServico = "loteadores" | "casa";

export type Servico = {
  id: string;
  slug: string;
  frente: FrenteServico;
  titulo: string;
  subtitulo: string | null;
  resumo: string | null;
  conteudo: string | null;
  itens: string[];
  icone: string | null;
  fotoUrl: string | null;
  mensagemWhatsApp: string | null;
};

export type Midia = {
  id: string;
  tipo: "foto" | "video";
  url: string;
  legenda: string | null;
};

export type CategoriaProjeto = "loteamento" | "residencial" | "obra_copasa" | "outro";

export type ProjetoResumo = {
  id: string;
  slug: string;
  titulo: string;
  cidade: string | null;
  categoria: CategoriaProjeto;
  descricao: string | null;
  capaUrl: string | null;
  concluidoEm: string | null;
};

export type Projeto = ProjetoResumo & { midias: Midia[] };

export type StatusLote = "disponivel" | "vendido" | "area_tecnica";

export type Lote = {
  id: string;
  svgId: string | null;
  quadra: string;
  numero: string;
  areaM2: number | null;
  status: StatusLote;
  observacao: string | null;
};

export type LoteamentoResumo = {
  id: string;
  slug: string;
  nome: string;
  cidade: string | null;
  capaUrl: string | null;
  bannerUrl: string | null;
  lotesDisponiveis: number;
  totalLotes: number;
};

export type Loteamento = LoteamentoResumo & {
  endereco: string | null;
  mapsUrl: string | null;
  descricao: string | null;
  bannerMobileUrl: string | null;
  mapaSvgUrl: string | null;
  lotes: Lote[];
  midias: Midia[];
};

export type Depoimento = {
  id: string;
  nome: string;
  cidade: string | null;
  texto: string;
  origem: "google" | "cliente";
  nota: number | null;
  quando: string | null;
};

export type Parceiro = {
  id: string;
  nome: string;
  logoUrl: string;
  siteUrl: string | null;
};

export type VideoInstagram = {
  id: string;
  videoUrl: string;
  posterUrl: string | null;
  legenda: string | null;
};
