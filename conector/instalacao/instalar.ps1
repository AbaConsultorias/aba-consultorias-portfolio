# Instala (ou atualiza) o Conector ABA 2.0 neste servidor. Rode como administrador.
# Compativel com Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comum.ps1')

Exigir-Administrador

Write-Host ''
Write-Host '=== Instalacao do Conector ABA 2.0 ===' -ForegroundColor Cyan

$origem = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $origem 'node.exe')) -or -not (Test-Path -LiteralPath (Join-Path $origem 'src\principal.mjs'))) {
    throw 'Esta pasta nao e o pacote pronto (falta o node.exe). Use a pasta "dist" gerada pelo empacotar.ps1.'
}

$url = Read-Host "Endereco do site [$($script:UrlPadrao)]"
if ([string]::IsNullOrWhiteSpace($url)) { $url = $script:UrlPadrao }
$url = $url.Trim().TrimEnd('/')
if ($url -notmatch '^https://[^\s/]+') { throw 'O endereco do site precisa comecar com https://' }

$nomeConta = Read-Host "Conta do Windows dedicada ao conector [$($script:ContaPadrao)]"
if ([string]::IsNullOrWhiteSpace($nomeConta)) { $nomeConta = $script:ContaPadrao }
$conta = Resolver-Conta $nomeConta.Trim()
Write-Host "Conta encontrada: $($conta.Nome)"

$senhaSegura = Read-Host "Senha da conta $($conta.Nome) (nao aparece na tela)" -AsSecureString
$chave = Ler-ChaveServidor
$senha = Converter-ParaTexto $senhaSegura

if (Get-ScheduledTask -TaskName $script:NomeTarefa -ErrorAction SilentlyContinue) {
    Write-Host 'Ja existe uma instalacao: parando a tarefa para atualizar.'
    Stop-ScheduledTask -TaskName $script:NomeTarefa -ErrorAction SilentlyContinue
}

Write-Host "Criando as pastas em $($script:PastaBase)"
New-Item -ItemType Directory -Force -Path $script:PastaBase, $script:PastaEstado, $script:PastaLogs, $script:PastaSegredo | Out-Null

Write-Host 'Copiando o programa'
if (Test-Path -LiteralPath $script:PastaPrograma) { Remove-Item -LiteralPath $script:PastaPrograma -Recurse -Force }
New-Item -ItemType Directory -Force -Path $script:PastaPrograma | Out-Null
Copy-Item -Path (Join-Path $origem '*') -Destination $script:PastaPrograma -Recurse -Force

Write-Host 'Gravando a configuracao'
$config = [ordered]@{
    urlSite     = $url
    raiz        = $script:RaizFixa
    pastaEstado = $script:PastaEstado
    pastaLogs   = $script:PastaLogs
}
[System.IO.File]::WriteAllText($script:ArquivoConfig, ($config | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))

Write-Host 'Restringindo as permissoes (so a conta dedicada, Administradores e o sistema)'
Aplicar-AclConector -SidConta $conta.Sid

Write-Host 'Gravando a chave cifrada no contexto da conta (pode levar um minuto)'
Gravar-ChaveProtegida -Conta $conta -SenhaConta $senha -ChaveTexto $chave

Write-Host "Registrando a tarefa agendada '$($script:NomeTarefa)'"
Registrar-TarefaConector -Conta $conta -SenhaConta $senha

$chave = $null
$senha = $null

Write-Host ''
Write-Host 'Instalado. A tarefa roda a cada 10 minutos, das 07:00 as 23:50.' -ForegroundColor Green
Write-Host "Logs em $($script:PastaLogs)"

$agora = Read-Host 'Rodar um ciclo agora para testar? (S/N)'
if ($agora -match '^[sS]') {
    Start-ScheduledTask -TaskName $script:NomeTarefa
    $limite = (Get-Date).AddMinutes(3)
    do {
        Start-Sleep -Seconds 2
        $estado = (Get-ScheduledTask -TaskName $script:NomeTarefa).State
    } while ($estado -eq 'Running' -and (Get-Date) -lt $limite)

    $info = Get-ScheduledTaskInfo -TaskName $script:NomeTarefa
    Write-Host ('Resultado da tarefa: 0x{0:X} (0 = tudo certo, 2 = configuracao ou chave ausente, 3 = chave recusada pelo site)' -f $info.LastTaskResult)
    $ultimoLog = Get-ChildItem -LiteralPath $script:PastaLogs -Filter 'conector-*.log' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($ultimoLog) { Get-Content -LiteralPath $ultimoLog.FullName -Tail 10 }
}

Write-Host 'Agora confira no painel do site (menu Servidor) se apareceu o ultimo contato.'
