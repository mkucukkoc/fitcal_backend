import nodemailer from 'nodemailer';
import { logger } from '../utils/logger';

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.zoho.eu';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = (process.env.SMTP_SECURE || 'true') === 'true';
const SMTP_USER = process.env.SMTP_USER || 'support@fitcal.ai';
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
    try {
      await transporter.sendMail({
        from: SMTP_FROM,
        to,
        subject,
        html,
      });
    } catch (error: any) {
      const safeError = {
        name: error?.name,
        code: error?.code,
        message: error?.message,
        response: error?.response,
        responseCode: error?.responseCode,
      };
      logger.error({ err: safeError, to, subject }, 'Email send failed');
      throw error;
    }
  },
};
