export function exportToPDF(headers: string[], rows: any[][], title: string) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert("Popup blocker blocked the export. Please allow popups for this site.");
    return;
  }

  const escapeHtml = (unsafe: any) => {
    if (unsafe === null || unsafe === undefined) return '-';
    return String(unsafe)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  const currentDate = new Date().toLocaleDateString('en-IN', {
    dateStyle: 'long',
    timeZone: 'Asia/Kolkata'
  });

  const currentTime = new Date().toLocaleTimeString('en-IN', {
    timeStyle: 'medium',
    timeZone: 'Asia/Kolkata'
  });

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${escapeHtml(title)}</title>
      <style>
        body {
          font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          margin: 40px;
          color: #333;
          background-color: #fff;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 2px solid #ef4444;
          padding-bottom: 20px;
          margin-bottom: 30px;
        }
        .company-name {
          font-size: 24px;
          font-weight: 800;
          color: #111;
          margin: 0;
          letter-spacing: -0.5px;
        }
        .company-name span {
          color: #ef4444;
        }
        .report-title {
          font-size: 18px;
          font-weight: 600;
          color: #4b5563;
          margin: 5px 0 0 0;
        }
        .meta-info {
          text-align: right;
          font-size: 12px;
          color: #6b7280;
          line-height: 1.5;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 30px;
          font-size: 13px;
        }
        th {
          background-color: #f3f4f6;
          color: #1f2937;
          font-weight: 700;
          text-align: left;
          padding: 12px 10px;
          border-bottom: 2px solid #e5e7eb;
        }
        td {
          padding: 10px;
          border-bottom: 1px solid #e5e7eb;
          color: #4b5563;
        }
        tr:nth-child(even) td {
          background-color: #f9fafb;
        }
        .footer {
          margin-top: 50px;
          border-top: 1px solid #e5e7eb;
          padding-top: 15px;
          font-size: 11px;
          color: #9ca3af;
          display: flex;
          justify-content: space-between;
        }
        @media print {
          body {
            margin: 20px;
          }
          button {
            display: none;
          }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <h1 class="company-name">MANUFACTURING <span>COMPANY</span></h1>
          <h2 class="report-title">${escapeHtml(title)}</h2>
        </div>
        <div class="meta-info">
          <div><strong>Date:</strong> ${currentDate}</div>
          <div><strong>Time:</strong> ${currentTime}</div>
          <div><strong>Status:</strong> Official System Export</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            ${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              ${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="footer">
        <div>Manufacturing Company ERP report generation.</div>
        <div>Page 1 of 1</div>
      </div>

      <script>
        window.onload = function() {
          window.print();
          // Optional: Close print window after printing
          // window.onafterprint = function() { window.close(); }
        }
      </script>
    </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
}
