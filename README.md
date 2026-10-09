# Vela

Compartilhamento de tela entre amigos, direto do navegador. A pessoa que transmite escolhe uma tela, janela ou aba no seletor nativo do navegador e envia um link temporário para os amigos assistirem.

## Requisitos

- Node.js 20 ou superior
- Navegador atualizado com suporte a WebRTC e captura de tela

## Executar localmente

```sh
npm install
npm start
```

Abra <http://localhost:3000>. Para testar o link, abra-o em outro navegador ou dispositivo.

No PowerShell do Windows, se a execução de scripts bloquear `npm`, use `npm.cmd install` e `npm.cmd start`.

## O que esta primeira versão faz

- Uma pessoa transmite para até 9 espectadores (10 participantes no total).
- O seletor de compartilhamento do navegador controla qual tela, janela ou aba será exibida.
- O vídeo é transmitido diretamente entre os navegadores usando WebRTC; o servidor encaminha apenas as mensagens necessárias para iniciar a conexão.
- Não é preciso criar conta, instalar um aplicativo ou conceder acesso antes de escolher o que compartilhar.
- A sala e seu link deixam de funcionar quando a pessoa que transmite encerra a sessão ou perde a conexão.
- Não há chat, microfone ou gravação nesta versão. A captura solicita vídeo e áudio da tela; o áudio só é incluído se o seletor do navegador e o dispositivo oferecerem essa opção e ela for selecionada.
- Os espectadores recebem o áudio da tela sem som inicialmente; precisam clicar em **Ativar áudio** para ouvir. Isso permite que o vídeo comece mesmo quando o navegador bloqueia reprodução automática com som.
- Cada espectador recebe o vídeo diretamente de quem transmite; a velocidade de envio da pessoa anfitriã pode limitar a qualidade conforme mais amigos entram.
- Qualquer pessoa com o link pode assistir enquanto a sala estiver ativa; compartilhe-o apenas com quem você confia.
- Como o vídeo usa conexões WebRTC diretas, os participantes podem descobrir informações de rede uns dos outros, como o endereço IP público.

Na janela de compartilhamento, selecione **Compartilhar áudio** (o rótulo pode variar). A disponibilidade varia por navegador, sistema operacional e tipo de fonte compartilhada; por exemplo, alguns navegadores só oferecem áudio ao compartilhar uma aba. O site não captura o microfone.

## Disponibilizar pela internet

O compartilhamento de tela exige uma origem segura (HTTPS; `localhost` funciona durante o desenvolvimento). Coloque o servidor atrás de HTTPS e configure `PORT` conforme o provedor.

As conexões WebRTC usam um servidor STUN público como configuração inicial. Algumas redes, VPNs ou firewalls não permitem conexões diretas; para cobertura confiável, configure um serviço TURN e forneça seus servidores antes de carregar `app.js`:

```html
<script>
  window.VELA_ICE_SERVERS = [
    { urls: "turn:turn.example.com:3478", username: "usuario", credential: "credencial" }
  ];
</script>
<script src="/app.js" defer></script>
```

Use credenciais TURN temporárias geradas no servidor, não credenciais permanentes publicadas no HTML. Para uma implantação pública, também é necessário avaliar custos de TURN, disponibilidade e proteção contra abuso.

## Testes

```sh
npm test
```
