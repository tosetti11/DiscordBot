/**
 * Email Service — Gmail SMTP via Nodemailer
 * Used for bracket email verification and password reset.
 *
 * Required env vars:
 *   GMAIL_USER=thegamblingkingapp@gmail.com
 *   GMAIL_APP_PASSWORD=<16-char app password from Google Account>
 */
const nodemailer = require('nodemailer');

const GMAIL_USER = process.env.GMAIL_USER || 'rttoast1122@gmail.com';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!GMAIL_APP_PASSWORD) {
    console.warn('[Email] GMAIL_APP_PASSWORD not set — emails will not be sent');
    return null;
  }
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
  });
  return transporter;
}

/**
 * Send an email verification link
 */
async function sendVerificationEmail(toEmail, displayName, verificationUrl) {
  const t = getTransporter();
  if (!t) {
    console.warn('[Email] Skipping verification email — no transporter');
    return false;
  }
  try {
    await t.sendMail({
      from: `"The Gambling King" <${GMAIL_USER}>`,
      to: toEmail,
      subject: '🏀 Verify Your Email — March Madness Bracket Challenge',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background: #1a1a2e; color: #e0e0e0; padding: 30px; border-radius: 12px;">
          <h1 style="color: #f9a825; text-align: center; margin-bottom: 5px;">🏀 March Madness 2026</h1>
          <h2 style="color: #ccc; text-align: center; font-weight: normal; margin-top: 0;">Bracket Challenge</h2>
          <p>Hey <strong>${displayName}</strong>,</p>
          <p>Click the button below to verify your email and activate your account:</p>
          <div style="text-align: center; margin: 25px 0;">
            <a href="${verificationUrl}" style="background: #f9a825; color: #1a1a2e; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">Verify Email</a>
          </div>
          <p style="color: #999; font-size: 13px;">This link expires in 24 hours. If you didn't create this account, you can ignore this email.</p>
          <p style="color: #999; font-size: 13px;">Or copy this link: <a href="${verificationUrl}" style="color: #f9a825;">${verificationUrl}</a></p>
        </div>
      `,
    });
    console.log(`[Email] Verification sent to ${toEmail}`);
    return true;
  } catch (err) {
    console.error('[Email] Verification send error:', err.message);
    return false;
  }
}

/**
 * Send a password reset link
 */
async function sendPasswordResetEmail(toEmail, displayName, resetUrl) {
  const t = getTransporter();
  if (!t) {
    console.warn('[Email] Skipping reset email — no transporter');
    return false;
  }
  try {
    await t.sendMail({
      from: `"The Gambling King" <${GMAIL_USER}>`,
      to: toEmail,
      subject: '🔑 Password Reset — March Madness Bracket Challenge',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background: #1a1a2e; color: #e0e0e0; padding: 30px; border-radius: 12px;">
          <h1 style="color: #f9a825; text-align: center; margin-bottom: 5px;">🏀 March Madness 2026</h1>
          <h2 style="color: #ccc; text-align: center; font-weight: normal; margin-top: 0;">Password Reset</h2>
          <p>Hey <strong>${displayName}</strong>,</p>
          <p>We received a request to reset your password. Click below to choose a new one:</p>
          <div style="text-align: center; margin: 25px 0;">
            <a href="${resetUrl}" style="background: #f9a825; color: #1a1a2e; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">Reset Password</a>
          </div>
          <p style="color: #999; font-size: 13px;">This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
          <p style="color: #999; font-size: 13px;">Or copy this link: <a href="${resetUrl}" style="color: #f9a825;">${resetUrl}</a></p>
        </div>
      `,
    });
    console.log(`[Email] Reset email sent to ${toEmail}`);
    return true;
  } catch (err) {
    console.error('[Email] Reset send error:', err.message);
    return false;
  }
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
