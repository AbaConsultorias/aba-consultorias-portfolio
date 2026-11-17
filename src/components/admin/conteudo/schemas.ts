import { criarSchema as banners } from "@/app/api/(modules)/adm-interno/conteudo/banners/schema";
import { criarSchema as servicos } from "@/app/api/(modules)/adm-interno/conteudo/servicos/schema";
import { criarSchema as projetos } from "@/app/api/(modules)/adm-interno/conteudo/projetos/schema";
import { criarSchema as midias } from "@/app/api/(modules)/adm-interno/conteudo/midias-projeto/schema";
import { criarSchema as depoimentos } from "@/app/api/(modules)/adm-interno/conteudo/depoimentos/schema";
import { criarSchema as parceiros } from "@/app/api/(modules)/adm-interno/conteudo/parceiros/schema";
import { criarSchema as videos } from "@/app/api/(modules)/adm-interno/conteudo/videos/schema";
import { criarSchema as configuracoes } from "@/app/api/(modules)/adm-interno/conteudo/configuracoes/schema";
export const schemas = {
    banners, servicos, projetos, "midias-projeto": midias, depoimentos, parceiros, videos, configuracoes
};
export type NomeRecurso = keyof typeof schemas;
