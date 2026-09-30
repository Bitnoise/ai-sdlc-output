function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center;
           font-family: system-ui, sans-serif; background: #f3f4f6; color: #111827; }
    .card { width: 100%; max-width: 360px; margin: 16px; padding: 32px; background: #fff;
            border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,.08); }
    h1 { margin: 0 0 24px; font-size: 24px; }
  </style>
</head>
<body><main class="card">${body}</main></body>
</html>`;
}

export function homePage(): string {
  return layout("Welcome", "<h1>Welcome!</h1>");
}
