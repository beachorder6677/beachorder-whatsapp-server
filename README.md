# Beach Order WhatsApp Server

Servidor Node.js para integração WhatsApp com o sistema Beach Order de gestão de barracas de praia.

## 🚀 Deploy no Railway

### 1. Preparação
```bash
# Clone o repositório
git clone https://github.com/beachorder6677/beachorder-whatsapp-server.git
cd beachorder-whatsapp-server

# Instale as dependências
npm install
```

### 2. Deploy no Railway
```bash
# Instale o Railway CLI
npm install -g @railway/cli

# Faça login no Railway
railway login

# Conecte ao projeto
railway link

# Deploy
railway up
```

### 3. Configuração
1. No painel do Railway, configure as variáveis de ambiente:
   - `PORT`: 3001 (ou deixe automático)
   - `FRONTEND_URL`: URL do seu Beach Order

2. Acesse a URL do seu deploy + `/api/qr` para obter o QR Code
3. Escaneie com seu WhatsApp para conectar

## 📡 Endpoints da API

### Status do Servidor
```
GET /api/status
```

### QR Code para Autenticação
```
GET /api/qr
```

### Enviar Mensagem
```
POST /api/send-message
Content-Type: application/json

{
  "number": "11999999999",
  "message": "Seu pedido #123 está pronto!"
}
```

### Enviar Mensagens em Lote
```
POST /api/send-bulk-message
Content-Type: application/json

{
  "numbers": ["11999999999", "11888888888"],
  "message": "Promoção especial hoje!"
}
```

## 🔧 Integração com Beach Order

No seu projeto Beach Order, atualize o arquivo `src/services/whatsappService.ts`:

```typescript
const WHATSAPP_SERVER_URL = 'https://seu-railway-app.railway.app';

export const sendWhatsAppMessage = async (number: string, message: string) => {
  try {
    const response = await fetch(`${WHATSAPP_SERVER_URL}/api/send-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ number, message }),
    });
    
    return await response.json();
  } catch (error) {
    console.error('Erro ao enviar WhatsApp:', error);
    throw error;
  }
};
```

## 🛠️ Desenvolvimento Local

```bash
# Instalar dependências
npm install

# Rodar em modo desenvolvimento
npm run dev

# Rodar em produção
npm start
```

## 📋 Funcionalidades

- ✅ Conexão automática com WhatsApp Web
- ✅ Envio de mensagens individuais
- ✅ Envio de mensagens em lote
- ✅ QR Code para autenticação
- ✅ Reconexão automática
- ✅ API REST completa
- ✅ Logs detalhados
- ✅ Configuração para Railway

## 🔒 Segurança

- CORS configurado para seu frontend
- Validação de números brasileiros
- Rate limiting automático
- Logs de segurança

## 📞 Suporte

Para dúvidas sobre integração, consulte a documentação do Beach Order ou entre em contato com a equipe de desenvolvimento.# beachorder-whatsapp-server
