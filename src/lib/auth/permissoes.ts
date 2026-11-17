export const PERMISSOES = [
  "site.ver",
  "site.editar",
  "contatos.ver",
  "contatos.editar",
  "empreendimentos.ver",
  "empreendimentos.editar",
  "empreendimentos.excluir",
  "clientes.ver",
  "clientes.editar",
  "atualizacoes.ver",
  "atualizacoes.editar",
  "documentos.ver",
  "documentos.editar",
  "documentos.liberar",
  "financeiro.ver",
  "financeiro.editar",
  "obras.ver",
  "obras.editar",
  "obras.aprovar",
  "fornecedores.ver",
  "fornecedores.editar",
  "fornecedores.excluir",
  "servidor.regras",
  "painel.servidor",
] as const;

export type Permissao = (typeof PERMISSOES)[number];

const CATALOGO: ReadonlySet<string> = new Set(PERMISSOES);

export function ehPermissao(valor: unknown): valor is Permissao {
  return typeof valor === "string" && CATALOGO.has(valor);
}

export const PREREQUISITOS: Partial<Record<Permissao, readonly Permissao[]>> = {
  "site.editar": ["site.ver"],
  "contatos.editar": ["contatos.ver"],
  "empreendimentos.editar": ["empreendimentos.ver"],
  "empreendimentos.excluir": ["empreendimentos.editar"],
  "clientes.editar": ["clientes.ver"],
  "atualizacoes.editar": ["atualizacoes.ver"],
  "documentos.editar": ["documentos.ver"],
  "documentos.liberar": ["documentos.ver"],
  "financeiro.editar": ["financeiro.ver"],
  "obras.editar": ["obras.ver"],
  "obras.aprovar": ["obras.ver"],
  "fornecedores.editar": ["fornecedores.ver"],
  "fornecedores.excluir": ["fornecedores.editar"],
  "servidor.regras": ["empreendimentos.ver"],
};

// Cada permissão vem depois dos seus pré-requisitos, na ordem em que o banco exige para gravar uma a uma.
export function comPrerequisitos(lista: readonly Permissao[]): Permissao[] {
  const resultado = new Set<Permissao>();
  const incluir = (permissao: Permissao) => {
    if (resultado.has(permissao)) return;
    for (const prerequisito of PREREQUISITOS[permissao] ?? []) incluir(prerequisito);
    resultado.add(permissao);
  };
  for (const permissao of lista) incluir(permissao);
  return [...resultado];
}

export type PermissaoDaArea = {
  permissao: Permissao;
  rotulo: string;
};

export type Area = {
  id: string;
  rotulo: string;
  permissoes: readonly PermissaoDaArea[];
};

export const AREAS: readonly Area[] = [
  {
    id: "site",
    rotulo: "Conteúdo do site",
    permissoes: [
      { permissao: "site.ver", rotulo: "Ver" },
      { permissao: "site.editar", rotulo: "Editar" },
    ],
  },
  {
    id: "contatos",
    rotulo: "Mensagens do formulário",
    permissoes: [
      { permissao: "contatos.ver", rotulo: "Ver" },
      { permissao: "contatos.editar", rotulo: "Marcar como lida" },
    ],
  },
  {
    id: "empreendimentos",
    rotulo: "Empreendimentos",
    permissoes: [
      { permissao: "empreendimentos.ver", rotulo: "Ver" },
      { permissao: "empreendimentos.editar", rotulo: "Editar" },
      { permissao: "empreendimentos.excluir", rotulo: "Excluir" },
    ],
  },
  {
    id: "clientes",
    rotulo: "Clientes",
    permissoes: [
      { permissao: "clientes.ver", rotulo: "Ver" },
      { permissao: "clientes.editar", rotulo: "Editar e criar conta" },
    ],
  },
  {
    id: "atualizacoes",
    rotulo: "Atualizações para o cliente",
    permissoes: [
      { permissao: "atualizacoes.ver", rotulo: "Ver" },
      { permissao: "atualizacoes.editar", rotulo: "Publicar" },
    ],
  },
  {
    id: "documentos",
    rotulo: "Documentos",
    permissoes: [
      { permissao: "documentos.ver", rotulo: "Ver" },
      { permissao: "documentos.editar", rotulo: "Enviar, editar e excluir" },
      { permissao: "documentos.liberar", rotulo: "Liberar para o cliente" },
    ],
  },
  {
    id: "financeiro",
    rotulo: "Financeiro",
    permissoes: [
      { permissao: "financeiro.ver", rotulo: "Ver" },
      { permissao: "financeiro.editar", rotulo: "Editar" },
    ],
  },
  {
    id: "obras",
    rotulo: "Obras",
    permissoes: [
      { permissao: "obras.ver", rotulo: "Ver" },
      { permissao: "obras.editar", rotulo: "Editar e criar conta de empreiteiro" },
      { permissao: "obras.aprovar", rotulo: "Aprovar ou devolver relatos" },
    ],
  },
  {
    id: "fornecedores",
    rotulo: "Fornecedores",
    permissoes: [
      { permissao: "fornecedores.ver", rotulo: "Ver" },
      { permissao: "fornecedores.editar", rotulo: "Editar e criar conta" },
      { permissao: "fornecedores.excluir", rotulo: "Excluir fornecedor e contrato" },
    ],
  },
  {
    id: "servidor",
    rotulo: "Servidor",
    permissoes: [
      { permissao: "servidor.regras", rotulo: "Pasta e regras do servidor" },
      { permissao: "painel.servidor", rotulo: "Ver o painel do servidor" },
    ],
  },
];

export type Modelo = {
  id: string;
  rotulo: string;
  permissoes: readonly Permissao[];
};

export const MODELOS: readonly Modelo[] = [
  {
    id: "financeiro",
    rotulo: "Financeiro",
    permissoes: ["financeiro.ver", "financeiro.editar", "empreendimentos.ver"],
  },
  {
    id: "site",
    rotulo: "Site",
    permissoes: ["site.ver", "site.editar", "contatos.ver", "contatos.editar"],
  },
  {
    id: "campo",
    rotulo: "Campo",
    permissoes: ["obras.ver", "empreendimentos.ver", "atualizacoes.ver", "atualizacoes.editar"],
  },
  {
    id: "atendimento",
    rotulo: "Atendimento",
    permissoes: ["clientes.ver", "clientes.editar", "documentos.ver", "documentos.liberar"],
  },
];
