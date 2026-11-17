# Troca a chave de servidor sem reinstalar. Rode como administrador depois de emitir
# uma chave nova no painel do site. Compativel com Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comum.ps1')

Exigir-Administrador

$tarefa = Get-ScheduledTask -TaskName $script:NomeTarefa -ErrorAction SilentlyContinue
if (-not $tarefa) { throw "A tarefa '$($script:NomeTarefa)' nao existe. Rode o instalar.ps1." }

$conta = Resolver-Conta $tarefa.Principal.UserId
Write-Host "Conta do conector: $($conta.Nome)"

$senhaSegura = Read-Host "Senha da conta $($conta.Nome) (nao aparece na tela)" -AsSecureString
$chave = Ler-ChaveServidor
$senha = Converter-ParaTexto $senhaSegura

Gravar-ChaveProtegida -Conta $conta -SenhaConta $senha -ChaveTexto $chave
$chave = $null
$senha = $null

Write-Host 'Chave trocada. O proximo ciclo (em ate 10 minutos) ja usa a chave nova.' -ForegroundColor Green
Write-Host 'Lembre: emitir uma chave nova no painel ja revogou a anterior.'
