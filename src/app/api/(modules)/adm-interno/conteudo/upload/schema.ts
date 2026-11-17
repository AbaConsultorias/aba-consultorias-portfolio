import z from "zod";

export const DESTINOS = [
  "servicos",
  "hero",
  "parceiros",
  "instagram",
  "portfolio",
  "loteamentos",
] as const;

const DESTINOS_COM_DONO: readonly string[] = ["portfolio", "loteamentos"];

export const EXTENSAO_POR_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
} as const;

type Mime = keyof typeof EXTENSAO_POR_MIME;

const MIMES_POR_TIPO: Record<"imagem" | "video", readonly Mime[]> = {
  imagem: ["image/jpeg", "image/png", "image/webp"],
  video: ["video/mp4"],
};

export const assinarSchema = z
  .object({
    destino: z.enum(DESTINOS, "Destino inválido."),
    donoId: z.uuid("ID inválido.").optional(),
    tipo: z.enum(["imagem", "video"], "Tipo de arquivo inválido."),
    tamanho: z.number("Tamanho inválido.").int("Tamanho inválido.").positive("O arquivo está vazio."),
    mime: z.enum(Object.keys(EXTENSAO_POR_MIME) as [Mime, ...Mime[]], "Envie JPEG, PNG, WebP ou MP4."),
  })
  .superRefine((valor, contexto) => {
    const precisaDono = DESTINOS_COM_DONO.includes(valor.destino);

    if (precisaDono && !valor.donoId) {
      contexto.addIssue({ code: "custom", path: ["donoId"], message: "Informe o registro dono do arquivo." });
    }
    if (!precisaDono && valor.donoId) {
      contexto.addIssue({ code: "custom", path: ["donoId"], message: "Este destino não usa donoId." });
    }
    if (!MIMES_POR_TIPO[valor.tipo].includes(valor.mime)) {
      contexto.addIssue({
        code: "custom",
        path: ["mime"],
        message: valor.tipo === "imagem" ? "Envie uma imagem JPEG, PNG ou WebP." : "Envie um vídeo MP4.",
      });
    }
  });

export type AssinarInput = z.infer<typeof assinarSchema>;

// Mapa SVG é o único envio que passa pela rota (precisa ser sanitizado antes
// de gravar); imagens e vídeos vão direto ao storage pela URL assinada.
export const mapaSchema = z.object({
  destino: z.literal("loteamentos", "Mapa só vale para loteamentos."),
  donoId: z.uuid("ID inválido."),
  tipo: z.literal("mapa", "Imagens e vídeos são enviados pela URL assinada."),
});

export type MapaInput = z.infer<typeof mapaSchema>;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function caminhoDoContrato(extensoes: string) {
  return new RegExp(
    `^(?:(?:servicos|hero|parceiros|instagram)/${UUID}\\.${extensoes}|(?:loteamentos|portfolio)/${UUID}/${UUID}\\.${extensoes})$`,
  );
}

const caminho = (extensoes: string) =>
  z.string("Caminho inválido.").max(200, "Caminho inválido.").regex(caminhoDoContrato(extensoes), "Caminho inválido.");

export const confirmarSchema = z.object({ path: caminho("(?:jpg|png|webp|mp4)") });

export type ConfirmarInput = z.infer<typeof confirmarSchema>;

export const apagarArquivoSchema = z.object({ path: caminho("(?:jpg|png|webp|svg|mp4)") });

export type ApagarArquivoInput = z.infer<typeof apagarArquivoSchema>;
