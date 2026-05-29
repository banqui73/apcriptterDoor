/**
 * Firebase Cloud Functions para AegisPattern
 * Verifica email en Auth → genera código → envía por SendGrid
 *
 * Setup:
 * 1. firebase init functions
 * 2. cd functions && npm install firebase-functions firebase-admin @sendgrid/mail
 * 3. firebase functions:config:set sendgrid.key="SG.XXXXXXXXXX"
 * 4. firebase deploy --only functions
 */

const functions = require('firebase-functions');
const admin     = require('firebase-admin');
const sgMail    = require('@sendgrid/mail');

admin.initializeApp();
const db   = admin.database();
const auth = admin.auth();

sgMail.setApiKey(functions.config().sendgrid.key);

// ─────────────────────────────────────────────
// Dominios temporales/desechables bloqueados
// ─────────────────────────────────────────────
const TEMP_DOMAINS = [
  'tempmail.com','guerrillamail.com','mailinator.com','temp-mail.org',
  '10minutemail.com','maildrop.cc','throwaway.email','10minutemail.de',
  'yopmail.com','trashmail.com','fakeinbox.com','trash-mail.com',
  'temp-mail.io','tempmail.io','temp-email.com','fakeemail.com',
  'dispostable.com','sharklasers.com','guerrillamailblock.com',
  'grr.la','guerrillamail.info','spam4.me','spamgourmet.com',
];

// ─────────────────────────────────────────────
// requestTrial — verifica Auth + envía código
// ─────────────────────────────────────────────
exports.requestTrial = functions.https.onCall(async (data, context) => {
  const email = (data.email || '').trim().toLowerCase();

  // ── Validación básica ──
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new functions.https.HttpsError('invalid-argument', 'Email inválido.');
  }

  const domain = email.split('@')[1];

  // ── Bloquear temporales ──
  if (TEMP_DOMAINS.includes(domain)) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'No se permiten emails temporales. Usa tu email real.'
    );
  }

  // ── Verificar que el email está registrado en Firebase Auth ──
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
  } catch (authErr) {
    // auth/user-not-found u otro error
    throw new functions.https.HttpsError(
      'not-found',
      'Este email no está registrado en AegisPattern. Regístrate primero.'
    );
  }

  // ── Verificar que el email está verificado ──
  if (!userRecord.emailVerified) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Tu email aún no está verificado. Revisa tu bandeja de entrada.'
    );
  }

  // ── Verificar que no tiene ya un plan activo ──
  const userSnap = await db.ref(`users/${userRecord.uid}`).once('value');
  if (userSnap.exists()) {
    const userData = userSnap.val();
    if (userData.plan === 'premium' || userData.plan === 'ultra') {
      throw new functions.https.HttpsError(
        'already-exists',
        'Ya tienes un plan activo.'
      );
    }
    if (userData.plan === 'trial' && userData.trialExpiry > Date.now()) {
      throw new functions.https.HttpsError(
        'already-exists',
        'Ya tienes una prueba activa.'
      );
    }
  }

  // ── Verificar cooldown 24h por email ──
  const emailKey = email.replace(/\./g, '_').replace(/@/g, '__at__');
  const existingSnap = await db.ref(`trial_requests/${emailKey}`).once('value');

  if (existingSnap.exists()) {
    const existing = existingSnap.val();
    const elapsed = Date.now() - (existing.createdAt || 0);
    if (elapsed < 24 * 60 * 60 * 1000) {
      const hoursLeft = Math.ceil((24 * 60 * 60 * 1000 - elapsed) / 3600000);
      throw new functions.https.HttpsError(
        'already-exists',
        `Ya solicitaste una prueba. Intenta en ${hoursLeft}h.`
      );
    }
  }

  // ── Generar código ──
  // Nota: en Node.js usamos require('crypto'), no window.crypto
  const { randomBytes } = require('crypto');
  const trialCode = 'TRIAL-' + randomBytes(6).toString('hex').toUpperCase();
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 días

  // ── Guardar en Firebase ──
  await db.ref(`trial_requests/${emailKey}`).set({
    email,
    uid: userRecord.uid,
    code: trialCode,
    expiresAt,
    used: false,
    createdAt: admin.database.ServerValue.TIMESTAMP,
    ip: (context.rawRequest && context.rawRequest.headers['x-forwarded-for']) || 'unknown',
  });

  await db.ref(`trial_codes/${trialCode}`).set({
    email,
    uid: userRecord.uid,
    expiresAt,
    used: false,
  });

  // ── Enviar email con SendGrid ──
  const expiryStr = new Date(expiresAt).toLocaleString('es-ES', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid',
  });

  const msg = {
    to:      email,
    from: {
      email: 'noreply@aegispattern.io', // ← cambia por tu dominio verificado en SendGrid
      name:  'AegisPattern',
    },
    subject: '🔐 Tu código de prueba AegisPattern — 7 días gratis',
    replyTo: 'support@aegispattern.io',
    html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tu código de prueba AegisPattern</title></head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0f1e;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:580px;background:#080c14;border-radius:16px;border:1px solid #1e3050;overflow:hidden;">

        <!-- HEADER -->
        <tr>
          <td style="background:linear-gradient(135deg,#0d1422,#111929);padding:32px 32px 24px;text-align:center;border-bottom:1px solid #1e3050;">
            <div style="font-size:26px;font-weight:900;letter-spacing:-0.5px;color:#38bdf8;">
              ⬡ AEGIS<span style="color:#f59e0b">PATTERN</span>
            </div>
            <div style="font-size:13px;color:#4e6a8a;margin-top:6px;letter-spacing:1px;text-transform:uppercase;">
              Suite Criptográfica Industrial
            </div>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 12px;color:#e2eaf6;font-size:20px;">🎁 Prueba Premium — 7 días gratis</h2>
            <p style="margin:0 0 24px;color:#8fa3bf;line-height:1.7;font-size:14px;">
              ¡Hola! Tu solicitud de prueba gratuita ha sido aprobada.<br>
              Copia el código de abajo y actívalo en AegisPattern:
            </p>

            <!-- CODE BOX -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
              <tr>
                <td align="center" style="background:#0d1422;border:2px solid #38bdf8;border-radius:12px;padding:28px 20px;">
                  <div style="font-family:'Courier New',monospace;font-size:26px;font-weight:700;letter-spacing:3px;color:#38bdf8;">
                    ${trialCode}
                  </div>
                  <div style="font-size:12px;color:#4e6a8a;margin-top:8px;">Código de activación · copia exactamente</div>
                </td>
              </tr>
            </table>

            <!-- STEPS -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#111929;border-radius:10px;border:1px solid #1e3050;margin-bottom:24px;">
              <tr><td style="padding:20px;">
                <div style="font-size:13px;color:#34d399;font-weight:600;margin-bottom:12px;">Cómo activarlo (30 segundos):</div>
                <div style="font-size:13px;color:#8fa3bf;line-height:2;">
                  1️⃣ Abre
                  <a href="https://banqui73.github.io/apcriptterDoor/" style="color:#38bdf8;">AegisPattern</a>
                  e inicia sesión<br>
                  2️⃣ Ve a la pestaña <strong style="color:#e2eaf6;">Planes</strong><br>
                  3️⃣ En "Activar licencia", pega:
                  <code style="background:#0d1422;color:#f59e0b;padding:2px 8px;border-radius:4px;font-size:12px;">${trialCode}</code><br>
                  4️⃣ ¡Listo! Acceso Premium desbloqueado 🚀
                </div>
              </td></tr>
            </table>

            <!-- FEATURES -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1a12;border-radius:10px;border:1px solid rgba(52,211,153,0.2);margin-bottom:24px;">
              <tr><td style="padding:20px;">
                <div style="font-size:13px;color:#34d399;font-weight:600;margin-bottom:10px;">✅ Durante 7 días tendrás acceso a:</div>
                <table cellpadding="0" cellspacing="0">
                  <tr><td style="padding:3px 0;font-size:13px;color:#8fa3bf;">🔑 AES-GCM 256-bit + ChaCha20-Poly1305</td></tr>
                  <tr><td style="padding:3px 0;font-size:13px;color:#8fa3bf;">📁 Archivos sin límite de tamaño (cifrado)</td></tr>
                  <tr><td style="padding:3px 0;font-size:13px;color:#8fa3bf;">⚡ Transferencia P2P cifrada hasta 49.99 GB</td></tr>
                  <tr><td style="padding:3px 0;font-size:13px;color:#8fa3bf;">⚛️ Kyber-1024 post-cuántico</td></tr>
                  <tr><td style="padding:3px 0;font-size:13px;color:#8fa3bf;">🚫 Sin espera freemium entre operaciones</td></tr>
                </table>
              </td></tr>
            </table>

            <!-- EXPIRY -->
            <div style="font-size:12px;color:#4e6a8a;padding:12px 16px;background:#111929;border-radius:8px;border-left:3px solid #f59e0b;">
              ⏰ <strong style="color:#f59e0b;">Expira el:</strong> ${expiryStr}
            </div>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #1e3050;text-align:center;">
            <p style="margin:0;font-size:11px;color:#2d4060;line-height:1.6;">
              © 2026 AegisPattern · Cifrado en el navegador · E2E · Sin servidores<br>
              Si no solicitaste esto, ignora este correo. El código no se activará sin tu acción.<br>
              <a href="https://banqui73.github.io/apcriptterDoor/" style="color:#2d4060;">Web</a> ·
              <a href="https://github.com/banqui73/apcriptterDoor" style="color:#2d4060;">GitHub</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };

  try {
    await sgMail.send(msg);
  } catch (sendErr) {
    console.error('SendGrid error:', JSON.stringify(sendErr.response?.body || sendErr.message));
    // Guardar para reintento manual
    await db.ref(`failed_emails/${emailKey}`).set({
      email, code: trialCode,
      error: sendErr.message,
      ts: admin.database.ServerValue.TIMESTAMP,
    });
    throw new functions.https.HttpsError(
      'internal',
      'No se pudo enviar el email. Intenta de nuevo en unos minutos.'
    );
  }

  return {
    success: true,
    message: 'Código enviado a tu email.',
    // Ocultamos parte del email por privacidad
    emailHint: email.replace(/^(.{2})(.+?)(@.+)$/, (_, a, b, c) => a + '*'.repeat(b.length) + c),
    expiresIn: '7 días',
  };
});


// ─────────────────────────────────────────────
// validateTrialCode — canjea el código
// ─────────────────────────────────────────────
exports.validateTrialCode = functions.https.onCall(async (data, context) => {
  const { code, uid } = data;

  if (!code || !uid) {
    throw new functions.https.HttpsError('invalid-argument', 'Código o UID faltante.');
  }

  const codeSnap = await db.ref(`trial_codes/${code}`).once('value');
  if (!codeSnap.exists()) {
    throw new functions.https.HttpsError('not-found', 'Código no válido.');
  }

  const codeData = codeSnap.val();

  if (Date.now() > codeData.expiresAt) {
    throw new functions.https.HttpsError('failed-precondition', 'Código expirado.');
  }
  if (codeData.used) {
    throw new functions.https.HttpsError('already-exists', 'Código ya utilizado.');
  }

  await db.ref(`trial_codes/${code}`).update({
    used: true,
    usedBy: uid,
    usedAt: admin.database.ServerValue.TIMESTAMP,
  });

  await db.ref(`users/${uid}`).update({
    plan: 'trial',
    trialExpiry: codeData.expiresAt,
    trialActivatedAt: admin.database.ServerValue.TIMESTAMP,
    trialCode: code,
  });

  return {
    success: true,
    plan: 'trial',
    expiresAt: codeData.expiresAt,
    daysLeft: Math.ceil((codeData.expiresAt - Date.now()) / 86400000),
  };
});


// ─────────────────────────────────────────────
// cleanupExpiredCodes — limpieza diaria 03:00
// ─────────────────────────────────────────────
exports.cleanupExpiredCodes = functions.pubsub
  .schedule('every day 03:00')
  .timeZone('Europe/Madrid')
  .onRun(async () => {
    const now  = Date.now();
    const snap = await db.ref('trial_codes').once('value');
    const codes = snap.val() || {};
    const updates = {};
    let cleaned = 0;

    Object.entries(codes).forEach(([key, val]) => {
      if (val.expiresAt < now) { updates[`trial_codes/${key}`] = null; cleaned++; }
    });

    if (cleaned > 0) await db.ref().update(updates);
    console.log(`Limpieza: ${cleaned} códigos eliminados.`);
    return { cleaned };
  });
