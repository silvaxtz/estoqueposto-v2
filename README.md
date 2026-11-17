# Estoque Grupo Atualize

Aplicativo desktop local para Windows, com banco SQLite armazenado no computador do posto. Funciona sem internet depois de instalado.

## O que já está implementado
- Dashboard de estoque.
- Abas separadas: Sorvetes, Lubrificantes e Outros.
- Cadastro e edição de produtos dentro do aplicativo.
- Cadastro de vendedores (Rayane e Bruno já incluídos).
- Registro de entradas e saídas com identificação do vendedor nas saídas.
- Bloqueio de saída acima do estoque disponível.
- Histórico de movimentações.
- Exportação CSV (abre no Excel).
- Backup do banco SQLite.
- 14 sorvetes iniciais cadastrados.

## Estoque inicial dos sorvetes
Cada linha representa 1 caixa comprada; o estoque é convertido para unidades:
- Cremosinhos: 10 unidades por caixa (3 sabores).
- Picolés cobertura: 22 unidades por caixa (2 produtos).
- Linha Milk: 26 unidades por caixa (3 produtos).
- Sublime Mousse Maracujá: quantidade por caixa pendente; estoque inicial 0 até confirmação.
- Linha Suco: 26 unidades por caixa (2 produtos).
- Potes 2L: 1 unidade de cada.
- Quy Copão Napolitano: quantidade por caixa pendente; estoque inicial 0 até confirmação.

Os dois itens pendentes podem ser editados quando a informação for confirmada. O cadastro permite alterar unidades por caixa, mas o ajuste do estoque deve ser feito registrando uma entrada.

## Requisitos
- Windows 10/11 64-bit
- Node.js LTS instalado para desenvolvimento/compilação

## Executar em modo de desenvolvimento
Abra o terminal nesta pasta e rode:

```bash
npm install
npm start
```

## Gerar instalador Windows
No Windows, rode:

```bash
npm install
npm run dist
```

O instalador será criado na pasta `dist`.

## Publicar no GitHub
Crie um repositório privado no GitHub e envie os arquivos deste projeto. Não publique o arquivo `estoque-atualize.db`: ele é criado automaticamente no perfil local do Windows de cada computador e contém os dados do posto.

## Onde ficam os dados
O banco é criado em `%APPDATA%/estoque-grupo-atualize/estoque-atualize.db` (pasta de dados do aplicativo). Faça backup pela tela “Relatórios e backup”.

## Observações importantes
- Esta versão não sincroniza dados pela internet; o painel remoto não faz parte desta primeira versão.
- O relatório CSV pode ser aberto no Excel ou LibreOffice.
- O valor de venda é informado/ajustado no cadastro do produto; na movimentação, o sistema usa o valor informado no formulário.
- O projeto é uma primeira versão funcional para validar fluxo e cadastro. Teste antes de usar em operação real e mantenha backups.


## Versão web (em preparação)

A branch `web-conversion` adiciona um servidor web que mantém o SQLite no computador que hospeda o sistema. O aplicativo desktop original e sua interface Electron permanecem preservados.

### Inicialização no computador servidor

1. Instale Node.js LTS nesse computador.
2. Abra o terminal na pasta do projeto e execute `npm install`.
3. Defina `APP_ACCESS_PASSWORD` (senha de entrada), `ADMIN_PASSWORD` (senha administrativa) e `SESSION_SECRET` (segredo longo e aleatório para as sessões). Use senhas fortes e não as coloque no Git.
4. Execute `npm run web`.
5. Acesse `http://localhost:3000` no próprio computador.

A senha administrativa das operações protegidas é obrigatória e validada no servidor; não existe senha administrativa padrão no servidor web. A senha de entrada no sistema é separada e configurada pelo responsável do posto. Tentativas incorretas são limitadas e as sessões ficam armazenadas no próprio SQLite. Não coloque senhas em arquivos públicos nem no Git.

**Atenção:** esta branch ainda precisa ser testada no computador que contém o banco real. Não exponha a porta do servidor diretamente à internet. Para acesso externo, configure um túnel HTTPS seguro no computador servidor. Não use esta versão em operação real antes de validar login, banco, permissões, backup e todas as movimentações com uma cópia de teste do banco. A branch ainda não foi testada em execução real nem publicada no endereço do GitHub Pages.

O banco usado pelo servidor é `%APPDATA%/estoque-grupo-atualize-v2/estoque-atualize.db`, o mesmo caminho de dados isolado configurado pelo V2 desktop.
