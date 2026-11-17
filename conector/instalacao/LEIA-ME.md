# Conector ABA 2.0 — instalação no servidor

O conector é um programa pequeno que roda sozinho no **ABA-SERVIDOR**. A cada 10 minutos (das 07:00 às 23:50) ele olha a pasta `00 - CONSULTORIAS`, encontra PDFs novos ou alterados e envia para o site da ABA. Ele **só lê** a pasta: nunca apaga, move ou altera nada nela.

Quem instala precisa ser **administrador do servidor**. Leva uns 15 minutos.

## O que você vai precisar

- A pasta `dist` já pronta (quem preparou o pacote copia para o servidor, por exemplo para `C:\Temp\dist`).
- Uma **chave de servidor**, emitida no painel do site (admin → Servidor → "Emitir chave"). Ela aparece **uma única vez**: deixe a tela aberta até terminar a instalação. Emitir uma nova chave desativa a anterior.
- Uma senha forte para a conta do conector (passo 1).

## Passo 1 — Criar a conta dedicada

O conector não usa a sua conta nem a do outro administrador. Ele usa uma conta só dele, chamada `aba-conector`.

1. Abra **Gerenciamento do Computador → Usuários e Grupos Locais → Usuários → Novo Usuário**.
2. Nome: `aba-conector`. Defina uma senha forte. Marque **"A senha nunca expira"** e desmarque "O usuário deve alterar a senha no próximo logon".
3. Não coloque essa conta em nenhum grupo (nem Administradores).
4. Dê a ela o direito de **logon como lote**:
   - abra `secpol.msc` → **Diretivas Locais → Atribuição de Direitos de Usuário → Fazer logon como um trabalho em lote**;
   - **Adicionar usuário ou grupo** → `aba-conector`.
5. Dê a ela **somente leitura** na pasta `00 - CONSULTORIAS`:
   - na pasta compartilhada (`\\aba-servidor\DRIVER\ABA CONSULTORIA\00 - CONSULTORIAS`), aba **Segurança**, adicione `aba-conector` com **Leitura e execução** (sem "Modificar" e sem "Controle total");
   - se a pasta é compartilhada na rede, confira também o compartilhamento (Compartilhamento avançado → Permissões): a conta precisa de **Leitura**.

## Passo 2 — Rodar o instalador

1. Abra o **PowerShell como administrador** (botão direito → Executar como administrador).
2. Entre na pasta do pacote e rode o instalador:

   ```powershell
   cd C:\Temp\dist\instalacao
   powershell -ExecutionPolicy Bypass -File .\instalar.ps1
   ```

3. Responda ao que ele pedir:
   - **Endereço do site**: aperte Enter para usar `https://aba-consultorias.vercel.app`.
   - **Conta do Windows**: aperte Enter para usar `aba-conector`.
   - **Senha da conta**: digite a senha do passo 1 (não aparece na tela).
   - **Chave de servidor**: cole a chave emitida no painel (também não aparece na tela).
4. No final ele pergunta se quer **rodar um ciclo agora**. Responda `S`. O resultado `0x0` significa que deu tudo certo.

O instalador copia o programa para `C:\ABA\Conector`, guarda a chave cifrada (só a conta `aba-conector` consegue abrir) e cria a tarefa **ABA Conector** no Agendador de Tarefas.

## Passo 3 — Conferir no painel do site

1. Entre no admin do site → **Servidor**.
2. Confira que **"Último contato"** é de poucos minutos atrás e que aparece a versão `2.0.0`.
3. Em cada empreendimento com a pasta do servidor configurada, veja se não há erro (por exemplo "duas pastas começam com 250101 - ").
4. Os primeiros PDFs aparecem em **"Chegaram do servidor"**, ocultos: nada vai para o cliente sem a equipe liberar.

A primeira carga é espalhada: no máximo **20 arquivos (ou 500 MB) por ciclo**, então uma pasta grande leva algumas horas para subir inteira. Isso é normal.

## Dia a dia

- **Logs**: `C:\ABA\Conector\logs` (um arquivo por dia, guarda 30 dias). Os logs nunca têm a chave.
- **Ver se está rodando**: Agendador de Tarefas → tarefa **ABA Conector** → "Resultado da última execução". `0x0` = ok. `0x2` = falta configuração ou chave. `0x3` = o site recusou a chave (foi revogada ou trocada).
- **Trocar a chave** (nova chave emitida no painel): PowerShell como administrador, `cd C:\ABA\Conector\programa\instalacao`, depois `powershell -ExecutionPolicy Bypass -File .\trocar-chave.ps1`.
- **Desligar**: `powershell -ExecutionPolicy Bypass -File .\desinstalar.ps1` (remove a tarefa e o arquivo da chave; os logs ficam). Depois revogue a chave no painel.
- **Atualizar o programa**: copie o novo `dist` e rode o `instalar.ps1` de novo; ele pergunta tudo outra vez (a chave também).

## Se algo der errado

| O que apareceu | O que fazer |
|---|---|
| "A conta ... não existe" | Faça o passo 1; confira o nome. |
| "A tarefa ... não conectou" ou erro `0x80070569` | A senha está errada ou falta o direito "Fazer logon como um trabalho em lote" (passo 1.4). |
| Resultado `0x2` | Rode o `trocar-chave.ps1`. A chave só abre na conta que a gravou. |
| Resultado `0x3` | A chave foi revogada: emita outra no painel e rode o `trocar-chave.ps1`. |
| Log com "pasta raiz ilegível" | A conta `aba-conector` não consegue ler `00 - CONSULTORIAS`: revise o passo 1.5. |
| Painel: "duas pastas começam com ..." | Há duas pastas com o mesmo código de 6 dígitos na raiz; renomeie uma. |
| Nada chega ao painel | Veja o log do dia; confira se o servidor alcança o site (abra o endereço no navegador do servidor). |
