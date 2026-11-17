# Chamado pela tarefa agendada 'ABA Conector' (como a conta dedicada). Decifra a chave com DPAPI
# da propria conta e a entrega ao node.exe so como variavel de ambiente daquele processo.
# Compativel com Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'

$programa = Split-Path -Parent $PSScriptRoot
$base = Split-Path -Parent $programa
$arquivoChave = Join-Path $base 'segredo\chave.dpapi'
$config = Join-Path $base 'config.json'
$node = Join-Path $programa 'node.exe'
$principal = Join-Path $programa 'src\principal.mjs'
$logFalhas = Join-Path $base 'logs\executar.log'

function Registrar-Falha([string]$Mensagem) {
    try {
        Add-Content -LiteralPath $logFalhas -Value ('{0} {1}' -f (Get-Date -Format 's'), $Mensagem)
    } catch {
        # sem pasta de logs a falha so aparece no codigo de saida da tarefa
    }
    [Console]::Error.WriteLine($Mensagem)
}

if (-not (Test-Path -LiteralPath $arquivoChave)) {
    Registrar-Falha 'Arquivo da chave nao encontrado: rode o instalar.ps1 ou o trocar-chave.ps1.'
    exit 2
}

$chave = $null
try {
    $cifrada = (Get-Content -LiteralPath $arquivoChave -Raw).Trim()
    $segura = ConvertTo-SecureString -String $cifrada
    $ponteiro = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
    try {
        $chave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ponteiro)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ponteiro)
    }
} catch {
    Registrar-Falha 'Nao foi possivel decifrar a chave. Ela so abre na conta dedicada que a gravou; use o trocar-chave.ps1.'
    exit 2
}

$info = New-Object System.Diagnostics.ProcessStartInfo
$info.FileName = $node
$info.Arguments = '"{0}" --config "{1}"' -f $principal, $config
$info.WorkingDirectory = $programa
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.EnvironmentVariables['ABA_CONECTOR_CHAVE'] = $chave
$chave = $null

$processo = [System.Diagnostics.Process]::Start($info)
$processo.WaitForExit()
exit $processo.ExitCode
