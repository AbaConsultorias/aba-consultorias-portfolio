import z from "zod";
import { BadRequestError } from "../HttpErrors";

// Mensagens padrão do Zod em português (as dos schemas continuam valendo).
z.config(z.locales.ptBR());

type Validation<T> = {
  data: unknown;
  schema: z.ZodType<T>;
};

export const validation = <T>({ data, schema }: Validation<T>) => {
  const result = schema.safeParse(data);
  if (!result.success) {
    const tree = z.treeifyError(result.error);
    const details = "properties" in tree ? tree.properties : tree;

    throw new BadRequestError(details);
  }

  return result.data;
};
