/** HTML email bodies for the research pipeline. */

const BRAND = "#6ee7b7";
const INK = "#0f1216";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shell(inner: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:${INK};">
  <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e6ea;">
    <div style="background:${INK};padding:18px 26px;color:#ffffff;">
      <div style="font-size:12px;letter-spacing:2px;color:${BRAND};text-transform:uppercase;">AI Research Pipeline</div>
    </div>
    <div style="padding:26px;font-size:15px;line-height:1.6;">${inner}</div>
    <div style="padding:16px 26px;background:#fafbfc;font-size:12px;color:#6b7280;border-top:1px solid #e4e6ea;">
      Automated message from the AI Research Pipeline.
    </div>
  </div></body></html>`;
}

export function reviewEmail(input: {
  topic: string;
  reportHtml: string;
  revision: number;
  approveUrl: string;
  reviewUrl: string;
  sources: { title: string; url: string }[];
}): string {
  const label = input.revision === 0 ? "Draft for review" : `Revision ${input.revision} for review`;
  return shell(`
    <p style="margin:0 0 6px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">${label}</p>
    <h2 style="margin:0 0 18px;font-size:22px;">${escapeHtml(input.topic)}</h2>
    <p style="margin:0 0 20px;">The research report below was generated from ${input.sources.length} live web sources. Approve it to finalise, or send feedback and the agent will revise it.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr>
      <td style="padding-right:10px;"><a href="${input.approveUrl}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;">Approve report</a></td>
      <td><a href="${input.reviewUrl}" style="display:inline-block;background:#ffffff;color:${INK};border:1px solid #cbd5e1;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;">Send feedback</a></td>
    </tr></table>
    <hr style="border:none;border-top:1px solid #e4e6ea;margin:0 0 22px;" />
    <div style="font-size:14px;line-height:1.65;">${input.reportHtml}</div>
  `);
}

export function completedEmail(input: {
  topic: string;
  driveLink: string;
  sheetLink: string;
  revisions: number;
  pdfName: string;
}): string {
  return shell(`
    <h2 style="margin:0 0 14px;font-size:22px;">It's done — "${escapeHtml(input.topic)}" is archived</h2>
    <p style="margin:0 0 18px;">The approved report was converted to PDF, uploaded to Google Drive and logged in the tracking sheet.</p>
    <ul style="margin:0 0 22px;padding-left:20px;">
      <li>File: <strong>${escapeHtml(input.pdfName)}</strong></li>
      <li>Revision cycles before approval: <strong>${input.revisions}</strong></li>
    </ul>
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="padding-right:10px;"><a href="${input.driveLink}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;">Open PDF in Drive</a></td>
      <td><a href="${input.sheetLink}" style="display:inline-block;background:#ffffff;color:${INK};border:1px solid #cbd5e1;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;">Open research log</a></td>
    </tr></table>
  `);
}
