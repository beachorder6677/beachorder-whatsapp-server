const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
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
  'http://localhost:3001',
  'https://praiabar.mgx.world',
  'https://praiabar.atoms.world',
  'https://praiabar.atoms.dev',
  'https://mineirinho.atoms.world',
  'https://mineirinho.atoms.dev',
  'https://beachorder.atoms.dev'
].filter(Boolean);

console.log('🔒 [CORS] Origens permitidas:', allowedOrigins);

// Middleware CORS
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.includes('.mgx.dev') ||
      origin.includes('.mgx.world') ||
      origin.includes('.atoms.dev') ||
      origin.includes('.atoms.world') ||
      origin.includes('localhost')) {
      return callback(null, true);
    }
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

// Logger silencioso para Baileys
const logger = pino({ level: 'silent' });

// Função para obter ou criar um cliente para uma barraca
async function getClient(barracaId) {
  if (!barracaId) return null;

  if (clients.has(barracaId)) {
    return clients.get(barracaId);
  }

  console.log(`🚀 Inicializando novo cliente WhatsApp (Baileys) para: ${barracaId}`);

  const clientData = {
    socket: null,
    qrCode: null,
    status: 'disconnected',
    session: null
  };

  clients.set(barracaId, clientData);

  try {
    await initializeSocket(barracaId, clientData);
  } catch (error) {
    console.error(`❌ Erro ao inicializar ${barracaId}:`, error.message);
    clientData.status = 'initialization_error';
  }

  return clientData;
}

// Inicializar socket Baileys
async function initializeSocket(barracaId, clientData) {
  const authDir = path.join('./whatsapp-sessions', barracaId);

  // Criar diretório se não existir
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  // Obter a versão mais recente do WhatsApp para evitar erro 405
  let version;
  try {
    const versionInfo = await fetchLatestBaileysVersion();
    version = versionInfo.version;
    console.log(`📱 [${barracaId}] Usando versão WhatsApp: ${version.join('.')}`);
  } catch (err) {
    console.log(`⚠️ [${barracaId}] Usando versão padrão`);
    version = [2, 3000, 1015901307]; // Versão de fallback
  }

  const socket = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'warn' }),
    browser: ['BeachOrder', 'Safari', '1.0.0'],
    connectTimeoutMs: 120000,
    defaultQueryTimeoutMs: 120000,
    keepAliveIntervalMs: 25000,
    retryRequestDelayMs: 500,
    emitOwnEvents: false,
    syncFullHistory: false,
    markOnlineOnConnect: false
  });

  clientData.socket = socket;

  // Evento de conexão atualizada
  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log(`📱 QR Code gerado para ${barracaId}`);
      try {
        clientData.qrCode = await qrcode.toDataURL(qr);
        clientData.status = 'qr_ready';
      } catch (error) {
        console.error(`❌ Erro ao gerar QR code:`, error);
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`🔌 [${barracaId}] Desconectado. Código: ${statusCode}. Reconectar: ${shouldReconnect}`);

      clientData.status = 'disconnected';
      clientData.qrCode = null;

      if (shouldReconnect) {
        // Tentar reconectar após 5 segundos
        setTimeout(() => {
          console.log(`🔄 [${barracaId}] Tentando reconectar...`);
          initializeSocket(barracaId, clientData);
        }, 5000);
      } else {
        // Logout - limpar sessão
        clientData.session = null;
        clients.delete(barracaId);
        // Limpar arquivos de sessão
        if (fs.existsSync(authDir)) {
          fs.rmSync(authDir, { recursive: true, force: true });
        }
      }
    }

    if (connection === 'open') {
      console.log(`✅ WhatsApp conectado para: ${barracaId}`);
      clientData.status = 'ready';
      clientData.qrCode = null;

      // Obter informações do usuário
      try {
        const user = socket.user;
        if (user) {
          clientData.session = {
            number: user.id.split(':')[0].split('@')[0],
            name: user.name || 'WhatsApp Business',
            platform: 'Baileys'
          };
          console.log(`📱 [${barracaId}] Conectado como: ${clientData.session.number} (${clientData.session.name})`);
        }
      } catch (err) {
        console.error(`❌ [${barracaId}] Erro ao obter info:`, err.message);
      }
    }
  });

  // Salvar credenciais quando atualizadas
  socket.ev.on('creds.update', saveCreds);
}

// Rotas da API

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    library: 'Baileys',
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
    return res.status(200).json({
      success: true,
      message: 'WhatsApp Server (Baileys) is running. barracaId is required for specific status.'
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

  // Aguardar um pouco pelo QR Code se ainda não estiver pronto
  if (!clientData.qrCode && clientData.status !== 'ready') {
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  if (clientData.qrCode) {
    res.json({
      success: true,
      qrCode: clientData.qrCode,
      status: clientData.status
    });
  } else if (clientData.status === 'ready') {
    res.json({
      success: true,
      message: 'WhatsApp já está conectado',
      status: clientData.status
    });
  } else {
    res.json({
      success: false,
      message: 'QR Code não disponível. Aguarde...',
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
    if (clientData && clientData.socket) {
      await clientData.socket.logout();
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

    // Remover cliente existente
    const clientData = clients.get(barracaId);
    if (clientData && clientData.socket) {
      try {
        await clientData.socket.end();
      } catch (e) {
        // Ignorar erros ao fechar
      }
    }
    clients.delete(barracaId);

    // Limpar sessão existente
    const authDir = path.join('./whatsapp-sessions', barracaId);
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
    }

    // Criar novo cliente
    setTimeout(() => {
      getClient(barracaId);
    }, 1000);

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

    if (clientData.status !== 'ready' || !clientData.socket) {
      return res.status(400).json({
        success: false,
        message: `WhatsApp não está conectado para ${barracaId}. Status: ${clientData.status}`
      });
    }

    // Formatar número (Baileys usa formato diferente)
    let formattedPhone = phone.replace(/\D/g, '');
    if (!formattedPhone.startsWith('55')) {
      formattedPhone = '55' + formattedPhone;
    }
    const jid = formattedPhone + '@s.whatsapp.net';

    console.log(`📤 [${barracaId}] Enviando mensagem para ${jid}`);

    const result = await clientData.socket.sendMessage(jid, { text: message });

    res.json({
      success: true,
      message: 'Mensagem enviada com sucesso',
      messageId: result.key.id,
      to: jid
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

    if (clientData.status !== 'ready' || !clientData.socket) {
      return res.status(400).json({
        success: false,
        message: `WhatsApp não está conectado para ${barracaId}. Status: ${clientData.status}`
      });
    }

    const results = [];

    for (let i = 0; i < phones.length; i++) {
      const phone = phones[i];

      try {
        let formattedPhone = phone.replace(/\D/g, '');
        if (!formattedPhone.startsWith('55')) {
          formattedPhone = '55' + formattedPhone;
        }
        const jid = formattedPhone + '@s.whatsapp.net';

        console.log(`📤 [${barracaId}] [${i + 1}/${phones.length}] Enviando para ${jid}`);

        const result = await clientData.socket.sendMessage(jid, { text: message });

        results.push({
          phone: phone,
          success: true,
          messageId: result.key.id
        });

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
  console.log(`🚀 Servidor WhatsApp (Baileys) rodando na porta ${PORT}`);
  console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🔄 Recebido SIGTERM, fechando servidor...');
  for (const [id, data] of clients) {
    if (data.socket) {
      try {
        await data.socket.end();
      } catch (e) { }
    }
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🔄 Recebido SIGINT, fechando servidor...');
  for (const [id, data] of clients) {
    if (data.socket) {
      try {
        await data.socket.end();
      } catch (e) { }
    }
  }
  process.exit(0);
});