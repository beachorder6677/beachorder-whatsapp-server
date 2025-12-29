const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Configurar origens permitidas para CORS
const allowedOrigins = [
  process.env.CORS_ORIGIN,
  process.env.CORS_ORIGIN2,
  process.env.CORS_ORIGIN3,
  process.env.CORS_ORIGIN4,
  'http://localhost:5173',
  'http://localhost:3000'
].filter(Boolean); // Remove valores undefined/null

console.log('🔒 [CORS] Origens permitidas:', allowedOrigins);

// Middleware CORS com múltiplas origens
app.use(cors({
  origin: function (origin, callback) {
    // Permite requests sem origin (ex: REST clients, mobile apps)
    if (!origin) return callback(null, true);

    // Verifica se a origem contém .mgx.dev ou .mgx.world (aceita todos subdomínios)
    if (origin.includes('.mgx.dev') || origin.includes('.mgx.world') || origin.includes('localhost')) {
      return callback(null, true);
    }

    // Verifica se está na lista de origens permitidas
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.warn('⚠️ [CORS] Origem bloqueada:', origin);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// WhatsApp Client
let client;
let qrCodeData = '';
let isClientReady = false;

// Inicializar WhatsApp Client
function initializeWhatsApp() {
  client = new Client({
    authStrategy: new LocalAuth({
      clientId: "beachorder-client"
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    }
  });

  // Eventos do WhatsApp
  client.on('qr', async (qr) => {
    console.log('QR Code recebido, gerando imagem...');
    qrCodeData = await QRCode.toDataURL(qr);
    console.log('QR Code disponível em: /api/qr');
  });

  client.on('ready', () => {
    console.log('✅ WhatsApp Client está pronto!');
    isClientReady = true;
    qrCodeData = '';
  });

  client.on('authenticated', () => {
    console.log('✅ WhatsApp autenticado com sucesso!');
  });

  client.on('auth_failure', (msg) => {
    console.error('❌ Falha na autenticação:', msg);
    isClientReady = false;
  });

  client.on('disconnected', (reason) => {
    console.log('❌ WhatsApp desconectado:', reason);
    isClientReady = false;
    // Tentar reconectar após 5 segundos
    setTimeout(() => {
      console.log('🔄 Tentando reconectar...');
      client.initialize();
    }, 5000);
  });

  // Inicializar cliente
  client.initialize();
}

// Rotas da API

// Status do servidor
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    whatsappReady: isClientReady,
    timestamp: new Date().toISOString()
  });
});

// QR Code para autenticação
app.get('/api/qr', (req, res) => {
  if (qrCodeData) {
    res.json({
      success: true,
      qrCode: qrCodeData,
      message: 'Escaneie o QR Code com seu WhatsApp'
    });
  } else if (isClientReady) {
    res.json({
      success: true,
      qrCode: null,
      message: 'WhatsApp já está conectado'
    });
  } else {
    res.json({
      success: false,
      qrCode: null,
      message: 'Aguardando QR Code...'
    });
  }
});

// Enviar mensagem
app.post('/api/send-message', async (req, res) => {
  try {
    if (!isClientReady) {
      return res.status(503).json({
        success: false,
        message: 'WhatsApp não está conectado'
      });
    }

    const { number, message, type = 'text' } = req.body;

    if (!number || !message) {
      return res.status(400).json({
        success: false,
        message: 'Número e mensagem são obrigatórios'
      });
    }

    // Formatar número (adicionar código do país se necessário)
    let formattedNumber = number.replace(/\D/g, '');
    if (!formattedNumber.startsWith('55')) {
      formattedNumber = '55' + formattedNumber;
    }
    formattedNumber += '@c.us';

    // Enviar mensagem
    const sentMessage = await client.sendMessage(formattedNumber, message);

    res.json({
      success: true,
      messageId: sentMessage.id._serialized,
      message: 'Mensagem enviada com sucesso'
    });

  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao enviar mensagem: ' + error.message
    });
  }
});

// Enviar mensagem para múltiplos números
app.post('/api/send-bulk-message', async (req, res) => {
  try {
    if (!isClientReady) {
      return res.status(503).json({
        success: false,
        message: 'WhatsApp não está conectado'
      });
    }

    const { numbers, message } = req.body;

    if (!numbers || !Array.isArray(numbers) || !message) {
      return res.status(400).json({
        success: false,
        message: 'Lista de números e mensagem são obrigatórios'
      });
    }

    const results = [];

    for (const number of numbers) {
      try {
        // Formatar número
        let formattedNumber = number.replace(/\D/g, '');
        if (!formattedNumber.startsWith('55')) {
          formattedNumber = '55' + formattedNumber;
        }
        formattedNumber += '@c.us';

        // Enviar mensagem
        const sentMessage = await client.sendMessage(formattedNumber, message);

        results.push({
          number: number,
          success: true,
          messageId: sentMessage.id._serialized
        });

        // Delay entre mensagens para evitar spam
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        results.push({
          number: number,
          success: false,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      results: results,
      message: `${results.filter(r => r.success).length}/${results.length} mensagens enviadas`
    });

  } catch (error) {
    console.error('Erro ao enviar mensagens em lote:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao enviar mensagens: ' + error.message
    });
  }
});

// Webhook para receber mensagens (opcional)
app.post('/api/webhook', (req, res) => {
  console.log('Webhook recebido:', req.body);
  // Aqui você pode processar mensagens recebidas
  res.json({ success: true });
});

// Rota de teste
app.get('/', (req, res) => {
  res.json({
    service: 'Beach Order WhatsApp Server',
    version: '1.0.0',
    status: isClientReady ? 'connected' : 'disconnected',
    endpoints: {
      status: '/api/status',
      qr: '/api/qr',
      sendMessage: '/api/send-message',
      sendBulk: '/api/send-bulk-message'
    }
  });
});

// Inicializar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📱 Inicializando WhatsApp Client...`);
  initializeWhatsApp();
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Encerrando servidor...');
  if (client) {
    await client.destroy();
  }
  process.exit(0);
});