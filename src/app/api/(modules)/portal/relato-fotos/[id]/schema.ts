import z from 'zod';
export const consultaSchema = z.object({id:z.uuid()});
