export type Campo = {
    nome: string;
    rotulo: string;
    tipo?: "texto" | "area" | "numero" | "data" | "lista" | "arquivo" | "select";
    opcoes?: readonly (readonly [
        string,
        string
    ])[];
    destino?: string;
    video?: boolean;
    dica?: string;
    obrigatorio?: boolean;
};
export type Recurso = {
    titulo: string;
    tabela: string;
    campos: Campo[];
    arquivos: string[];
    singleton?: boolean;
};
const campo = (nome: string, rotulo: string, tipo: Campo["tipo"] = "texto", extra: Partial<Campo> = {}): Campo => ({
    nome, rotulo, tipo, ...extra
});
const arquivo = (nome: string, rotulo: string, destino: string, video = false): Campo => campo(nome, rotulo, "arquivo", { destino, video });
const seletor = (nome: string, rotulo: string, opcoes: readonly (readonly [
    string,
    string
])[]): Campo => campo(nome, rotulo, "select", { opcoes });
export const recursos: Record<string, Recurso> = {
    banners: {
        titulo: "Topo do site", tabela: "banners_hero", arquivos: ["imagem_path"], campos: [campo("sobrancelha", "Sobrancelha"), campo("titulo", "Título"), campo("titulo_destaque", "Título em destaque (itálico)"), campo("texto", "Texto", "area"), campo("mensagem_whatsapp", "Mensagem do WhatsApp", "area"), campo("botao_rotulo", "Rótulo do botão secundário"), campo("botao_href", "Caminho do botão secundário", "texto", { dica: "Use /contato ou #servicos, por exemplo." }), arquivo("imagem_path", "Imagem", "hero"), seletor("imagem_posicao", "Posição da imagem", [["center", "Centro"], ["left center", "Esquerda"], ["right center", "Direita"], ["62% center", "62% ao centro"], ["top center", "Topo"], ["bottom center", "Base"]]), campo("legenda", "Legenda")]
    },
    servicos: {
        titulo: "Serviços", tabela: "servicos", arquivos: ["foto_path"], campos: [seletor("frente", "Frente", [["loteadores", "Para loteadores"], ["casa", "Para sua casa"]]), campo("titulo", "Título"), campo("slug", "Slug", "texto", { dica: "Gerado pelo título; você pode editar. Deve ser único." }), campo("subtitulo", "Subtítulo"), campo("resumo", "Resumo", "area"), campo("conteudo", "Conteúdo (texto simples)", "area"), campo("itens", "Itens", "lista"), seletor("icone", "Ícone / desenho", [["", "Sem desenho"], ["arquitetonico", "Arquitetônico"], ["eletrico", "Elétrico"], ["hidrossanitario", "Hidrossanitário"]]), arquivo("foto_path", "Foto", "servicos"), campo("mensagem_whatsapp", "Mensagem do WhatsApp", "area")]
    },
    projetos: {
        titulo: "Projetos", tabela: "portfolio_projetos", arquivos: ["capa_path"], campos: [campo("titulo", "Título"), campo("slug", "Slug", "texto", { dica: "Gerado pelo título; você pode editar. Deve ser único." }), campo("cidade", "Cidade"), seletor("categoria", "Categoria", [["loteamento", "Loteamento"], ["residencial", "Residencial"], ["obra_copasa", "Obra Copasa"], ["outro", "Outro"]]), campo("descricao", "Descrição", "area"), campo("concluido_em", "Concluído em", "data"), arquivo("capa_path", "Capa", "portfolio")]
    },
    "midias-projeto": {
        titulo: "Galeria do projeto", tabela: "midias", arquivos: ["storage_path"], campos: [seletor("tipo", "Tipo", [["foto", "Foto"], ["video", "Vídeo MP4"]]), arquivo("storage_path", "Arquivo", "portfolio"), campo("legenda", "Legenda")]
    },
    depoimentos: {
        titulo: "Depoimentos e avaliações", tabela: "depoimentos", arquivos: [], campos: [campo("nome", "Nome", "texto", { dica: "Use o primeiro nome e a inicial do sobrenome." }), campo("cidade", "Cidade"), campo("texto", "Depoimento", "area"), seletor("origem", "Origem", [["cliente", "Cliente"], ["google", "Google"]]), campo("nota", "Nota (1 a 5, somente Google)", "numero"), campo("quando", "Quando", "texto", { dica: "Exemplo: há 1 ano." })]
    },
    parceiros: {
        titulo: "Parceiros", tabela: "parceiros", arquivos: ["logo_path"], campos: [campo("nome", "Nome"), arquivo("logo_path", "Logo", "parceiros"), campo("site_url", "Site (https, opcional)")]
    },
    videos: {
        titulo: "Vídeos do Instagram", tabela: "videos_instagram", arquivos: ["video_path", "poster_path"], campos: [arquivo("video_path", "Vídeo MP4", "instagram", true), arquivo("poster_path", "Pôster (opcional)", "instagram"), campo("legenda", "Legenda", "area")]
    },
    configuracoes: {
        titulo: "Configurações do site", tabela: "configuracoes_site", singleton: true, arquivos: [], campos: [campo("whatsapp", "WhatsApp", "texto", { dica: "Somente dígitos, com DDI e DDD." }), campo("email", "E-mail"), campo("telefone", "Telefone"), campo("endereco", "Endereço"), campo("mapa_url", "Link do mapa (https)"), campo("instagram_url", "Instagram (URL https)"), campo("instagram_usuario", "Usuário do Instagram"), campo("facebook_url", "Facebook (https)"), campo("linkedin_url", "LinkedIn (https)"), campo("sobre_titulo", "Título Sobre"), campo("sobre_texto", "Texto Sobre", "area"), campo("google_avaliacoes_url", "Link das avaliações Google (https)"), campo("google_avaliar_url", "Link para avaliar (https)"), campo("google_nota", "Nota Google (0 a 5, uma casa decimal)", "numero"), campo("google_total", "Total de avaliações", "numero")]
    },
};
export type Registro = Record<string, unknown> & {
    id: string;
    ordem?: number;
    publicado?: boolean;
};
export function nomeRegistro(registro: Registro): string {
    return String(registro.titulo || registro.nome || registro.legenda || "Sem título");
}
export function valoresIniciais(recurso: string, registro?: Registro, donoId?: string): Record<string, unknown> {
    const valores: Record<string, unknown> = { ordem: 0, publicado: false };
    for (const c of recursos[recurso].campos)
        valores[c.nome] = c.tipo === "lista" ? [] : c.tipo === "numero" || c.tipo === "arquivo" || c.tipo === "data" ? null : "";
    Object.assign(valores, {
        frente: "loteadores", categoria: "outro", origem: "cliente", imagem_posicao: "center", tipo: "foto", portfolio_projeto_id: donoId
    });
    if (registro)
        Object.assign(valores, registro);
    return valores;
}
