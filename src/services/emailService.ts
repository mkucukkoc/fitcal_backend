import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.zoho.eu';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = (process.env.SMTP_SECURE || 'true') === 'true';
const SMTP_USER = process.env.SMTP_USER || 'support@aveniaichat.com';
const SMTP_PASS = process.env.SMTP_PASS || 'vMQHrSMR5M3y';
const SMTP_FROM = process.env.SMTP_FROM || `FitCal Ai <${SMTP_USER}>`;

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

export const emailService = {
  async sendMail(to: string, subject: string, html: string): Promise<void> {
    await transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      html,
    });
  },
};
