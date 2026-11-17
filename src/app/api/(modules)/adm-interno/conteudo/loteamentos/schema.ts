import z from "zod";

export const idSchema = z.object({ id: z.uuid("ID inválido.") });
export const idMidiaSchema = z.object({
  id: z.uuid("ID inválido."),
  midiaId: z.uuid("ID inválido."),
});

const FORMATO_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CAMINHO_IMAGEM = new RegExp(`^loteamentos/${UUID}/${UUID}\\.(?:jpg|png|webp)$`);
const CAMINHO_VIDEO = new RegExp(`^loteamentos/${UUID}/${UUID}\\.mp4$`);
const CAMINHO_MAPA = new RegExp(`^loteamentos/${UUID}/${UUID}\\.svg$`);

// Texto opcional: vazio vira null (apaga o campo); ausente não mexe no valor.
function textoOpcional(max: number, mensagem: string) {
  return z
    .string(mensagem)
    .trim()
    .max(max, mensagem)
    .transform((valor) => (valor === "" ? null : valor))
    .nullable()
    .optional();
}

const linkOpcional = z
  .string("Link inválido.")
  .trim()
  .max(500, "Link muito longo.")
  .transform((valor) => (valor === "" ? null : valor))
  .refine((valor) => valor === null || /^https:\/\/\S+$/.test(valor), "Use um link que comece com https://")
  .nullable()
  .optional();

function caminho(formato: RegExp) {
  return z.string("Arquivo inválido.").regex(formato, "Arquivo inválido.").nullable().optional();
}

const camposDoLoteamento = {
  nome: z.string("Informe o nome.").trim().min(2, "Informe o nome.").max(120, "Nome muito longo."),
  slug: z
    .string("Informe o endereço da página.")
    .trim()
    .min(2, "Endereço da página muito curto.")
    .max(80, "Endereço da página muito longo.")
    .regex(FORMATO_SLUG, "Use só letras minúsculas, números e hífen."),
  cidade: textoOpcional(120, "Cidade inválida."),
  endereco: textoOpcional(255, "Endereço inválido."),
  mapsUrl: linkOpcional,
  descricao: textoOpcional(5000, "Descrição muito longa."),
  publicado: z.boolean("Valor inválido."),
};

export const criarLoteamentoSchema = z.object(camposDoLoteamento);
export type CriarLoteamentoInput = z.infer<typeof criarLoteamentoSchema>;

export const atualizarLoteamentoSchema = z
  .object({
    ...camposDoLoteamento,
    capaPath: caminho(CAMINHO_IMAGEM),
    bannerPath: caminho(CAMINHO_IMAGEM),
    bannerMobilePath: caminho(CAMINHO_IMAGEM),
    mapaSvgPath: caminho(CAMINHO_MAPA),
  })
  .partial()
  .refine((valor) => Object.keys(valor).length > 0, "Nada para atualizar.");
export type AtualizarLoteamentoInput = z.infer<typeof atualizarLoteamentoSchema>;

export const ordenarSchema = z.object({
  ids: z.array(z.uuid("ID inválido.")).min(1, "Lista vazia.").max(500, "Lista grande demais."),
});
export type OrdenarInput = z.infer<typeof ordenarSchema>;

export const adicionarMidiaSchema = z
  .object({
    tipo: z.enum(["foto", "video"], "Tipo inválido."),
    path: z.string("Arquivo inválido.").max(200, "Arquivo inválido."),
    legenda: textoOpcional(200, "Legenda muito longa."),
  })
  .refine(
    (valor) => (valor.tipo === "foto" ? CAMINHO_IMAGEM : CAMINHO_VIDEO).test(valor.path),
    { message: "Arquivo inválido.", path: ["path"] },
  );
export type AdicionarMidiaInput = z.infer<typeof adicionarMidiaSchema>;

export const atualizarMidiaSchema = z.object({
  legenda: textoOpcional(200, "Legenda muito longa."),
});
export type AtualizarMidiaInput = z.infer<typeof atualizarMidiaSchema>;
