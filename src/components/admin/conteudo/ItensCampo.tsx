"use client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
export function ItensCampo({ value, onChange }: {
    value: string[];
    onChange: (value: string[]) => void;
}) {
    return <div className="space-y-2">{value.map((item, i) => <div key={i} className="flex flex-wrap gap-2"><Input className="min-w-0 flex-1 basis-40" aria-label={`Item ${i + 1}`} value={item} onChange={e => onChange(value.map((v, j) => j === i ? e.target.value : v))}/><Button type="button" variant="outline" onClick={() => onChange(value.filter((_, j) => i !== j))}>Remover item {i + 1}</Button></div>)}<Button type="button" variant="outline" onClick={() => onChange([...value, ""])}>Adicionar item</Button></div>;
}
