// Semeia o conteúdo público aprovado da home (docs/ETAPA-3-CONTRATO.md).
// Uso: node --env-file=.env scripts/semear-conteudo.mjs
// Idempotente: cada registro é procurado por slug/nome/título; se já existe, não
// é recriado nem sobrescrito (só ganha o arquivo que ainda não tinha). Os
// arquivos de public/estilo/ vão para o bucket site-publico em
// <prefixo>/<uuid>.<ext>, sem upsert. Imprime só contagens, nunca chaves.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { exit } from "node:process";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !secretKey) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SECRET_KEY no .env.");
  exit(1);
}

const supabase = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BUCKET = "site-publico";
const PASTA = join(import.meta.dirname, "..", "public", "estilo");
const TIPOS = { ".webp": "image/webp", ".mp4": "video/mp4" };

const contagens = {};

function contar(tabela, chave) {
  contagens[tabela] ??= { criados: 0, existentes: 0, ignorados: 0 };
  contagens[tabela][chave] += 1;
}

function exigir({ data, error }, contexto) {
  if (error) throw new Error(`${contexto}: ${error.message}`);
  return data;
}

async function enviar(arquivo, prefixo) {
  const extensao = extname(arquivo);
  const conteudo = await readFile(join(PASTA, arquivo));
  const caminho = `${prefixo}/${randomUUID()}${extensao}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(caminho, conteudo, { contentType: TIPOS[extensao], upsert: false });
  if (error) throw new Error(`envio de ${arquivo}: ${error.message}`);
  return caminho;
}

async function buscar(tabela, coluna, valor, colunas) {
  return exigir(
    await supabase.from(tabela).select(colunas).eq(coluna, valor).maybeSingle(),
    `busca em ${tabela}`,
  );
}

async function inserir(tabela, linha) {
  return exigir(await supabase.from(tabela).insert(linha).select("id").single(), `insert em ${tabela}`);
}

async function atualizar(tabela, id, campos) {
  exigir(await supabase.from(tabela).update(campos).eq("id", id).select("id").single(), `update em ${tabela}`);
}

const NOMES_FOTO = {
  "santa-helena": "foto-santa-helena.webp",
  "giselia-linhares-cimini": "foto-giselia-cimni.webp",
  "sao-geraldo": "foto-sao-geraldo.webp",
  "bela-vista": "foto-bela-vista.webp",
  "vista-linda": "foto-vista-linda.webp",
  "sao-gabriel": "foto-sao-gabriel.webp",
  "sao-sebastiao": "foto-sao-sebastiao.webp",
  bonanza: "foto-bonanza.webp",
  lourdes: "foto-lourdes.webp",
  village: "foto-village.webp",
  "villa-verde": "foto-villa-verde.webp",
};

// Ordem de proximidade de Caratinga (campo ordem = posição + 1).
const LOTEAMENTOS = [
  { nome: "Santa Helena", cidade: "Caratinga", slug: "santa-helena", banner: "banner-lot-santa-helena.webp" },
  { nome: "Gisélia Linhares Cimini", cidade: "Caratinga", slug: "giselia-linhares-cimini", banner: "banner-res-giselia-linhares-cimini.webp" },
  { nome: "São Geraldo", cidade: "Ubaporanga", slug: "sao-geraldo", banner: "banner-lot-sao-geraldo.webp" },
  { nome: "Bela Vista", cidade: "Dom Cavati", slug: "bela-vista", banner: "banner-lot-bela-vista.webp" },
  { nome: "Vista Linda", cidade: "São Domingos das Dores", slug: "vista-linda", banner: "banner-lot-vista-linda.webp" },
  { nome: "São Gabriel", cidade: "São Domingos das Dores", slug: "sao-gabriel", banner: "banner-lot-sao-gabriel.webp" },
  { nome: "São Sebastião", cidade: "Itanhomi", slug: "sao-sebastiao", banner: "banner-lot-sao-sebastiao.webp" },
  { nome: "Bonanza", cidade: "São João do Manhuaçu", slug: "bonanza", banner: "banner-res-bonanza.webp" },
  { nome: "Lourdes", cidade: "Divino", slug: "lourdes", banner: "banner-lot-lourdes.webp" },
  { nome: "Village", cidade: "Orizânia", slug: "village", banner: "banner-res-village.webp" },
  { nome: "Villa Verde", cidade: "Além Paraíba", slug: "villa-verde", banner: "banner-lot-villa-verde.webp" },
];

const BANNERS = [
  {
    sobrancelha: "Consultoria para loteamentos",
    titulo: "Seu loteamento aprovado,",
    titulo_destaque: "do projeto à entrega.",
    texto:
      "Consultoria, regularização e projetos de água e esgoto para aprovar o seu loteamento na Copasa ou na concessionária da sua cidade, com equipe própria do projeto à execução.",
    mensagem_whatsapp: "Olá! Quero conversar sobre a aprovação do meu loteamento.",
    botao_rotulo: "Conheça os serviços",
    botao_href: "#servicos",
    imagem: "foto-santa-helena.webp",
    imagem_posicao: "62% center",
    legenda: "Loteamento Santa Helena · Caratinga, MG",
  },
  {
    sobrancelha: "Projetos de engenharia",
    titulo: "Projetos com técnica,",
    titulo_destaque: "precisão e qualidade.",
    texto:
      "Soluções hidráulicas, elétricas e de saneamento para cada etapa do seu empreendimento, com foco em eficiência, segurança e resultado.",
    mensagem_whatsapp: "Olá! Preciso de um projeto hidráulico, elétrico ou de saneamento.",
    botao_rotulo: "Ver projetos realizados",
    botao_href: "#projetos-titulo",
    imagem: "hero-projetos.webp",
    imagem_posicao: "70% center",
    legenda: "Projetos hidráulicos, elétricos e de saneamento",
  },
  {
    sobrancelha: "Projetos para sua casa",
    titulo: "Do lote à casa pronta,",
    titulo_destaque: "o projeto é com a ABA.",
    texto:
      "Projetos arquitetônico, elétrico e hidrossanitário para quem vai construir, feitos pela nossa própria equipe com o mesmo cuidado técnico dos loteamentos.",
    mensagem_whatsapp: "Olá! Quero fazer o projeto da minha casa com a ABA.",
    botao_rotulo: "Projetos para sua casa",
    botao_href: "#casa-titulo",
    imagem: "hero-casas.webp",
    imagem_posicao: "40% center",
    legenda: "Arquitetônico · Elétrico · Hidrossanitário",
  },
  {
    sobrancelha: "Soluções completas",
    titulo: "Soluções completas",
    titulo_destaque: "para seu empreendimento.",
    texto:
      "Acompanhamento técnico, aprovações e projetos para cada etapa do loteamento, e lotes à venda para quem quer investir ou construir.",
    mensagem_whatsapp: "Olá! Quero conhecer as soluções da ABA para o meu empreendimento.",
    botao_rotulo: "Ver lotes à venda",
    botao_href: "#lotes-titulo",
    imagem: "hero-solucoes.webp",
    imagem_posicao: "55% center",
    legenda: "Aprovação · Projetos · Execução · Lotes",
  },
];

const SERVICOS = [
  {
    frente: "loteadores",
    slug: "consultoria-e-regularizacao",
    titulo: "Consultoria e regularização",
    subtitulo: "viabilidade, DTB e aprovação",
    resumo:
      "Estudamos o seu empreendimento e conduzimos a parte burocrática junto à concessionária, do primeiro pedido até a aprovação.",
    itens: ["Estudo de viabilidade", "DTB", "Acompanhamento da aprovação"],
    foto: NOMES_FOTO["santa-helena"],
    mensagem_whatsapp: "Olá! Quero saber mais sobre consultoria e regularização para o meu loteamento.",
  },
  {
    frente: "loteadores",
    slug: "projetos-de-agua-e-esgoto",
    titulo: "Projetos para aprovação na Copasa e concessionárias",
    subtitulo: "água e esgoto, do 2D ao 3D",
    resumo:
      "Projetos de abastecimento de água e esgotamento sanitário feitos para passar na análise da Copasa ou da concessionária da sua cidade.",
    itens: ["Projeto executivo", "Compatibilização 2D → 3D", "Modelagem 3D"],
    foto: NOMES_FOTO.village,
    mensagem_whatsapp: "Olá! Preciso de projetos de água e esgoto para aprovar meu loteamento.",
  },
  {
    frente: "loteadores",
    slug: "lista-de-materiais",
    titulo: "Lista de materiais",
    subtitulo: "elaboração, análise e compra",
    resumo: "Levantamos tudo o que a obra vai precisar, conferimos as quantidades e ajudamos você a comprar certo.",
    itens: ["Elaboração da lista", "Análise de quantitativos", "Apoio na compra"],
    foto: NOMES_FOTO.bonanza,
    mensagem_whatsapp: "Olá! Quero ajuda com a lista de materiais do meu loteamento.",
  },
  {
    frente: "loteadores",
    slug: "execucao-e-entrega",
    titulo: "Execução e entrega no padrão da concessionária",
    subtitulo: "mão de obra própria",
    resumo:
      "A mesma equipe que projeta coloca a rede de pé e entrega o loteamento dentro das exigências da concessionária.",
    itens: ["Mão de obra", "Execução das redes", "Entrega no padrão exigido"],
    foto: NOMES_FOTO["sao-geraldo"],
    mensagem_whatsapp: "Olá! Quero um orçamento para a execução das redes do meu loteamento.",
  },
  {
    frente: "casa",
    slug: "projeto-arquitetonico",
    titulo: "Projeto arquitetônico",
    resumo: "Plantas, cortes e fachadas pensados para o seu lote e para o jeito que a sua família quer morar.",
    itens: ["Planta baixa", "Cortes e fachadas", "Implantação no lote"],
    icone: "arquitetonico",
    mensagem_whatsapp: "Olá! Quero o projeto da minha casa com a ABA.",
  },
  {
    frente: "casa",
    slug: "projeto-eletrico",
    titulo: "Projeto elétrico",
    resumo:
      "Circuitos, tomadas e iluminação dimensionados com segurança, do quadro de energia ao último ponto de luz.",
    itens: ["Quadro e circuitos", "Pontos de luz e tomadas", "Dimensionamento de cargas"],
    icone: "eletrico",
    mensagem_whatsapp: "Olá! Quero o projeto da minha casa com a ABA.",
  },
  {
    frente: "casa",
    slug: "projeto-hidrossanitario",
    titulo: "Projeto hidrossanitário",
    resumo: "Água e esgoto da sua casa com a mesma especialidade que aplicamos nas redes dos loteamentos.",
    itens: ["Água fria", "Esgoto sanitário", "Caixas e ligações"],
    icone: "hidrossanitario",
    mensagem_whatsapp: "Olá! Quero o projeto da minha casa com a ABA.",
  },
];

const DEPOIMENTOS = [
  {
    nome: "Daniel M.",
    texto:
      'Empreendedor, precisa resolver parte burocrática com a Copasa de forma rápida e sem dor de cabeça, chama a ABA que o pessoal é "baum de serviço".',
    origem: "google",
    nota: 5,
    quando: "há 1 ano",
  },
  { nome: "Valdemiro V.", texto: "Empresa séria e competente, tem nos ajudado muito junto a Copasa.", origem: "cliente" },
  {
    nome: "Kaio G.",
    texto:
      "Ótimo trabalho do pessoal da Aba, estão de parabéns. Fazem um trabalho completo, total acompanhamento, passam segurança no trabalho. Incrível",
    origem: "google",
    nota: 5,
    quando: "há 1 ano",
  },
  {
    nome: "Cliente A.",
    texto: "A ABA Consultoria é uma parceira de confiança, sempre dedicada e profissional. Recomendo de coração!",
    origem: "cliente",
  },
  { nome: "Tadeu C.", texto: "Equipe ágil, eficiente e altamente capacitada.", origem: "cliente" },
  {
    nome: "Marcos V.",
    texto: "Obrigado pela parceria, parabéns pelo trabalho. Indico.",
    origem: "google",
    nota: 5,
    quando: "há 1 ano",
  },
  { nome: "Clinger C.", texto: "Recomendo pela competência e entrega com eficiência.", origem: "cliente" },
  { nome: "Guilherme Q.", texto: "Serviço de consultoria de qualidade!", origem: "cliente" },
];

const PARCEIROS = [
  { nome: "Copasa", logo: "parceiros/copasa.webp" },
  { nome: "Trieiras Empreendimentos Urbanos", logo: "parceiros/trieiras.webp" },
  { nome: "Elétrica MG", logo: "parceiros/eletrica-mg.webp" },
  { nome: "Bela Vista Residencial", logo: "parceiros/bela-vista.webp" },
  { nome: "Cimini", logo: "parceiros/cimini.webp" },
  { nome: "Flex", logo: "parceiros/flex.webp" },
  { nome: "Ampla", logo: "parceiros/ampla.webp" },
];

const VIDEOS = ["video-4304.mp4", "video-4306.mp4", "video-4308.mp4", "video-4309.mp4", "video-4314.mp4"];

const CONFIGURACOES = {
  whatsapp: "5533999439454",
  instagram_url: "https://www.instagram.com/abaconsultorias/",
  instagram_usuario: "abaconsultorias",
  google_avaliacoes_url: "https://g.page/r/CYWP0qT3TsuEEAE",
  google_avaliar_url: "https://g.page/r/CYWP0qT3TsuEEAE/review",
  google_nota: 5.0,
  google_total: 35,
  sobre_titulo: "Quem projeta também executa.",
  sobre_texto:
    "A ABA Consultoria faz consultoria, regularização e projetos de infraestrutura de água e esgoto para loteamentos, e também os projetos de quem vai construir a própria casa.\n\n" +
    "Com equipe própria do projeto à execução, acompanhamos cada etapa de perto, sem repassar o seu empreendimento de mão em mão.",
};

async function semearConfiguracoes() {
  const linha = exigir(
    await supabase.from("configuracoes_site").select("*").limit(1).maybeSingle(),
    "busca em configuracoes_site",
  );
  if (!linha) throw new Error("configuracoes_site não tem a linha única (migration da Etapa 2 não aplicada?).");

  const campos = Object.fromEntries(Object.entries(CONFIGURACOES).filter(([coluna]) => linha[coluna] === null));
  if (Object.keys(campos).length === 0) return contar("configuracoes_site", "existentes");
  await atualizar("configuracoes_site", linha.id, campos);
  contar("configuracoes_site", "criados");
}

async function semearBanners() {
  for (const [indice, { imagem, ...banner }] of BANNERS.entries()) {
    const existente = await buscar("banners_hero", "titulo", banner.titulo, "id");
    if (existente) {
      contar("banners_hero", "existentes");
      continue;
    }
    const imagem_path = await enviar(imagem, "hero");
    await inserir("banners_hero", { ...banner, imagem_path, ordem: indice + 1, publicado: true });
    contar("banners_hero", "criados");
  }
}

async function semearServicos() {
  const ordemPorFrente = { loteadores: 0, casa: 0 };
  for (const { foto, ...servico } of SERVICOS) {
    ordemPorFrente[servico.frente] += 1;
    const existente = await buscar("servicos", "slug", servico.slug, "id, foto_path");
    if (existente) {
      contar("servicos", "existentes");
      if (foto && !existente.foto_path) {
        await atualizar("servicos", existente.id, { foto_path: await enviar(foto, "servicos") });
      }
      continue;
    }
    await inserir("servicos", {
      ...servico,
      foto_path: foto ? await enviar(foto, "servicos") : null,
      ordem: ordemPorFrente[servico.frente],
      publicado: true,
    });
    contar("servicos", "criados");
  }
}

// Loteamentos e projetos guardam os arquivos na pasta do próprio id, então a
// linha nasce sem caminho e recebe os arquivos depois.
async function garantirComArquivos(tabela, prefixo, chave, linha, arquivos) {
  let registro = await buscar(tabela, "slug", chave, `id, ${Object.keys(arquivos).join(", ")}`);
  if (registro) {
    contar(tabela, "existentes");
  } else {
    registro = { ...(await inserir(tabela, linha)), ...Object.fromEntries(Object.keys(arquivos).map((c) => [c, null])) };
    contar(tabela, "criados");
  }

  const faltando = {};
  for (const [coluna, arquivo] of Object.entries(arquivos)) {
    if (registro[coluna]) continue;
    faltando[coluna] = await enviar(arquivo, `${prefixo}/${registro.id}`);
  }
  if (Object.keys(faltando).length > 0) await atualizar(tabela, registro.id, faltando);
}

async function semearLoteamentosEProjetos() {
  for (const [indice, { banner, ...loteamento }] of LOTEAMENTOS.entries()) {
    const foto = NOMES_FOTO[loteamento.slug];
    await garantirComArquivos(
      "loteamentos",
      "loteamentos",
      loteamento.slug,
      { ...loteamento, ordem: indice + 1, publicado: true },
      { capa_path: foto, banner_path: banner },
    );
    await garantirComArquivos(
      "portfolio_projetos",
      "portfolio",
      loteamento.slug,
      {
        titulo: loteamento.nome,
        slug: loteamento.slug,
        cidade: loteamento.cidade,
        categoria: "loteamento",
        descricao: "Infraestrutura de água e esgoto",
        ordem: indice + 1,
        publicado: true,
      },
      { capa_path: foto },
    );
  }
}

async function semearDepoimentos() {
  for (const [indice, depoimento] of DEPOIMENTOS.entries()) {
    if (await buscar("depoimentos", "nome", depoimento.nome, "id")) {
      contar("depoimentos", "existentes");
      continue;
    }
    await inserir("depoimentos", { ...depoimento, ordem: indice + 1, publicado: true });
    contar("depoimentos", "criados");
  }
}

async function semearParceiros() {
  for (const [indice, { nome, logo }] of PARCEIROS.entries()) {
    if (await buscar("parceiros", "nome", nome, "id")) {
      contar("parceiros", "existentes");
      continue;
    }
    const logo_path = await enviar(logo, "parceiros");
    await inserir("parceiros", { nome, logo_path, ordem: indice + 1, publicado: true });
    contar("parceiros", "criados");
  }
}

// Os .mp4 são git-ignored: só existem na máquina de quem roda o script.
async function semearVideos() {
  for (const [indice, arquivo] of VIDEOS.entries()) {
    const legenda = `Vídeo ${indice + 1} da equipe ABA`;
    if (await buscar("videos_instagram", "legenda", legenda, "id")) {
      contar("videos_instagram", "existentes");
      continue;
    }
    if (!existsSync(join(PASTA, arquivo))) {
      contar("videos_instagram", "ignorados");
      continue;
    }
    const video_path = await enviar(arquivo, "instagram");
    await inserir("videos_instagram", { video_path, legenda, ordem: indice + 1, publicado: true });
    contar("videos_instagram", "criados");
  }
}

await semearConfiguracoes();
await semearBanners();
await semearServicos();
await semearLoteamentosEProjetos();
await semearDepoimentos();
await semearParceiros();
await semearVideos();

for (const [tabela, { criados, existentes, ignorados }] of Object.entries(contagens)) {
  const aviso = ignorados > 0 ? `, ${ignorados} ignorado(s) por falta do arquivo` : "";
  console.log(`${tabela}: ${criados} criado(s), ${existentes} já existia(m)${aviso}`);
}
