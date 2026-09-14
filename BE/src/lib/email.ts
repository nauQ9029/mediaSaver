import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

interface SendPasswordResetEmailArgs {
  to: string;
  resetUrl: string;
}

export async function sendPasswordResetEmail({ to, resetUrl }: SendPasswordResetEmailArgs) {
  const mailOptions = {
    from: `"MediaSaver Vault" <${process.env.GMAIL_USER}>`,
    to,
    subject: 'Reset Your MediaSaver Password',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #090d16; color: #f1f5f9; padding: 24px; }
            .container { max-width: 480px; margin: 0 auto; background-color: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 32px; }
            .button { display: inline-block; background-color: #0ea5e9; color: #0f172a; font-weight: 600; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin-top: 16px; }
            .footer { margin-top: 24px; font-size: 12px; color: #64748b; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Password Reset Request</h2>
            <p>We received a request to reset your password for your MediaSaver account.</p>
            <p>Click the button below to set a new password. This link is valid for <strong>15 minutes</strong>.</p>
            <a href="${resetUrl}" class="button">Reset Password</a>
            <p class="footer">If you didn't request a password reset, you can safely ignore this email.</p>
          </div>
        </body>
      </html>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`Password reset email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error('Failed to send email via Gmail SMTP:', error);
    throw new Error('Email delivery failed');
  }
}