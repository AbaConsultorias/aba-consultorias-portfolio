# Desliga o Conector ABA: remove a tarefa agendada e o arquivo da chave. Mantem os logs.
# Rode como administrador. Compativel com Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comum.ps1')

Exigir-Administrador

foreach ($nome in @($script:NomeTarefa, $script:NomeTarefaTemporaria)) {
    if (Get-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $nome -Confirm:$false
        Write-Host "Tarefa '$nome' removida."
    }
}

if (Test-Path -LiteralPath $script:PastaSegredo) {
    Remove-Item -LiteralPath $script:PastaSegredo -Recurse -Force
    Write-Host 'Arquivo da chave removido.'
}

Write-Host ''
Write-Host "Os logs continuam em $($script:PastaLogs)." -ForegroundColor Green
Write-Host "O programa, a configuracao e o estado continuam em $($script:PastaBase); apague a pasta se quiser tirar tudo."
Write-Host 'Para o site, o conector so deixa de dar sinal; revogue a chave no painel do admin.'
