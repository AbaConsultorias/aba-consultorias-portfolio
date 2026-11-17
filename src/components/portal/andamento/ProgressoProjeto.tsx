export function ProgressoProjeto({ nome, progresso }: { nome: string; progresso: number }) {
  return (
    <div className="portal-progresso" role="progressbar" aria-label={`Andamento de ${nome}`}
      aria-valuenow={progresso} aria-valuemin={0} aria-valuemax={100}>
      <span className="portal-progresso-preenchimento" style={{ transform: `scaleX(${progresso / 100})` }} />
    </div>
  );
}
