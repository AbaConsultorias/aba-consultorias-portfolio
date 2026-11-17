# Roda COMO A CONTA DEDICADA (chamado por uma tarefa agendada temporaria do instalar.ps1 ou do
# trocar-chave.ps1). Le a chave de um pipe nomeado e a grava cifrada com DPAPI da propria conta.
param(
    [Parameter(Mandatory)][string]$Pipe,
    [Parameter(Mandatory)][string]$Saida
)

$ErrorActionPreference = 'Stop'

$cliente = New-Object System.IO.Pipes.NamedPipeClientStream('.', $Pipe, [System.IO.Pipes.PipeDirection]::In)
try {
    $cliente.Connect(30000)
    $leitor = New-Object System.IO.StreamReader($cliente, [Text.Encoding]::UTF8)
    $texto = $leitor.ReadToEnd().Trim()
} finally {
    $cliente.Dispose()
}

if ($texto -notmatch '^abacon_[A-Za-z0-9_-]{43}$') { throw 'A chave recebida nao tem o formato esperado.' }

$segura = ConvertTo-SecureString -String $texto -AsPlainText -Force
$cifrada = ConvertFrom-SecureString -SecureString $segura

$pasta = Split-Path -Parent $Saida
if (-not (Test-Path -LiteralPath $pasta)) { throw 'A pasta de destino da chave nao existe.' }
$novo = "$Saida.novo"
Set-Content -LiteralPath $novo -Value $cifrada -Encoding ASCII
Move-Item -LiteralPath $novo -Destination $Saida -Force
