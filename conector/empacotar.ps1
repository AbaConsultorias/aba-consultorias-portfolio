# Monta a pasta conector\dist com o programa, os scripts de instalacao e o node.exe oficial.
# Rode no PC de quem prepara o pacote (precisa de internet). Compativel com Windows PowerShell 5.1.
# Para atualizar o Node, mude so a variavel abaixo (use uma versao LTS 22 ou mais nova, win-x64).
$VersaoNode = 'v22.23.4'

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$conector = $PSScriptRoot
$dist = Join-Path $conector 'dist'
$arquivoZip = "node-$VersaoNode-win-x64.zip"
$urlBase = "https://nodejs.org/dist/$VersaoNode"

$trabalho = Join-Path ([IO.Path]::GetTempPath()) ('aba-node-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $trabalho | Out-Null

try {
    Write-Host "Baixando $arquivoZip e SHASUMS256.txt de nodejs.org"
    Invoke-WebRequest -UseBasicParsing -Uri "$urlBase/SHASUMS256.txt" -OutFile (Join-Path $trabalho 'SHASUMS256.txt')
    Invoke-WebRequest -UseBasicParsing -Uri "$urlBase/$arquivoZip" -OutFile (Join-Path $trabalho $arquivoZip)

    $linha = Get-Content -LiteralPath (Join-Path $trabalho 'SHASUMS256.txt') |
        Where-Object { $_ -match ('\s' + [regex]::Escape($arquivoZip) + '$') } |
        Select-Object -First 1
    if (-not $linha) { throw "O SHASUMS256.txt nao lista $arquivoZip." }
    $esperado = ($linha -split '\s+')[0].ToLowerInvariant()
    $obtido = (Get-FileHash -LiteralPath (Join-Path $trabalho $arquivoZip) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($obtido -ne $esperado) { throw "SHA-256 do $arquivoZip nao confere (esperado $esperado, obtido $obtido). Nada foi empacotado." }
    Write-Host "SHA-256 conferido: $obtido"

    $extraido = Join-Path $trabalho 'extraido'
    Expand-Archive -LiteralPath (Join-Path $trabalho $arquivoZip) -DestinationPath $extraido
    $pastaNode = Join-Path $extraido "node-$VersaoNode-win-x64"
    $nodeExe = Join-Path $pastaNode 'node.exe'
    if (-not (Test-Path -LiteralPath $nodeExe)) { throw 'O zip do Node nao trouxe o node.exe esperado.' }

    $assinatura = Get-AuthenticodeSignature -LiteralPath $nodeExe
    if ($assinatura.Status -ne 'Valid' -or $assinatura.SignerCertificate.Subject -notmatch 'OpenJS Foundation') {
        throw "A assinatura digital do node.exe nao e a da OpenJS Foundation (status: $($assinatura.Status))."
    }

    if (Test-Path -LiteralPath $dist) { Remove-Item -LiteralPath $dist -Recurse -Force }
    New-Item -ItemType Directory -Path $dist | Out-Null
    Copy-Item -LiteralPath $nodeExe -Destination (Join-Path $dist 'node.exe')
    Copy-Item -LiteralPath (Join-Path $pastaNode 'LICENSE') -Destination (Join-Path $dist 'node-LICENSE.txt')
    Copy-Item -LiteralPath (Join-Path $conector 'src') -Destination (Join-Path $dist 'src') -Recurse
    Copy-Item -LiteralPath (Join-Path $conector 'instalacao') -Destination (Join-Path $dist 'instalacao') -Recurse
    Copy-Item -LiteralPath (Join-Path $conector 'package.json') -Destination (Join-Path $dist 'package.json')

    Write-Host ''
    Write-Host "Pacote pronto em $dist (Node $VersaoNode). Copie a pasta dist inteira para o servidor e rode instalacao\instalar.ps1." -ForegroundColor Green
} finally {
    Remove-Item -LiteralPath $trabalho -Recurse -Force -ErrorAction SilentlyContinue
}
