import { WHATSAPP_URL } from "@/components/site/nav-links";
import type { Configuracoes } from "@/lib/conteudo/tipos";

export function linkWhatsApp(mensagem?: string | null, whatsapp?: Configuracoes["whatsapp"]) {
  const digitos = whatsapp?.replace(/\D/g, "");
  const url = digitos ? `https://wa.me/${digitos}` : WHATSAPP_URL;
  return mensagem ? `${url}?text=${encodeURIComponent(mensagem)}` : url;
}

export const DISCIPLINAS = [
  "Consultoria",
  "Regularização",
  "Projetos de água e esgoto",
  "Projetos de casas",
] as const;

export const PASSOS = [
  {
    titulo: "Fale com a equipe pelo WhatsApp",
    texto: "Conte sobre o seu loteamento ou a sua obra. A conversa é direta com quem vai cuidar do seu projeto.",
  },
  {
    titulo: "Entendemos seu loteamento ou sua obra",
    texto: "Avaliamos o terreno, as exigências da concessionária ou da prefeitura e tudo o que precisa ser feito.",
  },
  {
    titulo: "Proposta e cronograma",
    texto: "Você recebe a proposta com as etapas do trabalho e o prazo de cada uma, sem surpresas no caminho.",
  },
] as const;

