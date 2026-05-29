/**
 * Firebase Cloud Functions para AegisPattern
 * Valida emails reales y envía código trial
 * 
 * Instalación:
 * 1. firebase init functions
 * 2. npm install firebase-functions firebase-admin @sendgrid/mail
 * 3. firebase functions:config:set sendgrid.key="SG_API_KEY"
 * 4. firebase deploy --only functions
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const sgMail = require('@sendgrid/mail');

admin.initializeApp();
const db = admin.database();

// Configurar SendGrid
sgMail.setApiKey(functions.config().sendgrid.key);

/**
 * Validar email y enviar código trial
 * POST: /requestTrial
 * Body: { email: "user@example.com" }
 */
exports.requestTrial = functions.https.onCall(async (data, context) => {
  const email = (data.email || '').trim().toLowerCase();

  // ═══ VALIDACIONES ═══
  if (!email || !email.includes('@')) {
    throw new functions.https.HttpsError('invalid-argument', 'Email inválido');
  }

  // Rechazar dominios públicos/temporales
  const tempDomains = [
    'tempmail.com', 'guerrillamail.com', 'mailinator.com', 'temp-mail.org',
    '10minutemail.com', 'maildrop.cc', 'throwaway.email', '10minutemail.de',
    'yopmail.com', 'trashmail.com', 'fakeinbox.com', 'trash-mail.com',
    'temp-mail.io', 'tempmail.io', 'temp-email.com', 'fakeemail.com'
  ];

  const domain = email.split('@')[1];
  if (tempDomains.includes(domain)) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'No se permiten emails temporales. Usa tu email real.'
    );
  }

  // Validar dominio Gmail/Outlook/etc (opcional: verificar MX records en producción)
  const validDomains = ['gmail.com', 'outlook.com', 'yahoo.com', 'protonmail.com', 'tutanota.com'];
  const isValidProvider = validDomains.some(d => domain.includes(d)) || email.endsWith('.es') || email.endsWith('.com');

  if (!isValidProvider && domain.split('.').length < 2) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Dominio de email no válido'
    );
  }

  // ═══ VERIFICAR SI YA SOLICITÓ ═══
  const emailKey = email.replace(/\./g, '_').replace(/@/g, '__at__');
  const existingSnap = await db.ref(`trial_requests/${emailKey}`).once('value');

  if (existingSnap.exists()) {
    const existing = existingSnap.val();
    // Si ya solicitó hace menos de 24h, rechazar
    if (Date.now() - existing.createdAt < 24 * 60 * 60 * 1000) {
      throw new functions.https.HttpsError(
        'already-exists',
        `Ya se solicitó una prueba. Intenta en 24h.`
      );
    }
  }

  // ═══ GENERAR CÓDIGO ═══
  const codeBytes = crypto.getRandomValues(new Uint8Array(8));
  const trialCode = 'TRIAL-' + Array.from(codeBytes, b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
    .slice(0, 12);

  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 días

  // ═══ GUARDAR EN FIREBASE ═══
  const trialData = {
    email,
    code: trialCode,
    expiresAt,
    used: false,
    createdAt: admin.database.ServerValue.TIMESTAMP,
    requestedAt: new Date().toISOString(),
    ipHash: context.rawRequest.headers['x-forwarded-for'] || 'unknown'
  };

  // Guardar solicitud
  await db.ref(`trial_requests/${emailKey}`).set(trialData);

  // Guardar código para validación rápida
  await db.ref(`trial_codes/${trialCode}`).set({
    email,
    expiresAt,
    used: false
  });

  // ═══ ENVIAR EMAIL CON SENDGRID ═══
  try {
    const msg = {
      to: email,
      from: 'noreply@aegispattern.io', // Cambiar por tu dominio verificado
      subject: '🔐 Tu código de prueba AegisPattern — 7 días gratis',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; }
            .container { background: #080c14; color: #e2eaf6; padding: 40px 20px; border-radius: 12px; }
            .header { text-align: center; margin-bottom: 30px; }
            .logo { font-size: 24px; font-weight: 900; margin-bottom: 10px; }
            .code-box { background: #0d1422; border: 2px solid #38bdf8; padding: 30px; text-align: center; border-radius: 8px; margin: 30px 0; }
            .code { font-family: 'DM Mono', monospace; font-size: 28px; font-weight: 700; letter-spacing: 2px; color: #38bdf8; }
            .expires { font-size: 14px; color: #8fa3bf; margin-top: 20px; }
            .footer { font-size: 12px; color: #4e6a8a; text-align: center; margin-top: 40px; border-top: 1px solid #16203a; padding-top: 20px; }
            a { color: #0ea5e9; text-decoration: none; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">⬡ AEGIS<strong style="color: #f59e0b">PATTERN</strong></div>
              <p style="margin: 10px 0; color: #8fa3bf;">Suite criptográfica industrial</p>
            </div>

            <h2 style="margin: 20px 0; color: #e2eaf6;">🎁 ¡Prueba Premium por 7 días!</h2>
            
            <p style="color: #8fa3bf; line-height: 1.6;">
              Hemos recibido tu solicitud para activar una prueba gratuita de AegisPattern Premium.
              <br><br>
              Tu código de acceso es:
            </p>

            <div class="code-box">
              <div class="code">${trialCode}</div>
              <p style="margin: 0; color: #8fa3bf; font-size: 13px;">Copia este código</p>
            </div>

            <p style="color: #8fa3bf; line-height: 1.6; margin: 0 0 20px;">
              <strong>Cómo activarlo:</strong>
              <br>1. Abre <a href="https://banqui73.github.io/apcriptterDoor/">AegisPattern</a>
              <br>2. Ve a <strong>Planes → Activar licencia</strong>
              <br>3. Pega este código: <code style="background: #111929; padding: 2px 6px; border-radius: 3px; color: #f59e0b;">${trialCode}</code>
              <br>4. ¡Acceso Premium desbloqueado durante 7 días! 🚀
            </p>

            <div style="background: #111929; border-left: 3px solid #10b981; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 0; color: #34d399; font-size: 14px; font-weight: 600;">✅ Con Premium accedes a:</p>
              <ul style="margin: 10px 0; padding-left: 20px; color: #8fa3bf; font-size: 13px;">
                <li>AES-GCM 256-bit + ChaCha20</li>
                <li>Archivos sin límite para cifrar</li>
                <li>Transferencia P2P hasta 49.99GB</li>
                <li>Algoritmos avanzados y Kyber-1024</li>
                <li>Sin espera freemium entre operaciones</li>
              </ul>
            </div>

            <p style="color: #8fa3bf; margin: 20px 0; font-size: 13px;">
              <strong>⏰ Este código expira el:</strong> ${new Date(expiresAt).toLocaleString('es-ES')}
            </p>

            <p style="color: #4e6a8a; margin: 20px 0; font-size: 13px;">
              Si no solicitaste esta prueba, simplemente ignora este email. El código no se activará sin tu acción.
            </p>

            <div class="footer">
              <p style="margin: 0;">© 2026 AegisPattern · Cifrado en el navegador · E2E · Sin servidores</p>
              <p style="margin: 5px 0 0;"><a href="https://github.com/banqui73/apcriptterDoor">GitHub</a> • <a href="https://banqui73.github.io/apcriptterDoor/">Web</a></p>
            </div>
          </div>
        </body>
        </html>
      `,
      replyTo: 'support@aegispattern.io'
    };

    await sgMail.send(msg);
    
    return {
      success: true,
      message: 'Código de prueba enviado a tu email',
      email: email.replace(/(.{2})(.*)(.{2})/, '$1***$3'), // Ocultar parcialmente
      expiresIn: '7 días'
    };
  } catch (sendError) {
    console.error('SendGrid error:', sendError);
    // Si falla el email, guardar para reintento
    await db.ref(`failed_emails/${emailKey}`).set({
      email,
      code: trialCode,
      error: sendError.message,
      timestamp: admin.database.ServerValue.TIMESTAMP
    });
    throw new functions.https.HttpsError(
      'internal',
      'No pudimos enviar el email. Intenta de nuevo.'
    );
  }
});

/**
 * Validar y canjear código trial
 * POST: /validateTrialCode
 * Body: { code: "TRIAL-XXXXXXXX", uid: "user-id" }
 */
exports.validateTrialCode = functions.https.onCall(async (data, context) => {
  const { code, uid } = data;

  if (!code || !uid) {
    throw new functions.https.HttpsError('invalid-argument', 'Código o UID faltante');
  }

  try {
    // Buscar código
    const codeSnap = await db.ref(`trial_codes/${code}`).once('value');
    if (!codeSnap.exists()) {
      throw new functions.https.HttpsError('not-found', 'Código no válido');
    }

    const codeData = codeSnap.val();

    // Verificar si está expirado
    if (Date.now() > codeData.expiresAt) {
      throw new functions.https.HttpsError('failed-precondition', 'Código expirado');
    }

    // Verificar si ya fue usado
    if (codeData.used) {
      throw new functions.https.HttpsError('already-exists', 'Código ya utilizado');
    }

    // Marcar como usado
    await db.ref(`trial_codes/${code}`).update({
      used: true,
      usedBy: uid,
      usedAt: admin.database.ServerValue.TIMESTAMP
    });

    // Actualizar plan del usuario
    await db.ref(`users/${uid}`).update({
      plan: 'trial',
      trialExpiry: codeData.expiresAt,
      trialActivatedAt: admin.database.ServerValue.TIMESTAMP,
      trialCode: code
    });

    return {
      success: true,
      plan: 'trial',
      expiresAt: codeData.expiresAt,
      daysLeft: Math.ceil((codeData.expiresAt - Date.now()) / (24 * 60 * 60 * 1000))
    };
  } catch (err) {
    console.error('Validation error:', err);
    throw err;
  }
});

/**
 * Limpiar códigos expirados (ejecutar diariamente)
 */
exports.cleanupExpiredCodes = functions.pubsub
  .schedule('every day 03:00')
  .timeZone('Europe/Madrid')
  .onRun(async (context) => {
    const now = Date.now();
    const codesRef = db.ref('trial_codes');
    
    const snap = await codesRef.once('value');
    const codes = snap.val() || {};

    const updates = {};
    let cleaned = 0;

    Object.entries(codes).forEach(([key, val]) => {
      if (val.expiresAt < now && !val.used) {
        updates[`trial_codes/${key}`] = null;
        cleaned++;
      }
    });

    if (Object.keys(updates).length > 0) {
      await db.ref().update(updates);
      console.log(`Limpieza: ${cleaned} códigos expirados eliminados`);
    }

    return { cleaned };
  });
