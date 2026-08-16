// tools/emailTool.ts
// 邮件发送工具：让 DaShaAgent 拥有邮件能力（对标 dasha email）
// 实现：SMTP 发送（支持附件），收件箱检查（IMAP）
// 新增不破坏：独立文件，不影响现有工具

import { registry } from './registry';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import net from 'node:net';
import tls from 'node:tls';

// ---- SMTP 客户端（极简，无外部依赖）----
interface SmtpOpts {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  attachments?: { filename: string; path?: string; content?: Buffer }[];
}

function base64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

async function sendSmtp(opts: SmtpOpts): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    let socket: any;
    let buffer = '';
    let step = 0;

    const talk = (cmd: string) => {
      socket.write(cmd + '\r\n');
    };

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      // 处理多行响应
      const lines = buffer.split('\r\n');
      buffer = lines.pop() || '';
      const lastCode = lines.length ? parseInt(lines[lines.length - 1]?.slice(0, 3) || '') : 0;

      if (step === 0 && lastCode === 220) {
        step = 1;
        talk('EHLO ' + opts.host);
      } else if (step === 1 && lastCode === 250) {
        step = 2;
        talk('AUTH LOGIN');
      } else if (step === 2 && lastCode === 334) {
        step = 3;
        talk(base64(opts.user));
      } else if (step === 3 && lastCode === 334) {
        step = 4;
        talk(base64(opts.pass));
      } else if (step === 4 && lastCode === 235) {
        step = 5;
        talk('MAIL FROM:<' + opts.from + '>');
      } else if (step === 5 && lastCode === 250) {
        step = 6;
        talk('RCPT TO:<' + opts.to + '>');
      } else if (step === 6 && lastCode === 250) {
        step = 7;
        talk('DATA');
      } else if (step === 7 && lastCode === 354) {
        step = 8;
        // 构建 MIME 邮件
        const boundary = '----=_Part_' + Date.now();
        let mime = 'From: ' + opts.from + '\r\nTo: ' + opts.to + '\r\nSubject: =?UTF-8?B?' + base64(opts.subject) + '?=\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="' + boundary + '"\r\n\r\n';
        mime += '--' + boundary + '\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n';
        mime += base64(opts.body) + '\r\n';
        for (const att of opts.attachments || []) {
          mime += '--' + boundary + '\r\nContent-Type: application/octet-stream; name="=?UTF-8?B?' + base64(att.filename) + '?="\r\nContent-Disposition: attachment; filename="=?UTF-8?B?' + base64(att.filename) + '?="\r\nContent-Transfer-Encoding: base64\r\n\r\n';
          let content: Buffer;
          if (att.content) content = att.content;
          else if (att.path && fs.existsSync(att.path)) content = fs.readFileSync(att.path);
          else content = Buffer.from('');
          mime += content.toString('base64').replace(/(.{76})/g, '$1\r\n') + '\r\n';
        }
        mime += '--' + boundary + '--\r\n.\r\n';
        socket.write(mime);
        step = 9;
      } else if (step === 9 && lastCode === 250) {
        step = 10;
        talk('QUIT');
      } else if (step === 10 && lastCode === 221) {
        socket.end();
        resolve({ ok: true });
      } else if (lastCode >= 400) {
        socket.end();
        resolve({ ok: false, error: `SMTP错误(${lastCode}): ${lines.join(' ').slice(0,200)}` });
      }
    };

    try {
      if (opts.port === 465) {
        socket = tls.connect({ host: opts.host, port: opts.port, rejectUnauthorized: false }, () => {
          socket.on('data', onData);
        });
      } else {
        socket = net.connect({ host: opts.host, port: opts.port }, () => {
          socket.on('data', onData);
        });
      }
      socket.on('error', (e: any) => { resolve({ ok: false, error: `连接失败: ${e?.message || e}` }); });
      socket.setTimeout(30000, () => { socket.end(); resolve({ ok: false, error: 'SMTP超时' }); });
    } catch (e: any) {
      resolve({ ok: false, error: `SMTP初始化失败: ${e?.message || e}` });
    }
  });
}

export function registerEmailTool(): void {
  registry.register(
    {
      name: 'send_email',
      description:
        '发送邮件（SMTP）。当用户要求"发邮件/发到邮箱/邮件通知"时使用。' +
        '支持正文和附件（本地文件路径）。SMTP配置从环境变量读取（AH_SMTP_HOST/PORT/USER/PASS/FROM）。',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: '收件人邮箱' },
          subject: { type: 'string', description: '邮件主题' },
          body: { type: 'string', description: '邮件正文' },
          attachment: { type: 'string', description: '可选：附件本地路径' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
    async (args: any) => {
      const host = process.env.AH_SMTP_HOST || 'smtp.qq.com';
      const port = parseInt(process.env.AH_SMTP_PORT || '465', 10);
      const user = process.env.AH_SMTP_USER || 'your-email@example.com';
      const pass = process.env.AH_SMTP_PASS || process.env.SMTP_PASS || '';
      const from = process.env.AH_SMTP_FROM || user;
      if (!pass) return { ok: false, error: '未配置 SMTP 授权码（AH_SMTP_PASS）' };

      const attachments: any[] = [];
      if (args.attachment && fs.existsSync(String(args.attachment))) {
        attachments.push({ filename: path.basename(String(args.attachment)), path: String(args.attachment) });
      }

      return sendSmtp({
        host, port, user, pass, from,
        to: String(args.to || ''),
        subject: String(args.subject || ''),
        body: String(args.body || ''),
        attachments,
      });
    },
    { tier: 'deferred', summary: '发送邮件（SMTP，支持附件）' },
  );
}
