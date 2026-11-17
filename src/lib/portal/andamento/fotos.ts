export const LIMITE_FOTO = 10485760;
export const EXTENSOES_FOTO = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" } as const;
export type MimeFoto = keyof typeof EXTENSOES_FOTO;
export class FotoInvalida extends Error {}

export function validarBytesFoto(bytes: Uint8Array, mime: MimeFoto): boolean {
  const b = Buffer.from(bytes);
  // Fotos de celular podem ter dados após o EOI (ex.: foto em movimento), então basta existir um EOI.
  if (mime === "image/jpeg") return b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b.indexOf(Buffer.from([0xff, 0xd9]), 3) >= 0;
  if (mime === "image/png") return b.length >= 33 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && b.toString("ascii", 12, 16) === "IHDR" && b.readUInt32BE(8) === 13;
  if (mime === "image/webp") return b.length >= 20 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(b.toString("ascii", 12, 16)) && b.readUInt32LE(4) + 8 === b.length;
  if (b.length < 24 || b.toString("ascii", 4, 8) !== "ftyp") return false;
  const fim = b.readUInt32BE(0);
  if (fim < 20 || fim > b.length || fim % 4 !== 0) return false;
  const marcas = [b.toString("ascii", 8, 12)];
  for (let i = 16; i < fim; i += 4) marcas.push(b.toString("ascii", i, i + 4));
  const hevc = ["heic", "heix", "hevc", "hevx"];
  return mime === "image/heic" ? marcas.some((m) => hevc.includes(m)) : marcas.some((m) => ["mif1", "msf1"].includes(m)) && marcas.some((m) => [...hevc, "heim", "heis", "hevm", "hevs"].includes(m));
}

export async function lerFotoLimitada(stream: ReadableStream<Uint8Array>, tamanho: number): Promise<Uint8Array> {
  const leitor = stream.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.byteLength;
      if (total > LIMITE_FOTO || total > tamanho) { await leitor.cancel(); throw new FotoInvalida("Tamanho de foto inválido."); }
      partes.push(value);
    }
  } finally { leitor.releaseLock(); }
  if (total !== tamanho || total === 0) throw new FotoInvalida("Tamanho de foto inválido.");
  return Buffer.concat(partes, total);
}
