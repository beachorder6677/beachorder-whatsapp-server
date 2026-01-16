const express = require('express');
const cors = require('cors');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Configurar origens permitidas para CORS
const allowedOrigins = [
  process.env.CORS_ORIGIN,
  process.env.CORS_ORIGIN2,
  process.env.CORS_ORIGIN3,
  process.env.CORS_ORIGIN4,
  'http://localhost:5173',
  'http://localhost:3000',
  'https://praiabar.atoms.world'
].filter(Boolean); // Remove valores undefined/null

console.log('🔒 [CORS] Origens permitidas:', allowedOrigins);

// Middleware CORS com múltiplas origens e suporte a subdomínios dinâmicos
app.use(cors({
  origin: function (origin, callback) {
    // Permite requests sem origin (ex: REST clients, mobile apps)
    if (!origin) return callback(null, true);

    // Verifica se a origem contém .atoms.dev, .atoms.world, .mgx.dev ou .mgx.world ou é localhost
    // ✅ MIGRAÇÃO: Adicionado atoms.dev e atoms.world (novo domínio da plataforma)
    if (origin.includes('.atoms.dev') || origin.includes('.atoms.world') || origin.includes('.mgx.dev') || origin.includes('.mgx.world') || origin.includes('localhost')) {
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

// Middleware de logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - Origin: ${req.headers.origin}`);
  next();
});

// Estado do WhatsApp (Multi-tenant)
const clients = new Map();

// Função para obter ou criar um cliente para uma barraca
async function getClient(barracaId) {
  if (!barracaId) return null;

  if (clients.has(barracaId)) {
    return clients.get(barracaId);
  }

  console.log(`🚀 Inicializando novo cliente WhatsApp para barraca: ${barracaId}`);

  const clientData = {
    client: null,
    qrCode: null,
    status: 'disconnected',
    session: null
  };

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: barracaId,
      dataPath: './whatsapp-sessions'
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--no-zygote',
        '--disable-gpu'
      ]
    }
  });

  client.on('qr', async (qr) => {
    console.log(`📱 QR Code gerado para ${barracaId}`);
    try {
      clientData.qrCode = await qrcode.toDataURL(qr);
      clientData.status = 'qr_ready';
    } catch (error) {
      console.error(`❌ Erro ao gerar QR code para ${barracaId}:`, error);
    }
  });

  client.on('ready', () => {
    console.log(`✅ WhatsApp conectado para barraca: ${barracaId}`);
    clientData.status = 'ready';
    clientData.qrCode = null;

    client.info.then(info => {
      clientData.session = {
        number: info.wid.user,
        name: info.pushname || 'WhatsApp Business',
        platform: info.platform
      };
    });
  });

  client.on('authenticated', () => {
    clientData.status = 'authenticated';
  });

  client.on('auth_failure', () => {
    clientData.status = 'auth_failure';
    clientData.qrCode = null;
  });

  client.on('disconnected', () => {
    clientData.status = 'disconnected';
    clientData.qrCode = null;
    clientData.session = null;
    clients.delete(barracaId);
  });

  clientData.client = client;
  clients.set(barracaId, clientData);

  client.initialize().catch(err => {
    console.error(`❌ Erro ao inicializar cliente ${barracaId}:`, err);
    clients.delete(barracaId);
  });

  return clientData;
}

// Rotas da API

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    whatsapp_sessions: {
      total: clients.size,
      active: Array.from(clients.entries()).map(([id, data]) => ({ id, status: data.status }))
    }
  });
});

// Status do WhatsApp
app.get('/api/status', async (req, res) => {
  const { barracaId } = req.query;
  if (!barracaId) {
    // Retornar 200 para o healthcheck do Railway não falhar
    return res.status(200).json({
      success: true,
      message: 'WhatsApp Server is running. barracaId is required for specific status.'
    });
  }

  const clientData = await getClient(barracaId);
  res.json({
    status: clientData.status,
    whatsappReady: clientData.status === 'ready',
    qrCode: clientData.qrCode,
    session: clientData.session,
    timestamp: new Date().toISOString()
  });
});

// Obter QR Code
app.get('/api/qr', async (req, res) => {
  const { barracaId } = req.query;
  if (!barracaId) {
    return res.status(400).json({ success: false, message: 'barracaId é obrigatório' });
  }

  const clientData = await getClient(barracaId);
  if (clientData.qrCode) {
    res.json({
      success: true,
      qrCode: clientData.qrCode,
      status: clientData.status
    });
  } else {
    res.json({
      success: false,
      message: 'QR Code não disponível',
      status: clientData.status
    });
  }
});

// Desconectar WhatsApp
app.post('/api/disconnect', async (req, res) => {
  try {
    const { barracaId } = req.body;
    if (!barracaId) {
      return res.status(400).json({ success: false, message: 'barracaId é obrigatório' });
    }

    const clientData = clients.get(barracaId);
    if (clientData && clientData.client) {
      await clientData.client.destroy();
      clients.delete(barracaId);
    }

    res.json({
      success: true,
      message: 'WhatsApp desconectado com sucesso'
    });
  } catch (error) {
    console.error('❌ Erro ao desconectar:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao desconectar WhatsApp',
      error: error.message
    });
  }
});

// Reinicializar conexão
app.post('/api/reconnect', async (req, res) => {
  try {
    const { barracaId } = req.body;
    if (!barracaId) {
      return res.status(400).json({ success: false, message: 'barracaId é obrigatório' });
    }

    const clientData = clients.get(barracaId);
    if (clientData && clientData.client) {
      await clientData.client.destroy();
      clients.delete(barracaId);
    }

    setTimeout(() => {
      getClient(barracaId);
    }, 2000);

    res.json({
      success: true,
      message: 'Reinicializando conexão WhatsApp...'
    });
  } catch (error) {
    console.error('❌ Erro ao reconectar:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao reconectar WhatsApp',
      error: error.message
    });
  }
});

// Enviar mensagem individual
app.post('/api/send-message', async (req, res) => {
  try {
    const { phone, message, barracaId } = req.body;

    if (!barracaId || !phone || !message) {
      return res.status(400).json({
        success: false,
        message: 'barracaId, telefone e mensagem são obrigatórios'
      });
    }

    const clientData = await getClient(barracaId);

    // ✅ CORREÇÃO: Verificar se o client realmente existe
    if (!clientData || !clientData.client) {
      console.error(`❌ [${barracaId}] Cliente WhatsApp não inicializado`);
      return res.status(400).json({
        success: false,
        message: `WhatsApp não inicializado para a barraca ${barracaId}. Por favor, escaneie o QR Code novamente.`,
        status: clientData?.status || 'not_initialized'
      });
    }

    if (clientData.status !== 'ready') {
      return res.status(400).json({
        success: false,
        message: `WhatsApp não está conectado para a barraca ${barracaId}. Status: ${clientData.status}`
      });
    }

    // Formatar número
    let formattedPhone = phone.replace(/\D/g, '');
    if (!formattedPhone.startsWith('55')) {
      formattedPhone = '55' + formattedPhone;
    }
    formattedPhone += '@c.us';

    console.log(`📤 [${barracaId}] Enviando mensagem para ${formattedPhone}`);

    const result = await clientData.client.sendMessage(formattedPhone, message);

    res.json({
      success: true,
      message: 'Mensagem enviada com sucesso',
      messageId: result.id.id,
      to: formattedPhone
    });

  } catch (error) {
    console.error('❌ Erro ao enviar mensagem:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao enviar mensagem',
      error: error.message
    });
  }
});

// Enviar mensagem em massa
app.post('/api/send-bulk', async (req, res) => {
  try {
    const { phones, message, barracaId, delay = 2000 } = req.body;

    if (!barracaId || !phones || !Array.isArray(phones) || phones.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'barracaId e lista de telefones são obrigatórios'
      });
    }

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Mensagem é obrigatória'
      });
    }

    const clientData = await getClient(barracaId);

    if (clientData.status !== 'ready') {
      return res.status(400).json({
        success: false,
        message: `WhatsApp não está conectado para a barraca ${barracaId}. Status: ${clientData.status}`
      });
    }

    const results = [];

    for (let i = 0; i < phones.length; i++) {
      const phone = phones[i];

      try {
        // Formatar número
        let formattedPhone = phone.replace(/\D/g, '');
        if (!formattedPhone.startsWith('55')) {
          formattedPhone = '55' + formattedPhone;
        }
        formattedPhone += '@c.us';

        console.log(`📤 [${barracaId}] [${i + 1}/${phones.length}] Enviando para ${formattedPhone}`);

        const result = await clientData.client.sendMessage(formattedPhone, message);

        results.push({
          phone: phone,
          success: true,
          messageId: result.id.id
        });

        // Delay entre mensagens para evitar spam
        if (i < phones.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }

      } catch (error) {
        console.error(`❌ Erro ao enviar para ${phone}:`, error);
        results.push({
          phone: phone,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    res.json({
      success: true,
      message: `Envio concluído: ${successCount} sucessos, ${failureCount} falhas`,
      results: results,
      summary: {
        total: phones.length,
        success: successCount,
        failure: failureCount
      }
    });

  } catch (error) {
    console.error('❌ Erro no envio em massa:', error);
    res.status(500).json({
      success: false,
      message: 'Erro no envio em massa',
      error: error.message
    });
  }
});

// Middleware de tratamento de erros
app.use((error, req, res, next) => {
  console.error('❌ Erro no servidor:', error);
  res.status(500).json({
    success: false,
    message: 'Erro interno do servidor',
    error: process.env.NODE_ENV === 'development' ? error.message : 'Internal Server Error'
  });
});

// Inicializar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor WhatsApp Multi-tenant rodando na porta ${PORT}`);
  console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🔄 Recebido SIGTERM, fechando servidor...');
  for (const [id, data] of clients) {
    if (data.client) await data.client.destroy();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🔄 Recebido SIGINT, fechando servidor...');
  for (const [id, data] of clients) {
    if (data.client) await data.client.destroy();
  }
  process.exit(0);
});