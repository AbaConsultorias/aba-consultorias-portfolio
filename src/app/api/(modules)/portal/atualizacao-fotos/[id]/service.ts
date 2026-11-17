import 'server-only';
import { entregarArquivoPrivado } from '@/lib/portal/comum/arquivos';
export function obter(request:Request,id:string){ return entregarArquivoPrivado(request,'atualizacao_foto',id); }
