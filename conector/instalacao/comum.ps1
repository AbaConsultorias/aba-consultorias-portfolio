# Funcoes e constantes comuns aos scripts de instalacao do Conector ABA.
# Compativel com Windows PowerShell 5.1. Nao e executado sozinho: os outros scripts o carregam.

$ErrorActionPreference = 'Stop'

$script:PastaBase = 'C:\ABA\Conector'
$script:PastaPrograma = Join-Path $script:PastaBase 'programa'
$script:PastaEstado = Join-Path $script:PastaBase 'estado'
$script:PastaLogs = Join-Path $script:PastaBase 'logs'
$script:PastaSegredo = Join-Path $script:PastaBase 'segredo'
$script:ArquivoChave = Join-Path $script:PastaSegredo 'chave.dpapi'
$script:ArquivoConfig = Join-Path $script:PastaBase 'config.json'
$script:NomeTarefa = 'ABA Conector'
$script:NomeTarefaTemporaria = 'ABA Conector - gravar chave (temporaria)'
$script:RaizFixa = '\\aba-servidor\DRIVER\ABA CONSULTORIA\00 - CONSULTORIAS'
$script:UrlPadrao = 'https://aba-consultorias.vercel.app'
$script:ContaPadrao = 'aba-conector'
$script:FormatoChave = '^abacon_[A-Za-z0-9_-]{43}$'

function Exigir-Administrador {
    $identidade = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identidade)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Este script precisa rodar como administrador. Clique com o botao direito no PowerShell e escolha "Executar como administrador".'
    }
}

function Resolver-Conta {
    param([Parameter(Mandatory)][string]$Nome)

    $qualificado = $Nome
    if ($qualificado -notmatch '[\\@]') { $qualificado = "$env:COMPUTERNAME\$Nome" }
    try {
        $conta = New-Object Security.Principal.NTAccount($qualificado)
        $sid = $conta.Translate([Security.Principal.SecurityIdentifier])
    } catch {
        throw "A conta '$qualificado' nao existe neste servidor. Crie a conta primeiro (veja o LEIA-ME.md) e rode de novo."
    }
    try {
        $local = Get-LocalUser -SID $sid -ErrorAction Stop
        if (-not $local.Enabled) { throw "A conta '$qualificado' esta desativada." }
    } catch [Microsoft.PowerShell.Commands.UserNotFoundException] {
        # conta de dominio: nao ha como conferir daqui
    }
    return [pscustomobject]@{ Nome = $qualificado; Sid = $sid.Value }
}

# Permissoes de C:\ABA\Conector. Remover heranca nao apaga ACEs explicitas de outras contas e
# /grant:r so troca as dos SIDs citados; por isso cada item (pasta ou arquivo, sem excecao) recebe
# uma ACL NOVA, protegida, montada do zero e com dono Administradores. Depois a ACL e relida e a
# instalacao falha se sobrar qualquer SID fora de Administradores, SYSTEM e da conta dedicada.
$script:SidAdministradores = 'S-1-5-32-544'
$script:SidSistema = 'S-1-5-18'
$script:DireitosConta = @{
    Leitura         = [System.Security.AccessControl.FileSystemRights]::Read
    LeituraExecucao = [System.Security.AccessControl.FileSystemRights]::ReadAndExecute
    Modificar       = [System.Security.AccessControl.FileSystemRights]::Modify
}

function Exigir-SemAtalho {
    param([Parameter(Mandatory)][string]$Caminho)

    $item = Get-Item -LiteralPath $Caminho -Force
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw "$Caminho e um atalho ou juncao. Apague-o e rode de novo."
    }
}

# Nunca segue atalho ou juncao: Set-Acl por um deles mudaria as permissoes do destino.
function Listar-ItensConector {
    $itens = New-Object System.Collections.Generic.List[object]
    $pilha = New-Object System.Collections.Generic.Stack[string]
    $pilha.Push($script:PastaBase)
    while ($pilha.Count -gt 0) {
        $pasta = $pilha.Pop()
        foreach ($filho in @(Get-ChildItem -LiteralPath $pasta -Force)) {
            if ($filho.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
                throw "Encontrei um atalho ou juncao em $($filho.FullName). Apague-o e rode de novo."
            }
            $itens.Add($filho)
            if ($filho.PSIsContainer) { $pilha.Push($filho.FullName) }
        }
    }
    return $itens.ToArray()
}

# O que a conta dedicada pode em cada item (Relativo = caminho dentro de C:\ABA\Conector).
# Durante a gravacao da chave a conta precisa criar arquivos em segredo\; depois volta a so ler.
function Obter-DireitoPrevisto {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Relativo,
        [Parameter(Mandatory)][bool]$SegredoAberto
    )

    if ($Relativo -eq '') { return 'LeituraExecucao' }
    $partes = $Relativo.Split('\')
    $topo = $partes[0]
    if ($topo -ieq 'programa') { return 'LeituraExecucao' }
    if ($topo -ieq 'estado' -or $topo -ieq 'logs') { return 'Modificar' }
    if ($topo -ieq 'config.json' -and $partes.Count -eq 1) { return 'LeituraExecucao' }
    if ($topo -ieq 'segredo') {
        if ($SegredoAberto) { return 'Modificar' }
        if ($partes.Count -eq 1) { return 'LeituraExecucao' }
        if ($partes.Count -eq 2 -and $partes[1] -ieq 'chave.dpapi') { return 'Leitura' }
    }
    return 'Nenhum'
}

function Aplicar-AclItem {
    param(
        [Parameter(Mandatory)][string]$Caminho,
        [Parameter(Mandatory)][string]$SidConta,
        [Parameter(Mandatory)][ValidateSet('Nenhum', 'Leitura', 'LeituraExecucao', 'Modificar')][string]$Direito,
        [Parameter(Mandatory)][bool]$ContaSoNestaPasta
    )

    $ehPasta = (Get-Item -LiteralPath $Caminho -Force).PSIsContainer
    $semHeranca = [System.Security.AccessControl.InheritanceFlags]::None
    $heranca = $semHeranca
    if ($ehPasta) {
        $acl = New-Object System.Security.AccessControl.DirectorySecurity
        $heranca = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    } else {
        $acl = New-Object System.Security.AccessControl.FileSecurity
    }
    $propagacao = [System.Security.AccessControl.PropagationFlags]::None
    $permitir = [System.Security.AccessControl.AccessControlType]::Allow

    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier($script:SidAdministradores)))

    foreach ($sid in @($script:SidAdministradores, $script:SidSistema)) {
        $identidade = New-Object Security.Principal.SecurityIdentifier($sid)
        $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            $identidade, [System.Security.AccessControl.FileSystemRights]::FullControl, $heranca, $propagacao, $permitir))
    }
    if ($Direito -ne 'Nenhum') {
        $herancaConta = $heranca
        if ($ContaSoNestaPasta) { $herancaConta = $semHeranca }
        $identidade = New-Object Security.Principal.SecurityIdentifier($SidConta)
        $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            $identidade, $script:DireitosConta[$Direito], $herancaConta, $propagacao, $permitir))
    }
    Set-Acl -LiteralPath $Caminho -AclObject $acl
}

function Conferir-AclItem {
    param(
        [Parameter(Mandatory)][string]$Caminho,
        [Parameter(Mandatory)][string]$SidConta,
        [Parameter(Mandatory)][string]$Direito
    )

    $acl = Get-Acl -LiteralPath $Caminho
    if (-not $acl.AreAccessRulesProtected) { throw "A heranca de permissoes continua ligada em $Caminho" }
    $dono = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($dono -ne $script:SidAdministradores) { throw "O dono de $Caminho nao e o grupo Administradores (e $dono)" }

    $permitidos = @($script:SidAdministradores, $script:SidSistema, $SidConta)
    $escrita = [int][System.Security.AccessControl.FileSystemRights]'WriteData, AppendData, WriteExtendedAttributes, WriteAttributes, Delete, DeleteSubdirectoriesAndFiles, ChangePermissions, TakeOwnership'
    foreach ($regra in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        $sid = $regra.IdentityReference.Value
        if ($permitidos -notcontains $sid) { throw "Sobrou uma permissao de $sid em $Caminho" }
        if ($regra.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { throw "Sobrou uma regra de negacao em $Caminho" }
        if ($regra.IsInherited) { throw "Sobrou uma permissao herdada em $Caminho" }
        if ($sid -eq $script:SidAdministradores -or $sid -eq $script:SidSistema) { continue }
        if ($Direito -eq 'Nenhum') { throw "A conta dedicada nao deveria ter acesso a $Caminho" }
        if ($Direito -ne 'Modificar' -and (([int]$regra.FileSystemRights -band $escrita) -ne 0)) {
            throw "A conta dedicada tem escrita onde so deveria ler: $Caminho"
        }
    }
}

# Aplica e confere as permissoes de C:\ABA\Conector inteiro (ou so de segredo\, para a troca da chave).
function Aplicar-AclConector {
    param(
        [Parameter(Mandatory)][string]$SidConta,
        [switch]$SegredoAberto,
        [switch]$SoSegredo
    )

    Exigir-SemAtalho (Split-Path -Parent $script:PastaBase)
    Exigir-SemAtalho $script:PastaBase

    $alvos = New-Object System.Collections.Generic.List[object]
    if (-not $SoSegredo) { $alvos.Add(@{ Caminho = $script:PastaBase; Relativo = '' }) }
    foreach ($item in @(Listar-ItensConector)) {
        $relativo = $item.FullName.Substring($script:PastaBase.Length).TrimStart('\')
        $noSegredo = ($relativo -ieq 'segredo') -or $relativo.StartsWith('segredo\', [StringComparison]::OrdinalIgnoreCase)
        if ($SoSegredo -and -not $noSegredo) { continue }
        $alvos.Add(@{ Caminho = $item.FullName; Relativo = $relativo })
    }

    $aberto = [bool]$SegredoAberto
    foreach ($alvo in $alvos) {
        $direito = Obter-DireitoPrevisto -Relativo $alvo.Relativo -SegredoAberto $aberto
        $soNestaPasta = ($alvo.Relativo -eq '') -or (($alvo.Relativo -ieq 'segredo') -and -not $aberto)
        Aplicar-AclItem -Caminho $alvo.Caminho -SidConta $SidConta -Direito $direito -ContaSoNestaPasta $soNestaPasta
    }
    foreach ($alvo in $alvos) {
        $direito = Obter-DireitoPrevisto -Relativo $alvo.Relativo -SegredoAberto $aberto
        Conferir-AclItem -Caminho $alvo.Caminho -SidConta $SidConta -Direito $direito
    }
}

function Converter-ParaTexto {
    param([Parameter(Mandatory)][System.Security.SecureString]$Segura)

    $ponteiro = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Segura)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ponteiro)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ponteiro)
    }
}

function Ler-ChaveServidor {
    $segura = Read-Host 'Cole a chave de servidor emitida no painel (nao aparece na tela)' -AsSecureString
    $texto = (Converter-ParaTexto $segura).Trim()
    if ($texto -notmatch $script:FormatoChave) {
        throw 'Isso nao parece uma chave de servidor (ela comeca com abacon_ e tem 50 caracteres). Confira se copiou inteira.'
    }
    return $texto
}

# A chave e cifrada com DPAPI no contexto da conta dedicada: so essa conta (neste servidor)
# consegue decifrar. Como o instalador roda como administrador, o passo de cifrar roda como a
# conta, numa tarefa agendada temporaria (logon em lote, o mesmo tipo de logon da tarefa
# definitiva). A chave viaja do instalador para essa tarefa por um pipe nomeado cujo acesso e
# restrito ao instalador e a conta: nunca vai para a linha de comando, para o disco em texto
# puro nem para o registro de eventos.
function Gravar-ChaveComoConta {
    param(
        [Parameter(Mandatory)]$Conta,
        [Parameter(Mandatory)][string]$SenhaConta,
        [Parameter(Mandatory)][string]$ChaveTexto,
        [Parameter(Mandatory)][string]$Saida
    )

    $scriptCifrar = Join-Path $script:PastaPrograma 'instalacao\cifrar-chave-conta.ps1'
    if (-not (Test-Path -LiteralPath $scriptCifrar)) { throw "Nao encontrei $scriptCifrar. Rode o instalar.ps1 primeiro." }

    $nomePipe = 'aba-conector-' + [Guid]::NewGuid().ToString('N')
    $seguranca = New-Object System.IO.Pipes.PipeSecurity
    $permitir = [System.Security.AccessControl.AccessControlType]::Allow
    $euSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $contaSid = New-Object Security.Principal.SecurityIdentifier($Conta.Sid)
    $seguranca.AddAccessRule((New-Object System.IO.Pipes.PipeAccessRule($euSid, [System.IO.Pipes.PipeAccessRights]::FullControl, $permitir)))
    $seguranca.AddAccessRule((New-Object System.IO.Pipes.PipeAccessRule($contaSid, [System.IO.Pipes.PipeAccessRights]::ReadWrite, $permitir)))

    $pipe = [System.IO.Pipes.NamedPipeServerStream]::new(
        $nomePipe,
        [System.IO.Pipes.PipeDirection]::Out,
        1,
        [System.IO.Pipes.PipeTransmissionMode]::Byte,
        [System.IO.Pipes.PipeOptions]::Asynchronous,
        0,
        0,
        $seguranca)
    $bytes = $null
    try {
        $espera = $pipe.BeginWaitForConnection($null, $null)

        $argumento = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Pipe {1} -Saida "{2}"' -f $scriptCifrar, $nomePipe, $Saida
        $acao = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argumento
        $ajustes = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
        Register-ScheduledTask -TaskName $script:NomeTarefaTemporaria -Action $acao -Settings $ajustes `
            -User $Conta.Nome -Password $SenhaConta -RunLevel Limited -Force | Out-Null
        Start-ScheduledTask -TaskName $script:NomeTarefaTemporaria

        if (-not $espera.AsyncWaitHandle.WaitOne(90000)) {
            $info = Get-ScheduledTaskInfo -TaskName $script:NomeTarefaTemporaria
            throw ('A tarefa que roda como a conta nao conectou (resultado 0x{0:X}). Confira a senha da conta e se ela tem o direito "Fazer logon como um trabalho em lote".' -f $info.LastTaskResult)
        }
        $pipe.EndWaitForConnection($espera)
        $bytes = [Text.Encoding]::UTF8.GetBytes($ChaveTexto)
        $pipe.Write($bytes, 0, $bytes.Length)
        $pipe.Flush()
        $pipe.WaitForPipeDrain()
        $pipe.Dispose()

        $limite = (Get-Date).AddSeconds(60)
        do {
            Start-Sleep -Milliseconds 500
            $estado = (Get-ScheduledTask -TaskName $script:NomeTarefaTemporaria).State
        } while ($estado -eq 'Running' -and (Get-Date) -lt $limite)

        $info = Get-ScheduledTaskInfo -TaskName $script:NomeTarefaTemporaria
        if ($info.LastTaskResult -ne 0 -or -not (Test-Path -LiteralPath $Saida)) {
            throw ('A conta nao conseguiu gravar a chave (resultado 0x{0:X}).' -f $info.LastTaskResult)
        }
    } finally {
        if ($bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
        $pipe.Dispose()
        Unregister-ScheduledTask -TaskName $script:NomeTarefaTemporaria -Confirm:$false -ErrorAction SilentlyContinue
    }
}

# A conta dedicada precisa criar o arquivo da chave em segredo\: a pasta fica gravavel so durante
# a gravacao e volta a somente leitura (e o arquivo da chave a leitura) no fim, mesmo se falhar.
function Gravar-ChaveProtegida {
    param(
        [Parameter(Mandatory)]$Conta,
        [Parameter(Mandatory)][string]$SenhaConta,
        [Parameter(Mandatory)][string]$ChaveTexto
    )

    New-Item -ItemType Directory -Force -Path $script:PastaSegredo | Out-Null
    Aplicar-AclConector -SidConta $Conta.Sid -SoSegredo -SegredoAberto
    try {
        Gravar-ChaveComoConta -Conta $Conta -SenhaConta $SenhaConta -ChaveTexto $ChaveTexto -Saida $script:ArquivoChave
    } finally {
        Aplicar-AclConector -SidConta $Conta.Sid -SoSegredo
    }
}

function Registrar-TarefaConector {
    param(
        [Parameter(Mandatory)]$Conta,
        [Parameter(Mandatory)][string]$SenhaConta
    )

    $executar = Join-Path $script:PastaPrograma 'instalacao\executar.ps1'
    $argumento = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $executar
    $acao = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argumento -WorkingDirectory $script:PastaPrograma

    $gatilho = New-ScheduledTaskTrigger -Daily -At '07:00'
    $repeticao = New-ScheduledTaskTrigger -Once -At '07:00' `
        -RepetitionInterval (New-TimeSpan -Minutes 10) `
        -RepetitionDuration (New-TimeSpan -Hours 16 -Minutes 51)
    $gatilho.Repetition = $repeticao.Repetition

    $ajustes = New-ScheduledTaskSettingsSet `
        -MultipleInstances IgnoreNew `
        -StartWhenAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 9) `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries

    Register-ScheduledTask -TaskName $script:NomeTarefa -Action $acao -Trigger $gatilho -Settings $ajustes `
        -User $Conta.Nome -Password $SenhaConta -RunLevel Limited -Force `
        -Description 'Envia para o site da ABA os PDFs novos ou alterados do servidor (Conector ABA 2.0).' | Out-Null
}
