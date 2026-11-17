import z from "zod";

// O corpo é "{}": nada nele muda o resultado, e campo desconhecido é recusado.
export const confirmarSchema = z.strictObject({});

export const envioIdSchema = z.uuid("envio_id inválido.");

export type ConfirmarInput = z.infer<typeof confirmarSchema>;
