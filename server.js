const express = require('express');
const cors = require('cors');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuração CORS mais permissiva para desenvolvimento
const corsOptions = {
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://praiabar.mgx.world',
    /^https:\/\/.*\.mgx\.dev$/,
    /^https:\/\/.*\.app\.mgx\.dev$/,
    /^https:\/\/.*-preview\.app\.mgx\.dev$/
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());

// Middleware de logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - Origin: ${req.headers.origin}`);
  next();
});

// Estado do WhatsApp
let whatsappClient = null;
let qrCodeData = null;
let clientStatus = 'disconnected';
let sessionData = null;

// Inicializar cliente WhatsApp
function initializeWhatsApp() {
  console.log('🚀 Inicializando cliente WhatsApp...');
  
  whatsappClient = new Client({
    authStrategy: new LocalAuth({
      dataPath: './whatsapp-session'
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

  whatsappClient.on('qr', async (qr) => {
    console.log('📱 QR Code gerado');
    try {
      qrCodeData = await qrcode.toDataURL(qr);
      clientStatus = 'qr_ready';
      console.log('✅ QR Code convertido para base64');
    } catch (error) {
      console.error('❌ Erro ao gerar QR code:', error);
    }
  });

  whatsappClient.on('ready', () => {
    console.log('✅ WhatsApp conectado e pronto!');
    clientStatus = 'ready';
    qrCodeData = null;
    
    // Obter informações da sessão
    whatsappClient.info.then(info => {
      sessionData = {
        number: info.wid.user,
        name: info.pushname || 'WhatsApp Business',
        platform: info.platform
      };
      console.log('📱 Sessão ativa:', sessionData);
    });
  });

  whatsappClient.on('authenticated', () => {
    console.log('🔐 WhatsApp autenticado');
    clientStatus = 'authenticated';
  });

  whatsappClient.on('auth_failure', (msg) => {
    console.error('❌ Falha na autenticação:', msg);
    clientStatus = 'auth_failure';
    qrCodeData = null;
  });

  whatsappClient.on('disconnected', (reason) => {
    console.log('🔌 WhatsApp desconectado:', reason);
    clientStatus = 'disconnected';
    qrCodeData = null;
    sessionData = null;
  });

  // Inicializar
  whatsappClient.initialize();
}

// Rotas da API

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    whatsapp_status: clientStatus 
  });
});

// Status do WhatsApp
app.get('/api/status', (req, res) => {
  res.json({
    status: clientStatus,
    qrCode: qrCodeData,
    session: sessionData,
    timestamp: new Date().toISOString()
  });
});

// Obter QR Code
app.get('/api/qr', (req, res) => {
  if (qrCodeData) {
    res.json({
      success: true,
      qrCode: qrCodeData,
      status: clientStatus
    });
  } else {
    res.json({
      success: false,
      message: 'QR Code não disponível',
      status: clientStatus
    });
  }
});

// Desconectar WhatsApp
app.post('/api/disconnect', async (req, res) => {
  try {
    if (whatsappClient) {
      await whatsappClient.destroy();
      whatsappClient = null;
    }
    
    clientStatus = 'disconnected';
    qrCodeData = null;
    sessionData = null;
    
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
app.post('/api/reconnect', (req, res) => {
  try {
    if (whatsappClient) {
      whatsappClient.destroy();
    }
    
    setTimeout(() => {
      initializeWhatsApp();
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
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({
        success: false,
        message: 'Telefone e mensagem são obrigatórios'
      });
    }

    if (clientStatus !== 'ready') {
      return res.status(400).json({
        success: false,
        message: `WhatsApp não está conectado. Status: ${clientStatus}`
      });
    }

    // Formatar número (remover caracteres especiais e adicionar código do país se necessário)
    let formattedPhone = phone.replace(/\D/g, '');
    if (!formattedPhone.startsWith('55')) {
      formattedPhone = '55' + formattedPhone;
    }
    formattedPhone += '@c.us';

    console.log(`📤 Enviando mensagem para ${formattedPhone}: ${message}`);

    const result = await whatsappClient.sendMessage(formattedPhone, message);
    
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
    const { phones, message, delay = 2000 } = req.body;

    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Lista de telefones é obrigatória'
      });
    }

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Mensagem é obrigatória'
      });
    }

    if (clientStatus !== 'ready') {
      return res.status(400).json({
        success: false,
        message: `WhatsApp não está conectado. Status: ${clientStatus}`
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

        console.log(`📤 [${i+1}/${phones.length}] Enviando para ${formattedPhone}`);

        const result = await whatsappClient.sendMessage(formattedPhone, message);
        
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
  console.log(`🚀 Servidor WhatsApp rodando na porta ${PORT}`);
  console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  
  // Inicializar WhatsApp após 3 segundos
  setTimeout(() => {
    initializeWhatsApp();
  }, 3000);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🔄 Recebido SIGTERM, fechando servidor...');
  if (whatsappClient) {
    await whatsappClient.destroy();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🔄 Recebido SIGINT, fechando servidor...');
  if (whatsappClient) {
    await whatsappClient.destroy();
  }
  process.exit(0);
});